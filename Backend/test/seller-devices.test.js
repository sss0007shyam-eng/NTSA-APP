// New-device seller sign-in, end to end over HTTP. Runs against the `ntsa_test`
// database (same server, same credentials as DATABASE_URL, different database)
// so a test never touches the dev data, and in DEMO_MODE so the OTP comes back
// in the response the way it does for the customer demo login -- nothing here
// can send a real SMS (see src/services/sms.js).
import 'dotenv/config';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/ntsa_test';
process.env.DATABASE_URL = url.toString();
process.env.DEMO_MODE = 'true';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { app } from '../src/app.js';
import { db } from '../src/db.js';

const PASSWORD = 'Seller@123';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

// A throwaway seller per run, so the suite can run twice in a row.
async function freshSeller() {
  const username = `test_seller_${randomBytes(4).toString('hex')}`;
  const seller = await db.seller.create({ data: {
    shopName: 'Test Shop', ownerName: 'Test Owner', username, phone: '9876543210',
    passwordHash: await bcrypt.hash(PASSWORD, 10),
  } });
  return seller;
}
const login = (username, body = {}, userAgent = LAPTOP) =>
  request(app).post('/api/auth/login').set('user-agent', userAgent).send({ role: 'SELLER', username, password: PASSWORD, ...body });

test('a seller\'s first sign-in enrols the device, a second device must clear an OTP', async t => {
  const seller = await freshSeller();
  t.after(async () => { await db.seller.delete({ where: { id: seller.id } }); await db.$disconnect(); });

  // 1. First ever sign-in: no device on file, nothing to protect yet, so it
  //    is let through and the browser is handed a device token to keep.
  const first = await login(seller.username);
  assert.equal(first.status, 200);
  assert.ok(first.body.token, 'the first sign-in should hand over a session token');
  assert.ok(first.body.deviceToken, 'the first sign-in should enrol the device');
  const laptopToken = first.body.deviceToken;

  // 2. The same laptop, presenting that token: straight in, no OTP.
  const again = await login(seller.username, { deviceToken: laptopToken });
  assert.equal(again.status, 200);
  assert.ok(again.body.token);
  assert.equal(again.body.otpRequired, undefined, 'a known device must not be challenged');

  // 3. A different phone, right password, no token: a challenge, NOT a token.
  const phone = await login(seller.username, {}, PHONE);
  assert.equal(phone.status, 200);
  assert.equal(phone.body.otpRequired, true);
  assert.equal(phone.body.token, undefined, 'a new device must not get a session before the OTP');
  assert.match(phone.body.phoneHint, /3210$/);
  assert.match(phone.body.device, /Android/);
  assert.match(phone.body.demoOtp, /^\d{6}$/, 'DEMO_MODE returns the code instead of sending an SMS');
  // The code is only ever stored hashed, like a delivery OTP.
  const stored = await db.sellerLoginChallenge.findUnique({ where: { id: phone.body.challengeId } });
  assert.notEqual(stored.otpHash, phone.body.demoOtp);
  assert.ok(await bcrypt.compare(phone.body.demoOtp, stored.otpHash));

  // 4. A wrong code is counted and refused.
  const wrong = await request(app).post('/api/auth/login/otp').set('user-agent', PHONE)
    .send({ challengeId: phone.body.challengeId, otp: '000000' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'Incorrect code');
  assert.equal((await db.sellerLoginChallenge.findUnique({ where: { id: phone.body.challengeId } })).attempts, 1);

  // 5. The right code hands over the session and enrols the phone.
  const ok = await request(app).post('/api/auth/login/otp').set('user-agent', PHONE)
    .send({ challengeId: phone.body.challengeId, otp: phone.body.demoOtp });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.ok(ok.body.deviceToken);
  assert.notEqual(ok.body.deviceToken, laptopToken);

  // 6. One challenge buys one session: the same code cannot be replayed.
  const replay = await request(app).post('/api/auth/login/otp').set('user-agent', PHONE)
    .send({ challengeId: phone.body.challengeId, otp: phone.body.demoOtp });
  assert.equal(replay.status, 400);

  // 7. The phone is now known, and both devices show in the seller's own list.
  const back = await login(seller.username, { deviceToken: ok.body.deviceToken }, PHONE);
  assert.ok(back.body.token);
  assert.equal(back.body.otpRequired, undefined);
  const devices = await request(app).get('/api/seller/devices').set('Authorization', `Bearer ${back.body.token}`);
  assert.equal(devices.status, 200);
  assert.equal(devices.body.length, 2);
  assert.ok(devices.body.every(d => d.lastUsedAt && d.label && !('tokenHash' in d)));

  // 8. Revoking the laptop: its token is no longer known, so it is challenged
  //    again next time. (The revoke also bumps sessionVersion, which is why
  //    the panel signs out after one.)
  const laptopRow = devices.body.find(d => /Windows/.test(d.label));
  const revoked = await request(app).delete(`/api/seller/devices/${laptopRow.id}`).set('Authorization', `Bearer ${back.body.token}`);
  assert.equal(revoked.status, 204);
  const afterRevoke = await login(seller.username, { deviceToken: laptopToken });
  assert.equal(afterRevoke.body.otpRequired, true, 'a revoked laptop must be treated as new again');
  assert.equal(afterRevoke.body.token, undefined);
});

test('five wrong codes burn the challenge', async t => {
  const seller = await freshSeller();
  t.after(async () => { await db.seller.delete({ where: { id: seller.id } }); await db.$disconnect(); });
  await login(seller.username); // first sign-in enrols the laptop
  const challenge = await login(seller.username, {}, PHONE);
  assert.equal(challenge.body.otpRequired, true);
  const guess = () => request(app).post('/api/auth/login/otp').send({ challengeId: challenge.body.challengeId, otp: '000000' });
  for (let i = 0; i < 4; i++) assert.equal((await guess()).body.error, 'Incorrect code');
  assert.match((await guess()).body.error, /Too many wrong codes/);
  // Burnt: the real code no longer works either, and the row is gone.
  const after = await request(app).post('/api/auth/login/otp').send({ challengeId: challenge.body.challengeId, otp: challenge.body.demoOtp });
  assert.equal(after.status, 400);
  assert.equal(await db.sellerLoginChallenge.count({ where: { sellerId: seller.id } }), 0);
});

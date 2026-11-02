// Portal-based GST/Aadhaar verification: the name comparison that is the whole
// point of the feature, and the two promises the admin panel makes about it --
// that only a real portal answer ticks a box, and that an unconfigured
// provider says so instead of inventing a pass.
//
// Runs against the `ntsa_test` database, never the live one. The URL is
// switched over before anything reads the config (dotenv doesn't overwrite
// what's already in process.env).
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import request from 'supertest';

process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/ntsa(\?|$)/, '/ntsa_test$1');
// These tests assert what happens with NO provider configured, which is the
// state every NTSA environment is in today.
delete process.env.GST_VERIFY_API_KEY;

const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { tokenFor } = await import('../src/services/auth.js');
const { nameMatch, foldName, isVerifiedOutcome } = await import('../src/lib/verification.js');
const { gstProviderConfigured, verifyGstin, verifyAadhaar } = await import('../src/services/verification.js');

const TAG = 'verify-test';
const unique = what => `${TAG}-${what}-${Date.now()}`;

// Two panel logins: only the admin may spend a portal lookup.
const [adminAccount, salesAccount] = await Promise.all([
  db.admin.create({ data: { email: `${unique('admin')}@ntsa.local`, passwordHash: 'x', role: 'ADMIN', name: 'Verify Test Admin' } }),
  db.admin.create({ data: { email: `${unique('sales')}@ntsa.local`, passwordHash: 'x', role: 'SALES', name: 'Verify Test Sales' } }),
]);
const adminToken = tokenFor('ADMIN', adminAccount);
const salesToken = tokenFor('SALES', salesAccount);
const as = token => ({ Authorization: `Bearer ${token}` });

const seller = await db.seller.create({ data: {
  shopName: 'Rajesh Traders', ownerName: 'Rajesh Kumar', username: unique('seller'),
  passwordHash: 'x', phone: '+919000000001',
  gstNumber: '08ABCDE1234F1Z5', aadharNumber: '123456789012',
  // Pre-ticked by hand, so the tests can prove a failed portal check does not
  // silently throw the admin's own confirmation away.
  gstVerified: true, aadharVerified: true,
} });
const vendor = await db.vendor.create({ data: {
  name: 'Suresh Wholesale', username: unique('vendor'), passwordHash: 'x',
  gstNumber: 'notagstin', aadharNumber: '210987654321',
} });

test.after(async () => {
  await db.verificationCheck.deleteMany({ where: { OR: [{ sellerId: seller.id }, { vendorId: vendor.id }] } });
  await db.seller.delete({ where: { id: seller.id } });
  await db.vendor.delete({ where: { id: vendor.id } });
  await db.admin.deleteMany({ where: { id: { in: [adminAccount.id, salesAccount.id] } } });
  await db.$disconnect();
});

test('a portal name matches the business on file through its legal wrapping', () => {
  assert.equal(foldName('M/S Rajesh Kumar Traders Private Limited'), 'rajesh kumar traders');
  assert.equal(nameMatch(['Rajesh Traders', 'Rajesh Kumar'], ['M/S RAJESH KUMAR TRADERS PVT LTD']), true);
  // A shop registered under the owner's own name is normal, not a mismatch.
  assert.equal(nameMatch(['Rajesh Traders', 'Rajesh Kumar'], ['RAJESH KUMAR']), true);
});

test('a different business is reported as a mismatch, not waved through', () => {
  // The fraud case: a real, live GSTIN belonging to somebody else.
  assert.equal(nameMatch(['Rajesh Traders'], ['SURESH STORES']), false);
  // One shared word is not a match -- this is the near miss that matters.
  assert.equal(nameMatch(['Rajesh Traders'], ['RAJESH ELECTRONICS PVT LTD']), false);
});

test('nothing to compare is answered with "unknown", which is not a mismatch', () => {
  assert.equal(nameMatch([], ['RAJESH TRADERS']), null);
  assert.equal(nameMatch(['Rajesh Traders'], [null, undefined]), null);
});

test('with no provider configured, nothing claims to have been verified', async () => {
  assert.equal(gstProviderConfigured(), false);
  for (const result of [await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders']), await verifyAadhaar()]) {
    assert.equal(result.outcome, 'UNAVAILABLE');
    assert.equal(isVerifiedOutcome(result.outcome), false);
    assert.equal(result.provider, 'none');
    assert.match(result.message, /\S/, 'the admin must be told why in words');
  }
});

test('the admin is told no provider is configured, and their own tick survives it', async () => {
  const res = await request(app).post(`/api/admin/sellers/${seller.id}/verify-gst`).set(as(adminToken)).expect(200);
  assert.equal(res.body.check.outcome, 'UNAVAILABLE');
  assert.equal(res.body.providerConfigured, false);
  assert.match(res.body.check.message, /provider/i);
  assert.equal(res.body.check.checkedByName, 'Verify Test Admin');
  // A check that did not happen changes nothing about what NTSA knows.
  assert.equal(res.body.verified, true);
  assert.equal((await db.seller.findUnique({ where: { id: seller.id } })).gstVerified, true);
});

test('an attempt that could not run is still recorded, with its date', async () => {
  const before = Date.now();
  await request(app).post(`/api/admin/sellers/${seller.id}/verify-aadhaar`).set(as(adminToken)).expect(200);
  const [check] = await db.verificationCheck.findMany({ where: { sellerId: seller.id, kind: 'AADHAAR' }, orderBy: { checkedAt: 'desc' }, take: 1 });
  assert.equal(check.outcome, 'UNAVAILABLE');
  assert.ok(check.checkedAt.getTime() >= before - 1000, 'the check must carry when it was made');
  // The Aadhaar number is never copied into a second table.
  assert.equal(check.subject, null);
  assert.match(check.message, /AUA\/KUA licence/);
  // The seller list is where the panel reads this back from.
  const list = await request(app).get('/api/admin/sellers').set(as(adminToken)).expect(200);
  const row = list.body.find(s => s.id === seller.id);
  assert.ok(row.verificationChecks.some(c => c.kind === 'AADHAAR' && c.outcome === 'UNAVAILABLE'));
});

test('a malformed GST number on file is refused before a paid lookup', async () => {
  const res = await request(app).post(`/api/admin/vendors/${vendor.id}/verify-gst`).set(as(adminToken)).expect(400);
  assert.match(res.body.error, /15-character GSTIN/);
  assert.equal(await db.verificationCheck.count({ where: { vendorId: vendor.id, kind: 'GST' } }), 0);
});

test('only the admin may ask a portal, and only about someone who exists', async () => {
  await request(app).post(`/api/admin/sellers/${seller.id}/verify-gst`).set(as(salesToken)).expect(403);
  await request(app).post(`/api/admin/sellers/${seller.id}/verify-gst`).expect(401);
  await request(app).post('/api/admin/sellers/does-not-exist/verify-gst').set(as(adminToken)).expect(404);
});

test('the panel can ask what is configured before showing a button', async () => {
  const res = await request(app).get('/api/admin/verification/providers').set(as(adminToken)).expect(200);
  assert.deepEqual(res.body, { gst: false, aadhaar: false });
});

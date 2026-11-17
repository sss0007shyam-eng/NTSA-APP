import bcrypt from 'bcryptjs';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireThat } from '../lib/rules.js';
import { sendSellerOtp } from './sms.js';
import { sendEmail } from './email.js';
// A seller's panel is their shop's till: a stolen username and password
// shouldn't be enough on its own. So a sign-in from a browser or phone we
// haven't seen before has to clear a one-time code sent to the phone number
// the admin has on file, and only then does it get a session token.
export const OTP_TTL_MS = 10 * 60000, OTP_MAX_ATTEMPTS = 5;
// The device token is a long random secret the client keeps, hashed here with
// SHA-256 rather than bcrypt: unlike a password it has full entropy, and it
// has to be looked up by its hash on every login, which bcrypt can't do.
const tokenHash = token => createHash('sha256').update(token).digest('hex');
/// A name the seller will recognise in their Devices list. The user-agent is
/// only ever used for this label, never to decide whether a device is known.
export function deviceLabel(userAgent = '') {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'A browser';
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iPhone' : /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS X/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'an unknown device';
  return `${browser} on ${os}`;
}
/// The matching device row, or null. Touches `lastUsedAt` so the seller can
/// tell a laptop they still use from one they left behind.
export async function knownDevice(sellerId, deviceToken, { ip, userAgent } = {}) {
  if (!deviceToken) return null;
  const device = await db.sellerDevice.findUnique({ where: { tokenHash: tokenHash(deviceToken) } });
  if (!device || device.sellerId !== sellerId) return null;
  return db.sellerDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date(), lastIp: ip ?? null, lastUserAgent: userAgent ?? null } });
}
/// Registers this device and hands back the secret the client must keep. The
/// client stores it in localStorage (not sessionStorage) so closing the tab
/// doesn't turn the same laptop back into an unknown device.
export async function registerDevice(sellerId, { label, ip, userAgent }) {
  const deviceToken = randomBytes(32).toString('hex');
  await db.sellerDevice.create({ data: { sellerId, tokenHash: tokenHash(deviceToken), label, lastIp: ip ?? null, lastUserAgent: userAgent ?? null } });
  // A device that was not trusted before is now signed in. Tell the seller --
  // in the panel's bell and, if their email is on file and SMTP is set, by
  // email -- so a sign-in they did not make cannot go unnoticed.
  await alertNewDevice(sellerId, label, ip);
  return deviceToken;
}
/// The "your account was signed in on a new device" alert. Never throws: a
/// failed alert must not block the sign-in that caused it.
async function alertNewDevice(sellerId, label, ip) {
  try {
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { shopName: true, email: true } });
    if (!seller) return;
    const where = label || 'a new device';
    const line = `Your NTSA seller account was signed in on ${where}${ip ? ` (IP ${ip})` : ''}.`;
    await db.notification.create({ data: {
      audience: `SELLER:${sellerId}`, type: 'NEW_DEVICE_LOGIN', title: 'New sign-in to your account',
      body: `${line} If this wasn't you, change your password and contact NTSA right away.`, entityId: sellerId,
    } }).catch(() => {});
    if (seller.email) {
      await sendEmail({
        to: seller.email,
        subject: 'New sign-in to your NTSA seller account',
        text: `Hello ${seller.shopName || ''},\n\n${line}\n\nIf this was you, you can ignore this email. If it was not, change your password immediately and contact NTSA.\n\n— NTSA`,
      });
    }
  } catch (e) {
    console.error('New-device alert failed:', e.message);
  }
}
/// Starts the OTP challenge: a 6-digit code, stored only as a bcrypt hash
/// with a 10-minute expiry and an attempt counter, exactly like a delivery
/// OTP. Resolves to what the panel needs to show the code entry screen.
export async function startOtpChallenge(seller, { label, ip, userAgent }) {
  const otp = String(randomInt(100000, 1000000));
  // Only one challenge at a time per seller: a fresh password submission
  // should invalidate the code sent a moment ago, not pile up alongside it.
  await db.sellerLoginChallenge.deleteMany({ where: { sellerId: seller.id } });
  const challenge = await db.sellerLoginChallenge.create({
    data: { sellerId: seller.id, otpHash: await bcrypt.hash(otp, 10), expiresAt: new Date(Date.now() + OTP_TTL_MS), label, ip: ip ?? null, userAgent: userAgent ?? null },
  });
  // Throws if there is no way to deliver the code, which rolls the login back
  // to "try again later" instead of leaving the seller stuck on a code screen.
  await sendSellerOtp(seller.phone, otp);
  return {
    otpRequired: true, challengeId: challenge.id, phoneHint: phoneHint(seller.phone),
    expiresInSeconds: OTP_TTL_MS / 1000, device: label,
    // Same stand-in as the customer demo login: DEMO_MODE shows the code so
    // the flow can be tested with no SMS gateway. Never set in production.
    ...(config.DEMO_MODE ? { demoOtp: otp } : {}),
  };
}
/// Checks the code and, if it is right, registers the device. Returns the
/// seller plus the device token; throws with the reason if it is not.
export async function completeOtpChallenge({ challengeId, otp, ip, userAgent }) {
  const challenge = await db.sellerLoginChallenge.findUnique({ where: { id: challengeId }, include: { seller: true } });
  requireThat(challenge && !challenge.usedAt && challenge.expiresAt > new Date() && challenge.attempts < OTP_MAX_ATTEMPTS, 400, 'This code has expired. Please sign in again to get a new one');
  const seller = challenge.seller;
  requireThat(seller.enabled && !seller.deleted, 401, 'Invalid credentials');
  if (!await bcrypt.compare(otp, challenge.otpHash)) {
    const { attempts } = await db.sellerLoginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    // Out of tries: drop the challenge so the code can never be guessed by
    // starting a fresh attempt counter against the same hash.
    if (attempts >= OTP_MAX_ATTEMPTS) await db.sellerLoginChallenge.delete({ where: { id: challenge.id } });
    requireThat(false, 400, attempts >= OTP_MAX_ATTEMPTS ? 'Too many wrong codes. Please sign in again to get a new one' : 'Incorrect code');
  }
  await db.sellerLoginChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  return { seller, deviceToken: await registerDevice(seller.id, { label: challenge.label, ip, userAgent }) };
}
/// What the seller and the admin see. Never includes the token hash.
export const publicDevice = ({ id, label, lastIp, createdAt, lastUsedAt }) => ({ id, label, lastIp, createdAt, lastUsedAt });
export const listDevices = sellerId => db.sellerDevice.findMany({ where: { sellerId }, orderBy: { lastUsedAt: 'desc' } }).then(rows => rows.map(publicDevice));
// Only the last 4 digits, so the seller knows which number to look at without
// the login page confirming a full phone number to whoever has the password.
function phoneHint(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : '';
}

import { config } from '../config.js';
import { HttpError } from '../lib/rules.js';
// ---------------------------------------------------------------------------
// THE ONE PLACE AN SMS WOULD BE SENT. NOTHING HERE SENDS A REAL SMS TODAY.
//
// NTSA has no SMS gateway configured. Firebase is set up for the *customer*
// app's phone login, but that is client-side Firebase Auth running in the
// Flutter app -- Firebase Admin on the server cannot send an OTP SMS at all,
// so a seller signing in on a laptop panel has no Firebase path to a code.
//
// So: in DEMO_MODE the code is logged to the server console (and returned in
// the response) exactly the way `/auth/demo/otp` already stands in for the
// customer's phone login. Outside DEMO_MODE, with no provider configured,
// this REFUSES the login rather than quietly letting an unknown device
// through -- a security control that silently does nothing is worse than
// none.
//
// BEFORE LAUNCH: plug a real provider in below (MSG91 or Twilio; both are a
// single HTTPS POST). Add its credentials to config.js, send the message
// here, and nothing else in the codebase has to change.
// ---------------------------------------------------------------------------
export function smsConfigured() {
  return false; // flip to a real credential check once a provider is added
}
/// Sends a seller their new-device sign-in code. Throws (503) if there is no
/// way to deliver it, so the caller never hands out a challenge the seller
/// cannot answer.
export async function sendSellerOtp(phone, code) {
  if (smsConfigured()) {
    // <-- REAL PROVIDER GOES HERE, e.g.
    // await fetch('https://control.msg91.com/api/v5/flow', { method: 'POST',
    //   headers: { authkey: config.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ template_id: config.MSG91_OTP_TEMPLATE, recipients: [{ mobiles: `91${phone}`, otp: code }] }) });
    return;
  }
  if (config.DEMO_MODE) {
    console.log(`[seller OTP] ${phone}: ${code}  (DEMO_MODE -- no SMS was sent)`);
    return;
  }
  console.error('A seller new-device OTP could not be delivered: no SMS provider is configured. See src/services/sms.js');
  throw new HttpError(503, 'We cannot send your sign-in code right now. Please contact the NTSA administrator.');
}

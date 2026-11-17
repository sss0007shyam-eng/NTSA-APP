// Sending money OUT to a customer's bank account or UPI (a return's refund).
// This is the counterpart to the payment gateway, which only takes money IN.
// Like services/sms.js and services/email.js it is a seam: until a payout
// provider (RazorpayX) is configured it does nothing and the admin records the
// transfer by hand, so nothing breaks before the client sets it up.
//
// To turn it on, set RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET and
// RAZORPAYX_ACCOUNT_NUMBER (the RazorpayX current-account number money is sent
// from), then fill in the fetch() call below against
// https://razorpay.com/docs/x/apis/ -- create a contact + fund account for the
// refund's bank/UPI, then a payout, and return its UTR.
const { RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET, RAZORPAYX_ACCOUNT_NUMBER } = process.env;

export function payoutConfigured() {
  return !!(RAZORPAYX_KEY_ID && RAZORPAYX_KEY_SECRET && RAZORPAYX_ACCOUNT_NUMBER);
}

/// Sends `amountPaise` to the bank/UPI on `refund`. Returns the payout's
/// reference (UTR) on success, or null when no provider is configured (the
/// admin then records their own manual-transfer reference).
export async function sendRefundPayout(refund, amountPaise) {
  if (!payoutConfigured()) return null;
  // <-- REAL PROVIDER GOES HERE (RazorpayX Payouts). Outline:
  //   const auth = 'Basic ' + Buffer.from(`${RAZORPAYX_KEY_ID}:${RAZORPAYX_KEY_SECRET}`).toString('base64');
  //   1. POST /v1/contacts  -> contactId
  //   2. POST /v1/fund_accounts  (bank_account or vpa)  -> fundAccountId
  //   3. POST /v1/payouts { account_number: RAZORPAYX_ACCOUNT_NUMBER, fund_account_id,
  //        amount: amountPaise, currency: 'INR', mode: refund.upiId ? 'UPI' : 'IMPS',
  //        purpose: 'refund', reference_id: `refund:${refund.id}` }
  //   4. return payout.utr (or payout.id while it is processing)
  throw new Error('RazorpayX payout not implemented yet');
}

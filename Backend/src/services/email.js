import nodemailer from 'nodemailer';
// Outgoing email (seller security alerts today; order/other mail later). Like
// services/sms.js this is a seam: it only sends once an SMTP provider is set
// in the environment, and is a harmless no-op otherwise, so nothing breaks
// before the client picks a provider.
//
// Set these to turn it on (Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465,
// SMTP_USER=<the gmail>, SMTP_PASS=<a Google "app password">; Resend:
// SMTP_HOST=smtp.resend.com, SMTP_PORT=465, SMTP_USER=resend, SMTP_PASS=<api key>).
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

export function emailConfigured() { return !!(SMTP_HOST && SMTP_USER && SMTP_PASS); }

let transporter = null;
function getTransporter() {
  if (!transporter && emailConfigured()) {
    const port = Number(SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  }
  return transporter;
}

/// Sends one email. Never throws -- a failed alert must not fail the action
/// that triggered it (a seller's sign-in, say). No-op until SMTP is configured.
export async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject) return;
  if (!emailConfigured()) { console.log(`[email -> ${to}] ${subject}  (no SMTP provider configured)`); return; }
  try {
    await getTransporter().sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, text, html });
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
}

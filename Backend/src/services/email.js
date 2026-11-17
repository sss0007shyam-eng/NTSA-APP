import nodemailer from 'nodemailer';
// Outgoing email (seller security alerts today; order/other mail later). Like
// services/sms.js this is a seam: it only sends once a provider is set in the
// environment, and is a harmless no-op otherwise, so nothing breaks before the
// client picks one.
//
// Two ways to send, Brevo preferred:
//   Brevo (HTTP API): BREVO_API_KEY (SMTP & API -> API Keys) + SMTP_FROM (a
//     sender verified in Brevo -> Senders).
//   Plain SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS + SMTP_FROM (Gmail:
//     smtp.gmail.com:465 with a Google App Password).
const { BREVO_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

export function emailConfigured() {
  return !!(SMTP_FROM && (BREVO_API_KEY || (SMTP_HOST && SMTP_USER && SMTP_PASS)));
}

async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: SMTP_FROM, name: 'NTSA' },
      to: [{ email: to }],
      subject,
      ...(html ? { htmlContent: html } : { htmlContent: `<pre style="font:inherit">${text || ''}</pre>` }),
      ...(text ? { textContent: text } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = Number(SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  }
  return transporter;
}

/// Sends one email. Never throws -- a failed alert must not fail the action
/// that triggered it (a seller's sign-in, say). No-op until a provider is set.
export async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject) return;
  if (!emailConfigured()) { console.log(`[email -> ${to}] ${subject}  (no email provider configured)`); return; }
  try {
    if (BREVO_API_KEY) await sendViaBrevo({ to, subject, text, html });
    else await getTransporter().sendMail({ from: SMTP_FROM, to, subject, text, html });
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
}

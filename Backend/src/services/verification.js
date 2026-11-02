import { config } from '../config.js';
import { nameMatch } from '../lib/verification.js';
// ---------------------------------------------------------------------------
// THE ONE PLACE A GOVERNMENT PORTAL IS ASKED ABOUT A SELLER. Shaped like
// services/sms.js: one seam per provider, and an honest refusal when there is
// no provider to ask.
//
// This does NOT replace the admin's manual tick. The tick stays what it
// always was -- "I looked at the paperwork myself" -- and a check here is the
// separate, evidenced answer: what the portal said, when, and whether the
// name it holds matches the name NTSA has on file.
//
// NOTHING HERE EVER RETURNS 'VERIFIED' WITHOUT A PORTAL HAVING ANSWERED. An
// unconfigured provider returns 'UNAVAILABLE' with a sentence the admin can
// read, because a verification that silently invents a pass is worse than no
// verification at all.
//
// --- GST ---------------------------------------------------------------
// There is no free, open GSTN endpoint. The government portal's own taxpayer
// search is a web form (with a captcha), and api.gst.gov.in is reachable only
// through a licensed GST Suvidha Provider. For a business NTSA's size the
// realistic route is a reseller that fronts a GSP and bills per lookup
// (roughly Rs 0.40-0.80 a call). The seam below speaks the Appyflow shape,
// which is a single GET; any reseller can be dropped in beside it.
//
// --- AADHAAR -----------------------------------------------------------
// Deliberately NOT implemented against UIDAI, and this is not an oversight.
// UIDAI online authentication/eKYC needs an AUA/KUA licence (or being a
// sub-AUA under a bank or licensed KYC provider), with an audited data vault
// and per-slab licence fees -- not something a proprietorship gets. The two
// routes that need no licence are (a) Aadhaar Paperless Offline e-KYC, where
// the *resident* downloads a share-code-protected XML/QR and NTSA verifies
// UIDAI's signature on it, and (b) a DigiLocker partner integration via API
// Setu, which needs its own organisation onboarding. Both are real work and
// both change what the seller has to do, so neither is guessed at here.
// Until one is built, `verifyAadhaar` says so out loud.
// ---------------------------------------------------------------------------

/// Is there a GST provider to ask at all? The panel calls this through the
/// route so the button can tell the admin the truth before they press it.
export function gstProviderConfigured() {
  return Boolean(config.GST_VERIFY_API_KEY);
}

/// Aadhaar has no configured provider by design (see the note above). Left as
/// a function, not a constant, so wiring offline e-KYC or DigiLocker later is
/// a change in this file and nowhere else.
export function aadhaarProviderConfigured() {
  return false;
}

const PROVIDER = 'appyflow';
const UNAVAILABLE_GST = 'No GST verification provider is configured, so no check was made. Add a provider key to switch this button on — until then the manual tick is all NTSA has.';
const UNAVAILABLE_AADHAAR = 'Aadhaar cannot be checked against UIDAI: online Aadhaar verification needs a UIDAI AUA/KUA licence, which NTSA does not hold. Nothing was checked. Confirm the Aadhaar by looking at the uploaded document yourself.';

/// Asks the GST portal (through whichever provider is configured) who a GSTIN
/// belongs to, and whether that is the business NTSA thinks it is.
///
/// Never throws for a "no" -- a refusal, a dead GSTIN and an unreachable
/// provider are all outcomes worth recording, and a thrown error would lose
/// them. Only a caller bug (no GSTIN) throws.
export async function verifyGstin(gstin, namesOnFile = []) {
  if (!gstin) throw new Error('verifyGstin needs a GST number');
  if (!gstProviderConfigured()) {
    return { outcome: 'UNAVAILABLE', provider: 'none', message: UNAVAILABLE_GST };
  }
  try {
    const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(config.GST_VERIFY_API_KEY)}`;
    // A seller sitting in front of the admin should not wait on a hung
    // provider; the admin can simply press the button again.
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { outcome: 'ERROR', provider: PROVIDER, message: `The GST provider answered ${res.status}. Try again in a minute.` };
    }
    // Appyflow reports a bad/unknown GSTIN as a 200 with an `error` flag, so
    // the status code alone is not the answer.
    if (body.error) {
      const message = String(body.message || 'The GST portal did not recognise this number');
      return { outcome: /not ?found|invalid|does not exist/i.test(message) ? 'NOT_FOUND' : 'ERROR', provider: PROVIDER, message };
    }
    return readTaxpayer(body.taxpayerInfo || body.data || body, namesOnFile);
  } catch (err) {
    // Timeout, DNS, TLS -- the admin needs to know the check did not happen,
    // not see a 500.
    return { outcome: 'ERROR', provider: PROVIDER, message: `The GST provider could not be reached (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
}


// The GST portal's field names, which every reseller passes through
// unchanged: lgnm = legal name, tradeNam = trade name, sts = status,
// pradr.addr = principal place of business.
function readTaxpayer(info, namesOnFile) {
  const legalName = info?.lgnm || null;
  const tradeName = info?.tradeNam || null;
  const registrationStatus = info?.sts || null;
  const a = info?.pradr?.addr || {};
  const address = [a.bno, a.bnm, a.st, a.loc, a.dst, a.stcd, a.pncd].filter(Boolean).join(', ') || info?.pradr?.adr || null;
  const matched = nameMatch(namesOnFile, [legalName, tradeName]);
  const base = { provider: PROVIDER, legalName, tradeName, registrationStatus, address, nameMatch: matched };
  // A cancelled GSTIN still returns a name, so status is checked before the
  // name: "it matches, but the registration is dead" must not read as a pass.
  if (registrationStatus && !/^active$/i.test(registrationStatus)) return { ...base, outcome: 'INACTIVE' };
  // An unknown name (nothing on file to compare) is not a pass either -- the
  // whole point of this check is that the portal's name is the fraud signal.
  if (matched !== true) return { ...base, outcome: 'MISMATCH' };
  return { ...base, outcome: 'VERIFIED' };
}

/// The Aadhaar equivalent. Always refuses today, with the reason, so the
/// button is honest rather than absent.
export async function verifyAadhaar() {
  if (!aadhaarProviderConfigured()) {
    return { outcome: 'UNAVAILABLE', provider: 'none', message: UNAVAILABLE_AADHAAR };
  }
  // <-- OFFLINE e-KYC / DIGILOCKER VERIFICATION GOES HERE
  return { outcome: 'UNAVAILABLE', provider: 'none', message: UNAVAILABLE_AADHAAR };
}

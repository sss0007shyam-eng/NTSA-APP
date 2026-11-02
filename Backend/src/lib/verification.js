// Pure helpers for portal-based KYC verification. Kept dependency-free (the
// same reason lib/courier.js is) so the provider seam, the admin routes and
// the tests can all use them without a database or a config file.

// How a check ended. Stored verbatim on a VerificationCheck row so the API,
// the panel and the tests share one vocabulary.
//   VERIFIED    - the portal answered, the registration is live, the name matches
//   MISMATCH    - the portal answered, but it is registered to a different name
//   INACTIVE    - the registration exists but is cancelled/suspended
//   NOT_FOUND   - the portal does not know this number
//   UNAVAILABLE - no provider is configured, so no check happened at all
//   ERROR       - the provider was reachable but failed

// Only VERIFIED means a real portal said yes. Everything else -- including
// UNAVAILABLE, which is what an unconfigured provider returns -- must never
// read as a tick anywhere.
export const isVerifiedOutcome = outcome => outcome === 'VERIFIED';

// Honorifics and legal-form suffixes are noise: the GST portal returns
// "M/S RAJESH KUMAR TRADERS PRIVATE LIMITED" for a shop the sales team wrote
// down as "Rajesh Kumar Traders". Trade words ("Traders", "Stores") are
// deliberately NOT stripped -- "Rajesh Traders" and "Rajesh Stores" are two
// different businesses, and this comparison exists to catch exactly that.
const NOISE = /\b(m\/s|ms|mr|mrs|smt|shri|sri|pvt|private|ltd|limited|llp|inc|the)\b/g;

/// Folds a business or person name down to the words that identify it.
export function foldName(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(NOISE, ' ')
    .split(/\s+/).filter(Boolean).join(' ');
}

/// Does the name a portal returned belong to the business NTSA has on file?
///
/// A seller is on file under two names (shop and owner) and the GST portal
/// answers with two of its own (legal and trade), and any pairing is a
/// legitimate match -- a shop registered under its owner's personal name is
/// completely normal. So every candidate is compared against every name on
/// file, and one hit is enough.
///
/// Returns null, not false, when there is nothing to compare: "we don't know"
/// is not the same answer as "it doesn't match", and only one of them is a
/// fraud signal.
export function nameMatch(namesOnFile, portalNames) {
  const onFile = (Array.isArray(namesOnFile) ? namesOnFile : [namesOnFile]).map(foldName).filter(Boolean);
  const portal = (Array.isArray(portalNames) ? portalNames : [portalNames]).map(foldName).filter(Boolean);
  if (!onFile.length || !portal.length) return null;
  return onFile.some(a => portal.some(b => sameBusiness(a, b)));
}

// Word-for-word equality is too strict (the portal carries words the sales
// team left out), so the shorter name counts as a match when every word of it
// appears in the longer one. A single shared word is not enough: that would
// match "Rajesh Traders" to "Rajesh Electronics".
function sameBusiness(a, b) {
  if (a === b) return true;
  const [short, long] = a.split(' ').length <= b.split(' ').length ? [a, b] : [b, a];
  const words = short.split(' ');
  if (words.length < 2) return false;
  const haystack = new Set(long.split(' '));
  return words.every(w => haystack.has(w));
}

// What the GST seam makes of a portal answer, once a provider IS configured.
//
// A separate file from verification.test.js because config.js is parsed once
// at import: this process is the one with a key set. The provider itself is
// stubbed at `fetch` -- the point here is the mapping from what the portal
// says to the outcome the admin is shown, which is where a mistake would
// quietly turn somebody else's live GSTIN into a green tick.
//
// No database and no HTTP server: this is the service seam on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/ntsa(\?|$)/, '/ntsa_test$1');
process.env.GST_VERIFY_API_KEY = 'test-gst-provider-key';

const { verifyGstin, gstProviderConfigured } = await import('../src/services/verification.js');

// The GST portal's own field names, which every reseller passes through.
const taxpayer = (over = {}) => ({ taxpayerInfo: {
  lgnm: 'RAJESH KUMAR TRADERS PRIVATE LIMITED', tradeNam: 'Rajesh Traders', sts: 'Active',
  pradr: { addr: { bno: '12', st: 'MI Road', loc: 'Jaipur', dst: 'Jaipur', stcd: 'Rajasthan', pncd: '302001' } },
  ...over,
} });
// Replaced per test rather than once, so each case says what it answers with.
const answers = body => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); };
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

test('a live GSTIN in the right name is the only thing that verifies', async () => {
  assert.equal(gstProviderConfigured(), true);
  answers(taxpayer());
  const r = await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders', 'Rajesh Kumar']);
  assert.equal(r.outcome, 'VERIFIED');
  assert.equal(r.nameMatch, true);
  assert.equal(r.legalName, 'RAJESH KUMAR TRADERS PRIVATE LIMITED');
  assert.equal(r.registrationStatus, 'Active');
  // The address is kept so the admin can eyeball it against the shop's own.
  assert.match(r.address, /MI Road.*Jaipur.*302001/);
});

test('a live GSTIN registered to someone else is a mismatch, never a pass', async () => {
  answers(taxpayer({ lgnm: 'SURESH STORES', tradeNam: 'Suresh Stores' }));
  const r = await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders', 'Rajesh Kumar']);
  assert.equal(r.outcome, 'MISMATCH');
  assert.equal(r.nameMatch, false);
  // The name is still kept: it is the evidence the admin acts on.
  assert.equal(r.legalName, 'SURESH STORES');
});

test('a cancelled registration does not pass on a matching name alone', async () => {
  answers(taxpayer({ sts: 'Cancelled' }));
  const r = await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders']);
  assert.equal(r.outcome, 'INACTIVE');
  assert.equal(r.registrationStatus, 'Cancelled');
});

test('a GSTIN the portal does not know is NOT_FOUND, not an error', async () => {
  answers({ error: true, message: 'GSTIN not found in GST portal' });
  assert.equal((await verifyGstin('08ABCDE1234F1Z9', ['Rajesh Traders'])).outcome, 'NOT_FOUND');
});

test('a provider that fails is reported as a failed check, not a refusal', async () => {
  globalThis.fetch = async () => { throw new Error('socket hang up'); };
  const r = await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders']);
  assert.equal(r.outcome, 'ERROR');
  assert.match(r.message, /could not be reached/);
  // A 5xx from the provider is the same story told differently.
  globalThis.fetch = async () => new Response('gateway down', { status: 502 });
  assert.equal((await verifyGstin('08ABCDE1234F1Z5', ['Rajesh Traders'])).outcome, 'ERROR');
});

test('a name NTSA does not hold is not treated as a match', async () => {
  // "The portal says a name and we have nothing to check it against" must not
  // become a tick -- comparing the names is the entire value of the check.
  answers(taxpayer());
  assert.equal((await verifyGstin('08ABCDE1234F1Z5', [])).outcome, 'MISMATCH');
});

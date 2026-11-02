// Courier-partner helpers, kept pure and dependency-free so both the order
// serialiser (services/orders.js) and the tracking webhook (routes.js) can use
// them without importing each other.

// What a tracking URL template leaves for the tracking number to fill.
export const AWB_PLACEHOLDER = '{awb}';

/// The link that tracks one order's parcel.
/// A link typed on the order itself always wins -- that's the escape hatch for
/// a one-off courier or a non-standard link. Otherwise it's built from the
/// configured partner's template, every time it's read rather than stored, so
/// editing that one template re-points every order that courier is carrying.
export function trackingLinkFor(order) {
  if (order?.trackingUrl) return order.trackingUrl;
  const template = order?.courierPartner?.trackingUrlTemplate;
  if (!template || !order?.trackingNumber) return null;
  return template.replaceAll(AWB_PLACEHOLDER, encodeURIComponent(order.trackingNumber));
}

/// What a hand-rolled Prisma order query has to join for trackingLinkFor() to
/// work. (The full order views go through `orderInclude`, which has it already.)
export const courierPartnerJoin = { courierPartner: { select: { name: true, trackingUrlTemplate: true, contactPhone: true, contactEmail: true } } };

// Couriers write their own name differently in every payload ("Ecom Express",
// "ecom-express", "EcomExpress Pvt Ltd"), so names are compared with the
// spacing and punctuation taken out.
const fold = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/// Resolves the `courier` a webhook sent to one of the configured partners.
/// Matching on the folded name (not the id) is what keeps a renamed partner
/// working: the courier keeps sending its own name, which still folds to the
/// same thing. A name that contains, or is contained by, a partner's name
/// counts too, for payloads that tack on "Pvt Ltd" or a service code.
/// Returns null when nothing matches -- the event is still recorded.
export function matchCourier(name, partners = []) {
  const wanted = fold(name);
  if (!wanted) return null;
  const folded = partners.map(p => [fold(p.name), p]);
  return folded.find(([f]) => f === wanted)?.[1]
    ?? folded.find(([f]) => f && (f.includes(wanted) || wanted.includes(f)))?.[1]
    ?? null;
}

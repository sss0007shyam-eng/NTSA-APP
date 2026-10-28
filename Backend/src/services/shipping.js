import { db, atomic } from '../db.js';
import { requireThat } from '../lib/rules.js';
import { orderInclude, markDelivered } from './orders.js';
import { pushToUser } from './firebase.js';

// Couriers each name their statuses their own way ("Out For Delivery", "OFD",
// "Undelivered", "RTO Initiated"...). Everything is boiled down to a few of ours
// so the rest of the system only has to know these. Order matters: the specific
// phrases come before the general ones ("rto delivered" before "delivered").
const PATTERNS = [
  [/rto.*(deliver|receiv)|return(ed)?.*(received|delivered)/i, 'RTO_DELIVERED'],
  [/\brto\b|return to origin|returning to|return initiated/i, 'RTO_INITIATED'],
  [/out for delivery|\bofd\b/i, 'OUT_FOR_DELIVERY'],
  [/undeliver|not delivered|delivery (attempt )?failed|failed|attempt|not available|refused|unable to deliver|consignee/i, 'DELIVERY_FAILED'],
  [/\bdelivered\b/i, 'DELIVERED'],
  [/pick(ed)?[ -]?up|shipped|dispatch|manifest/i, 'PICKED_UP'],
  [/transit|reached|arrived|hub|departed|bagged|forwarded/i, 'IN_TRANSIT'],
];
export const normalizeStatus = text => PATTERNS.find(([re]) => re.test(String(text || '')))?.[1] ?? 'UPDATE';

const TITLES = {
  PICKED_UP: 'Picked up by the courier', IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_FAILED: 'Delivery attempt failed', DELIVERED: 'Delivered', RTO_INITIATED: 'Being returned to the seller',
  RTO_DELIVERED: 'Returned to the seller', ISSUE_REPORTED: 'Problem reported by the customer', UPDATE: 'Update',
};
// The order status each courier event moves an order to, and the only statuses
// it may move from -- the journey only ever goes forward.
const FORWARD = {
  PICKED_UP: { from: ['PACKED'], to: 'SHIPPED' }, IN_TRANSIT: { from: ['PACKED'], to: 'SHIPPED' },
  OUT_FOR_DELIVERY: { from: ['PACKED', 'SHIPPED'], to: 'OUT_FOR_DELIVERY' },
  DELIVERED: { from: ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'], to: 'DELIVERED' },
};
// What the customer is told, and which staff/sellers hear about it.
const CUSTOMER_PUSH = {
  PICKED_UP: ['Your order is on its way', 'The courier has picked up your order.'],
  OUT_FOR_DELIVERY: ['Out for delivery', 'Your order will be delivered today. Keep your phone handy for the delivery OTP.'],
  DELIVERED: ['Order delivered', 'Your order has been delivered. Not received it? Tell us in the app.'],
  DELIVERY_FAILED: ['We could not deliver your order', 'The courier could not reach you. Open the order to see what to do next.'],
  RTO_INITIATED: ['Your order is being returned', 'The delivery did not work out, so the parcel is going back. Support will contact you.'],
};
const STAFF_ALERT = { DELIVERY_FAILED: ['ADMIN', 'SUPPORT'], RTO_INITIATED: ['ADMIN', 'SUPPORT'], RTO_DELIVERED: ['ADMIN', 'SUPPORT'] };
const SELLER_ALERT = new Set(['OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'RTO_DELIVERED', 'ISSUE_REPORTED']);
const short = id => `#${id.slice(0, 10).toUpperCase()}`;

/// Writes one step of an order's journey, moves the order forward when the step
/// says it has moved, and tells everyone who needs to know. Safe to call twice
/// with the same `dedupeKey` (couriers resend): the second call changes nothing.
export async function recordShipmentEvent({ orderId, status, title, location, note, source, actorName, occurredAt, dedupeKey }) {
  let outcome;
  try {
    outcome = await atomic(async tx => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
      requireThat(order, 404, 'Order not found');
      if (dedupeKey && await tx.shipmentEvent.findUnique({ where: { dedupeKey } })) return { duplicate: true, order };
      await tx.shipmentEvent.create({ data: { orderId, status, title: title || TITLES[status] || 'Update', location: location || null, note: note || null, source, actorName: actorName || null, dedupeKey: dedupeKey || null, occurredAt: occurredAt || new Date() } });
      const rule = FORWARD[status];
      let updated = order, moved = false, anomaly = null;
      if (rule && rule.from.includes(order.status)) {
        updated = status === 'DELIVERED' ? await markDelivered(tx, order, occurredAt || new Date()) : await tx.order.update({ where: { id: orderId }, data: { status: rule.to }, include: orderInclude });
        moved = true;
      } else if (rule && ['PENDING_PAYMENT', 'PLACED', 'CANCELLED'].includes(order.status)) {
        // The courier is moving an order nobody has packed, or one that was cancelled. (A late
        // webhook arriving out of order is normal and not flagged.)
        anomaly = `the courier reported "${(title || TITLES[status]).toLowerCase()}" but the order is ${order.status.toLowerCase().replaceAll('_', ' ')}`;
      }
      return { order: updated, moved, anomaly };
    });
  } catch (e) {
    if (e.code === 'P2002') return { duplicate: true }; // two identical webhooks at once
    throw e;
  }
  if (outcome.duplicate) return { duplicate: true };
  const { order, moved, anomaly } = outcome;
  await tellEveryone({ order, status, moved, anomaly, title: title || TITLES[status] });
  return { duplicate: false, order };
}

async function tellEveryone({ order, status, moved, anomaly, title }) {
  const note = (audience, type, head, body) => db.notification.create({ data: { audience, type, title: head, body, entityId: order.id } }).catch(() => {});
  const jobs = [];
  const push = CUSTOMER_PUSH[status];
  // A step that moved the order, or one the customer must hear about regardless.
  if (push && order.userId && (moved || status === 'DELIVERY_FAILED' || status === 'RTO_INITIATED')) {
    jobs.push(db.user.findUnique({ where: { id: order.userId } }).then(u => pushToUser(u, { title: push[0], body: push[1], data: { orderId: order.id } })));
  }
  for (const audience of STAFF_ALERT[status] || []) jobs.push(note(audience, 'DELIVERY_UPDATE', `${title}: order ${short(order.id)}`, `${order.courierName ? `${order.courierName} ` : ''}${order.trackingNumber ? `AWB ${order.trackingNumber}. ` : ''}Check the order and contact the delivery team if needed.`));
  if (anomaly) jobs.push(note('ADMIN', 'DELIVERY_ANOMALY', `Check order ${short(order.id)}`, `For order ${short(order.id)}: ${anomaly}.`));
  if (SELLER_ALERT.has(status)) {
    for (const sellerId of new Set(order.items.map(i => i.sellerId).filter(Boolean))) jobs.push(note(`SELLER:${sellerId}`, status, `${title}: order ${short(order.id)}`, `Your item(s) in order ${short(order.id)}: ${title.toLowerCase()}.`));
  }
  await Promise.all(jobs);
}

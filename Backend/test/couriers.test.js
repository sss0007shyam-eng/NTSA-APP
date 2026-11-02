// HTTP tests for the admin-managed courier partners: who may change the list,
// what a tracking template must look like, and the point of the whole feature
// -- that editing one courier's template re-points every order it carries.
//
// Runs against the `ntsa_test` database, never the live one. The URL is
// switched over, and the webhook secret set, before anything reads the config
// (dotenv doesn't overwrite what's already in process.env).
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import request from 'supertest';

process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/ntsa(\?|$)/, '/ntsa_test$1');
process.env.COURIER_WEBHOOK_SECRET ||= 'test-courier-webhook-secret';

const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { tokenFor } = await import('../src/services/auth.js');

const TAG = 'courier-test';
const unique = what => `${TAG}-${what}-${Date.now()}`;

// Two panel logins: the admin owns the courier list, support only books with it.
const [adminAccount, supportAccount] = await Promise.all([
  db.admin.create({ data: { email: `${unique('admin')}@ntsa.local`, passwordHash: 'x', role: 'ADMIN', name: 'Courier Test Admin' } }),
  db.admin.create({ data: { email: `${unique('support')}@ntsa.local`, passwordHash: 'x', role: 'SUPPORT', name: 'Courier Test Support' } }),
]);
const asAdmin = tokenFor('ADMIN', adminAccount);
const asSupport = tokenFor('SUPPORT', supportAccount);
const created = [];

/** An order far enough along to have a courier booked on it. */
async function makeOrder() {
  const order = await db.order.create({ data: {
    status: 'PACKED', totalPaise: 100000, paymentMethod: 'COD', checkoutKey: crypto.randomUUID(),
    address: { name: 'Test Buyer', phone: '9876500000', line1: '1 Test Road', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001' },
  } });
  created.push(() => db.order.delete({ where: { id: order.id } }).catch(() => {}));
  return order;
}
/** POSTs a courier as the admin and remembers it for cleanup. */
async function addCourier(body) {
  const res = await request(app).post('/api/admin/couriers').set('Authorization', `Bearer ${asAdmin}`).send(body);
  if (res.status === 201) created.push(() => db.courierPartner.delete({ where: { id: res.body.id } }).catch(() => {}));
  return res;
}

test.after(async () => {
  for (const undo of created.reverse()) await undo();
  await db.shipmentEvent.deleteMany({ where: { actorName: { contains: 'Courier Test' } } });
  await db.admin.deleteMany({ where: { id: { in: [adminAccount.id, supportAccount.id] } } });
  await db.$disconnect();
});

test('only the admin may change the courier list; support may read it', async () => {
  const refused = await request(app).get('/api/admin/couriers').set('Authorization', `Bearer ${asSupport}`);
  assert.equal(refused.status, 403);
  const allowed = await request(app).get('/api/support/couriers').set('Authorization', `Bearer ${asSupport}`);
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(allowed.body));
});

test('a tracking template must be HTTPS and must contain the {awb} placeholder', async () => {
  const noPlaceholder = await addCourier({ name: unique('noawb'), trackingUrlTemplate: 'https://example.com/track' });
  assert.equal(noPlaceholder.status, 400);
  assert.match(noPlaceholder.body.error, /\{awb\}/);
  const insecure = await addCourier({ name: unique('http'), trackingUrlTemplate: 'http://example.com/track/{awb}' });
  assert.equal(insecure.status, 400);
  assert.match(insecure.body.error, /HTTPS/i);
});

test('exactly one courier is the one offered first', async () => {
  const first = await addCourier({ name: unique('first'), trackingUrlTemplate: 'https://first.example.com/{awb}', isDefault: true });
  assert.equal(first.status, 201);
  const second = await addCourier({ name: unique('second'), trackingUrlTemplate: 'https://second.example.com/{awb}', isDefault: true });
  assert.equal(second.status, 201);
  assert.equal((await db.courierPartner.findUnique({ where: { id: first.body.id } })).isDefault, false);
  assert.equal((await db.courierPartner.findUnique({ where: { id: second.body.id } })).isDefault, true);
  // Switching a courier off can't leave it as the one the panel offers first.
  const off = await request(app).put(`/api/admin/couriers/${second.body.id}`).set('Authorization', `Bearer ${asAdmin}`).send({ active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.isDefault, false);
});

test('editing one courier’s template re-points every order it carries', async () => {
  const courier = await addCourier({ name: unique('switch'), trackingUrlTemplate: 'https://old.example.com/track/{awb}' });
  assert.equal(courier.status, 201);
  const order = await makeOrder();

  // Support books the shipment by picking the courier, not typing a name.
  const booked = await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ courierId: courier.body.id, trackingNumber: 'AWB10001' });
  assert.equal(booked.status, 200);
  assert.equal(booked.body.courierName, courier.body.name); // the name it was booked under
  assert.equal(booked.body.trackingUrl, 'https://old.example.com/track/AWB10001');

  // The client's actual ask: one edit here, and the order's link follows.
  const moved = await request(app).put(`/api/admin/couriers/${courier.body.id}`).set('Authorization', `Bearer ${asAdmin}`)
    .send({ trackingUrlTemplate: 'https://new-courier.example.com/p/{awb}' });
  assert.equal(moved.status, 200);
  const after = await request(app).get(`/api/support/orders/${order.id}`).set('Authorization', `Bearer ${asSupport}`);
  assert.equal(after.body.trackingUrl, 'https://new-courier.example.com/p/AWB10001');
  // Nothing was written onto the order itself -- the link is worked out on read.
  assert.equal((await db.order.findUnique({ where: { id: order.id } })).trackingUrl, null);
});

test('a link typed on the order overrides the courier’s template', async () => {
  const courier = await addCourier({ name: unique('override'), trackingUrlTemplate: 'https://partner.example.com/{awb}' });
  const order = await makeOrder();
  const booked = await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ courierId: courier.body.id, trackingNumber: 'AWB20002', trackingUrl: 'https://one-off.example.com/consignment/9' });
  assert.equal(booked.status, 200);
  assert.equal(booked.body.trackingUrl, 'https://one-off.example.com/consignment/9');
});

test('a courier that is not set up can still be booked by name', async () => {
  const order = await makeOrder();
  const booked = await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ courierName: 'Bhiwadi Local Transport', trackingNumber: 'AWB30003' });
  assert.equal(booked.status, 200);
  assert.equal(booked.body.courierName, 'Bhiwadi Local Transport');
  assert.equal(booked.body.trackingUrl, null); // no template to build one from
  // ...but something has to identify the courier.
  const nothing = await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ trackingNumber: 'AWB30004' });
  assert.equal(nothing.status, 400);
});

test('the webhook resolves the courier’s own spelling, and a renamed partner still matches', async () => {
  const courier = await addCourier({ name: `${TAG} Ecom Express`, trackingUrlTemplate: 'https://ecom.example.com/{awb}' });
  const order = await makeOrder();
  const awb = `AWB4${Date.now()}`;
  // Booked by typing the name, so the order starts with no partner linked.
  await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ courierName: 'Ecom', trackingNumber: awb });
  assert.equal((await db.order.findUnique({ where: { id: order.id } })).courierPartnerId, null);

  // The courier posts its own spelling: punctuation and spacing don't matter.
  const hook = await request(app).post('/api/webhooks/courier').set('x-webhook-secret', process.env.COURIER_WEBHOOK_SECRET)
    .send({ awb, status: 'In Transit', location: 'Jaipur Hub', courier: `${TAG}-ecom-express` });
  assert.equal(hook.status, 200);
  assert.equal(hook.body.courier, courier.body.name);
  // Resolving it also links the order, so its Track link starts working.
  const linked = await db.order.findUnique({ where: { id: order.id } });
  assert.equal(linked.courierPartnerId, courier.body.id);
  assert.equal((await request(app).get(`/api/support/orders/${order.id}`).set('Authorization', `Bearer ${asSupport}`)).body.trackingUrl, `https://ecom.example.com/${awb}`);

  // The admin renames the partner; the courier keeps sending the old name, and
  // it still resolves to the same row rather than falling through unmatched.
  await request(app).put(`/api/admin/couriers/${courier.body.id}`).set('Authorization', `Bearer ${asAdmin}`).send({ name: `${TAG} Ecom Express Logistics` });
  const again = await request(app).post('/api/webhooks/courier').set('x-webhook-secret', process.env.COURIER_WEBHOOK_SECRET)
    .send({ awb, status: 'Out For Delivery', courier: `${TAG} ecom express` });
  assert.equal(again.status, 200);
  assert.equal(again.body.courier, `${TAG} Ecom Express Logistics`);
});

test('removing a courier leaves its orders readable', async () => {
  const courier = await addCourier({ name: unique('gone'), trackingUrlTemplate: 'https://gone.example.com/{awb}' });
  const order = await makeOrder();
  await request(app).put(`/api/support/orders/${order.id}/tracking`).set('Authorization', `Bearer ${asSupport}`)
    .send({ courierId: courier.body.id, trackingNumber: 'AWB50005' });
  assert.equal((await request(app).delete(`/api/admin/couriers/${courier.body.id}`).set('Authorization', `Bearer ${asAdmin}`)).status, 204);
  const after = await request(app).get(`/api/support/orders/${order.id}`).set('Authorization', `Bearer ${asSupport}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.courierName, courier.body.name); // the name survives
  assert.equal(after.body.trackingUrl, null); // nothing left to build a link from
});

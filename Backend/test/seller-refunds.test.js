// What a seller may see of the returns on their own items, over HTTP.
//
// The point of these tests is the scoping, not the happy path: two shops have
// a line each in the SAME order, and a return is raised against each. A seller
// panel that leaked the other shop's return would still pass a happy-path
// test, so every assertion here is about what must NOT come back.
//
// Runs against the `ntsa_test` database, never the live one -- the URL is
// switched over before anything reads the config (dotenv doesn't overwrite
// what's already in process.env).
import 'dotenv/config';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/ntsa_test';
process.env.DATABASE_URL = url.toString();
process.env.DEMO_MODE = 'true';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { tokenFor } from '../src/services/auth.js';

const TAG = `refunds-test-${randomBytes(4).toString('hex')}`;
const HOUR = 3600000;

/** A shop with one product on the shelf. */
async function freshSeller(shopName) {
  const seller = await db.seller.create({ data: {
    shopName: `${TAG} ${shopName}`, ownerName: 'Test Owner', username: `${TAG}-${shopName}`,
    phone: '9876543210', passwordHash: 'x',
  } });
  const product = await db.product.create({ data: {
    name: `${TAG} ${shopName} product`, description: 'Test stock', pricePaise: 50000, wholesalePaise: 40000,
    stock: 10, categoryId: category.id, sellerId: seller.id, images: ['https://example.com/a.jpg'],
  } });
  return { seller, product, token: tokenFor('SELLER', seller) };
}

const category = await db.category.create({ data: { name: `${TAG} category`, refundWindowHours: 48 } });
const [shopA, shopB] = await Promise.all([freshSeller('alpha'), freshSeller('beta')]);
const customer = await db.user.create({ data: { firebaseUid: `${TAG}-uid`, name: 'Test Buyer', phone: '9876500000' } });
const asCustomer = tokenFor('CUSTOMER', customer);

/** One delivered order carrying a line from each shop, both still returnable. */
async function mixedOrder() {
  const deliveredAt = new Date();
  const line = (shop, qty) => ({
    productId: shop.product.id, name: shop.product.name, quantity: qty, unitPaise: 50000,
    sellerId: shop.seller.id, refundWindowHours: 48, refundEligible: true,
    refundExpiresAt: new Date(deliveredAt.getTime() + 48 * HOUR),
  });
  return db.order.create({
    data: {
      userId: customer.id, status: 'DELIVERED', deliveredAt, refundEligible: true,
      totalPaise: 150000, paymentMethod: 'COD', checkoutKey: randomUUID(),
      address: { name: 'Test Buyer', phone: '9876500000', line1: '1 Test Road', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001' },
      items: { create: [line(shopA, 1), line(shopB, 2)] },
    },
    include: { items: true },
  });
}
const sellerRefunds = token => request(app).get('/api/seller/refunds').set('Authorization', `Bearer ${token}`);

const order = await mixedOrder();
const lineA = order.items.find(i => i.sellerId === shopA.seller.id);
const lineB = order.items.find(i => i.sellerId === shopB.seller.id);

test.after(async () => {
  await db.notification.deleteMany({ where: { audience: { in: [`SELLER:${shopA.seller.id}`, `SELLER:${shopB.seller.id}`] } } });
  await db.refund.deleteMany({ where: { orderItem: { orderId: order.id } } });
  await db.orderItem.deleteMany({ where: { orderId: order.id } });
  await db.order.delete({ where: { id: order.id } });
  await db.product.deleteMany({ where: { id: { in: [shopA.product.id, shopB.product.id] } } });
  await db.seller.deleteMany({ where: { id: { in: [shopA.seller.id, shopB.seller.id] } } });
  await db.user.delete({ where: { id: customer.id } });
  await db.category.delete({ where: { id: category.id } });
  await db.$disconnect();
});

test('a shop with nothing returned sees an empty list, not everyone else’s returns', async () => {
  const res = await sellerRefunds(shopA.token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('the customer’s return request tells that one shop, and only that shop', async () => {
  const asked = await request(app).post(`/api/orders/${order.id}/refunds`).set('Authorization', `Bearer ${asCustomer}`)
    .send({ itemId: lineA.id, reason: 'Arrived with a cracked screen' });
  assert.equal(asked.status, 201);
  assert.equal(asked.body.status, 'REQUESTED');

  const mine = await db.notification.findMany({ where: { audience: `SELLER:${shopA.seller.id}` } });
  assert.equal(mine.length, 1, 'the shop whose item is coming back should be told once');
  assert.equal(mine[0].type, 'REFUND_REQUESTED');
  assert.equal(mine[0].entityId, order.id, 'the alert should point at the order it is about');
  assert.match(mine[0].body, /cracked screen/);
  // The other shop has a line in the same order and must hear nothing.
  assert.equal(await db.notification.count({ where: { audience: `SELLER:${shopB.seller.id}` } }), 0);
});

test('each shop sees its own return and no trace of the other’s', async () => {
  // Shop B's own return on its line of the same order, so both exist at once.
  await db.refund.create({ data: { orderItemId: lineB.id, reason: 'Wrong size sent' } });

  const a = await sellerRefunds(shopA.token);
  assert.equal(a.status, 200);
  assert.equal(a.body.length, 1);
  assert.equal(a.body[0].orderItemId, lineA.id);
  assert.equal(a.body[0].reason, 'Arrived with a cracked screen');
  assert.equal(a.body[0].name, shopA.product.name);
  assert.equal(a.body[0].amountPaise, 50000); // 1 x 500.00
  assert.equal(a.body[0].buyerName, 'Test Buyer');
  assert.equal(a.body[0].status, 'REQUESTED');

  const b = await sellerRefunds(shopB.token);
  assert.equal(b.body.length, 1);
  assert.equal(b.body[0].orderItemId, lineB.id);
  assert.equal(b.body[0].amountPaise, 100000); // 2 x 500.00

  // Nothing of the other shop anywhere in the payload -- not its name, not its
  // id, not its line, not its reason. Checked against the raw response text so
  // a field added later can't quietly smuggle one of them through.
  const aText = JSON.stringify(a.body), bText = JSON.stringify(b.body);
  for (const leak of [shopB.seller.id, shopB.product.id, shopB.product.name, lineB.id, 'Wrong size sent']) {
    assert.ok(!aText.includes(leak), `shop A's returns leaked ${leak}`);
  }
  for (const leak of [shopA.seller.id, shopA.product.id, shopA.product.name, lineA.id, 'cracked screen']) {
    assert.ok(!bText.includes(leak), `shop B's returns leaked ${leak}`);
  }
});

test('a decision made by NTSA shows up on the seller’s copy', async () => {
  const { reviewRefund } = await import('../src/services/orders.js');
  const refund = await db.refund.findUnique({ where: { orderItemId: lineB.id } });
  // Rejected rather than approved: approving credits a wallet, which is the
  // admin refund flow's business and not what this is checking.
  await reviewRefund(refund.id, 'REJECTED');
  const b = await sellerRefunds(shopB.token);
  assert.equal(b.body[0].status, 'REJECTED');
  assert.ok(b.body[0].reviewedAt, 'the seller should see when it was decided');
});

test('the returns list is seller-only -- the customer whose return it is cannot read it', async () => {
  const refused = await sellerRefunds(asCustomer);
  assert.equal(refused.status, 403);
  const anonymous = await request(app).get('/api/seller/refunds');
  assert.equal(anonymous.status, 401);
});

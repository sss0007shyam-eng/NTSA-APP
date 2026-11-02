// The shopping assistant, both halves: the sentence parser on its own (pure,
// no database) and then the real endpoint, which has to obey the same
// storefront rules as the product list.
//
// Runs against the `ntsa_test` database, never the live one -- the URL is
// switched over before anything reads the config (dotenv doesn't overwrite
// what's already in process.env).
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import request from 'supertest';
import { parseShopQuery, describeQuery, formatRupees, pickResults } from '../src/lib/shopQuery.js';

const CATEGORIES = [
  { id: 'cat-fashion', name: 'Fashion' }, { id: 'cat-mobiles', name: 'Mobiles' },
  { id: 'cat-sports', name: 'Sports' }, { id: 'cat-books', name: 'Books' },
  { id: 'cat-appliances', name: 'Appliances' },
];
const read = q => parseShopQuery(q, CATEGORIES);

test("the client's own example reads as white shoes under 1500", () => {
  const p = read('mujhe white jute lene hain aur 1500 ka mera budget hai');
  assert.equal(p.color, 'White');
  assert.equal(p.item.label, 'Shoes');
  assert.equal(p.maxRupees, 1500);
  assert.equal(p.minRupees, null);
  // Nothing from the price phrase may survive as a keyword, or the catalog
  // would be searched for the text "1500".
  assert.deepEqual(p.keywords, []);
  assert.equal(describeQuery(p), 'White · Shoes · under ₹1,500');
});

test('Hindi and Hinglish words for everyday things', () => {
  assert.equal(read('joote dikhao').item.label, 'Shoes');
  assert.equal(read('mujhe jutte chahiye').item.label, 'Shoes');
  assert.equal(read('kapde chahiye').categoryName, 'Fashion');
  assert.equal(read('ek mobile chahiye').categoryName, 'Mobiles');
  assert.equal(read('phone dikha do').item.label, 'Mobile');
  assert.equal(read('mujhe ghadi leni hai').item.label, 'Watch');
  assert.equal(read('kitab chahiye').categoryName, 'Books');
  assert.equal(read('safed kurta').color, 'White');
  assert.equal(read('kala bag').color, 'Black');
  assert.equal(read('laal chappal').item.label, 'Slippers');
});

test('the many ways an Indian shopper says an amount', () => {
  assert.equal(read('shoes under 2000').maxRupees, 2000);
  assert.equal(read('joote ₹1500 tak').maxRupees, 1500);
  assert.equal(read('2 hazaar se kam ka mobile').maxRupees, 2000);
  assert.equal(read('do hazaar se kam ke joote').maxRupees, 2000);
  assert.equal(read('1500 ke andar jute').maxRupees, 1500);
  assert.equal(read('watch upto 999').maxRupees, 999);
  assert.equal(read('bag 1200 rupees').maxRupees, 1200);
  assert.equal(read('mera budget 2500 hai, shoes dikhao').maxRupees, 2500);
  assert.equal(read('ek lakh ke andar sofa').maxRupees, 100000);
  const between = read('500 se 1500 ke beech headphones');
  assert.deepEqual([between.minRupees, between.maxRupees], [500, 1500]);
  const english = read('headphones between 500 and 2000');
  assert.deepEqual([english.minRupees, english.maxRupees], [500, 2000]);
  const floor = read('shoes above 1000');
  assert.deepEqual([floor.minRupees, floor.maxRupees], [1000, null]);
  assert.equal(read('5000 se zyada ka mobile').minRupees, 5000);
});

test('a number that is plainly not money is left alone', () => {
  // A model number, and a shoe size -- reading either as a budget would hide
  // every product the shopper actually wants.
  const phone = read('iphone 13 dikhao');
  assert.equal(phone.maxRupees, null);
  assert.ok(phone.keywords.includes('iphone'));
  assert.equal(read('jute size 8 ka').maxRupees, null);
});

test('a sentence with nothing recognisable still yields its own words', () => {
  const p = read('xyzzy plutonium reactor');
  assert.equal(p.color, null);
  assert.equal(p.item, null);
  assert.equal(p.categoryName, null);
  assert.deepEqual(p.keywords, ['xyzzy', 'plutonium', 'reactor']);
});

test('amounts are written the way India writes them', () => {
  assert.equal(formatRupees(999), '₹999');
  assert.equal(formatRupees(1500), '₹1,500');
  assert.equal(formatRupees(100000), '₹1,00,000');
  assert.equal(formatRupees(12500000), '₹1,25,00,000');
});

test('one constraint at a time is loosened, and it says which', () => {
  const parsed = read('white jute under 1500');
  const whiteCheap = { id: 'a', name: 'Canvas Shoes', description: '', pricePaise: 99900, stock: 5, colors: ['White'], categoryId: 'cat-sports' };
  const blackCheap = { id: 'b', name: 'Canvas Shoes', description: '', pricePaise: 89900, stock: 5, colors: ['Black'], categoryId: 'cat-sports' };
  const whiteDear = { id: 'c', name: 'Running Shoes', description: '', pricePaise: 299900, stock: 5, colors: ['White'], categoryId: 'cat-sports' };
  const blackDear = { id: 'd', name: 'Running Shoes', description: '', pricePaise: 259900, stock: 5, colors: ['Black'], categoryId: 'cat-sports' };

  const exact = pickResults([whiteCheap, blackCheap, whiteDear], parsed);
  assert.equal(exact.relaxed, null);
  assert.deepEqual(exact.products.map(p => p.id), ['a']);

  const noWhite = pickResults([blackCheap, whiteDear], parsed);
  assert.equal(noWhite.relaxed, 'color');
  assert.deepEqual(noWhite.products.map(p => p.id), ['b']);

  // Nothing inside the budget in that colour: the nearest above it, cheapest
  // first, rather than an empty screen.
  const overBudget = pickResults([whiteDear, blackDear], parsed);
  assert.equal(overBudget.relaxed, 'budget');
  assert.deepEqual(overBudget.products.map(p => p.id), ['c']);

  assert.deepEqual(pickResults([], parsed), { relaxed: 'none', products: [] });
});

test('what is in stock is offered before what is not', () => {
  const parsed = read('jute');
  const gone = { id: 'gone', name: 'Canvas Shoes', description: '', pricePaise: 50000, stock: 0, colors: [] };
  const here = { id: 'here', name: 'Shoes', description: '', pricePaise: 80000, stock: 3, colors: [] };
  assert.deepEqual(pickResults([gone, here], parsed).products.map(p => p.id), ['here', 'gone']);
});

// ---------------------------------------------------------------------------
// The endpoint.
process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/ntsa(\?|$)/, '/ntsa_test$1');
const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');

const TAG = 'assistant-test';
const created = [];
const category = await db.category.upsert({ where: { name: 'Sports' }, update: {}, create: { name: 'Sports', icon: 'sports' } });

/** A shoe in the test catalog. Everything defaults to a shop-visible product. */
async function addShoe(name, pricePaise, extra = {}) {
  const product = await db.product.create({ data: {
    name: `${TAG} ${name}`, description: 'A test shoe for the shopping assistant.', categoryId: category.id,
    pricePaise, wholesalePaise: Math.round(pricePaise * 0.6), mrpPaise: pricePaise * 2, stock: 10,
    images: [], colors: ['White', 'Black'], audience: 'RETAIL', ...extra,
  } });
  created.push(() => db.product.delete({ where: { id: product.id } }).catch(() => {}));
  return product;
}

const ask = query => request(app).post('/api/products/assist').send({ query });

const [cheapWhite, dearWhite, blackOnly] = await Promise.all([
  addShoe('Canvas Shoes', 99900),
  addShoe('Running Shoes', 299900),
  addShoe('Formal Shoes', 79900, { colors: ['Black'] }),
]);
// Must never show in the shopping app, however well they match the sentence.
const hidden = await Promise.all([
  addShoe('Dealer Lot Shoes', 49900, { audience: 'WHOLESALE' }),
  addShoe('Retired Shoes', 59900, { active: false }),
]);

test.after(async () => {
  for (const undo of created.reverse()) await undo();
  await db.$disconnect();
});

test("the client's example returns real white shoes inside the budget", async () => {
  const res = await ask('mujhe white jute lene hain aur 1500 ka mera budget hai');
  assert.equal(res.status, 200);
  assert.equal(res.body.summary, 'White · Shoes · under ₹1,500');
  assert.deepEqual(res.body.understood, { color: 'White', item: 'Shoes', category: null, minRupees: null, maxRupees: 1500, keywords: [] });
  assert.equal(res.body.relaxed, null);
  const ids = res.body.products.map(p => p.id);
  assert.ok(ids.includes(cheapWhite.id), 'the ₹999 white shoe should be there');
  assert.ok(!ids.includes(dearWhite.id), 'the ₹2,999 shoe is over the budget');
  assert.ok(!ids.includes(blackOnly.id), 'that one does not come in white');
});

test('wholesale-only and switched-off products never reach a shopper', async () => {
  const res = await ask('jute dikhao');
  const ids = res.body.products.map(p => p.id);
  for (const p of hidden) assert.ok(!ids.includes(p.id), `${p.name} must stay out of the shop`);
  // And no shopper response may carry a dealer price.
  for (const row of res.body.products) assert.equal(row.wholesalePaise, undefined);
  assert.ok(res.body.products.every(p => p.sizePrices == null || Object.values(p.sizePrices).every(o => o.wholesalePaise === undefined)));
});

test('nothing inside the budget offers the nearest above it, and says so', async () => {
  // ₹500 buys no shoes at all, so the answer has to be the cheapest ones
  // above it rather than an empty screen.
  const res = await ask('white jute 500 tak');
  assert.equal(res.status, 200);
  assert.equal(res.body.summary, 'White · Shoes · under ₹500');
  assert.equal(res.body.relaxed, 'budget');
  const prices = res.body.products.map(p => p.pricePaise);
  assert.ok(res.body.products.length, 'expected the nearest matches above budget');
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'cheapest first');
  assert.ok(res.body.products.map(p => p.id).includes(cheapWhite.id));
});

test('a colour nobody stocks falls back to the other colours', async () => {
  const res = await ask(`${TAG} Formal gulabi jute 1000 tak`);
  assert.equal(res.body.relaxed, 'color');
  assert.equal(res.body.products[0].id, blackOnly.id);
  assert.ok(res.body.products.every(p => p.pricePaise <= 100000), 'the budget is still honoured');
});

test('a sentence matching nothing says nothing matched', async () => {
  const res = await ask('mujhe ek zzzqwertynotathing chahiye');
  assert.equal(res.status, 200);
  assert.equal(res.body.relaxed, 'none');
  assert.deepEqual(res.body.products, []);
});

test('an empty sentence is refused', async () => {
  assert.equal((await ask('   ')).status, 400);
});

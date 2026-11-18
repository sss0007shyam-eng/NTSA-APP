// One-off: wipe the demo / test contents from the database so the shop starts
// empty for launch, while KEEPING the admin login and all configuration.
//
//   KEPT   : admins, categories, courier_partners, settings, delivery_rules,
//            blocked_pincodes, blocked_areas, banners, coupons, panel_pages
//   WIPED  : products, orders (+ items, events, refunds), users (+ addresses,
//            wallets, carts, wishlists, reviews), vendors, sellers (+ their
//            devices/challenges/penalties/applications), support tickets,
//            notifications, verification checks
//
// Safe by default: it only PRINTS what it would remove. It deletes only when
// run with CONFIRM=YES, e.g.  CONFIRM=YES node prisma/clean-demo.js
// The deletes run inside one transaction, in child->parent order, so a wrong
// order would roll back and change nothing rather than leave a half-wiped DB.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Child tables before their parents (foreign-key safe).
const WIPE = [
  'walletTransaction', 'wallet', 'refund', 'shipmentEvent', 'orderItem',
  'supportTicket', 'order', 'review', 'wishlist', 'cartItem', 'address',
  'verificationCheck', 'sellerLoginChallenge', 'sellerDevice', 'sellerPenalty',
  'product', 'seller', 'sellerApplication', 'vendorMessage', 'vendorLimit',
  'vendor', 'notification', 'user',
];

const KEEP = [
  'admin', 'category', 'courierPartner', 'settings', 'deliveryRule',
  'blockedPincode', 'blockedArea', 'banner', 'coupon', 'panelPage',
];

try {
  console.log('\n--- Will DELETE (demo/test data) ---');
  let total = 0;
  for (const m of WIPE) {
    const n = await db[m].count();
    total += n;
    if (n) console.log(`  ${m.padEnd(22)} ${n}`);
  }
  console.log(`  TOTAL rows to delete: ${total}`);

  console.log('\n--- Will KEEP (config/admin) ---');
  for (const m of KEEP) {
    const n = await db[m].count();
    console.log(`  ${m.padEnd(22)} ${n}`);
  }

  if (process.env.CONFIRM !== 'YES') {
    console.log('\nDRY RUN only -- nothing was deleted.');
    console.log('To actually delete, run:  CONFIRM=YES node prisma/clean-demo.js\n');
  } else {
    await db.$transaction(WIPE.map((m) => db[m].deleteMany()));
    console.log('\nDONE -- demo/test data deleted. Admin and config were preserved.\n');
  }
} finally {
  await db.$disconnect();
}

# NTSA Project — Handoff Notes

Read this first if you're picking up work on this project on a different machine. It covers what's been built, what's deployed, and gotchas specific to this project's setup.

## What this project is

NTSA is an e-commerce app: a Flutter customer app (Android, also has a wholesale-buyer portal built into the same app), a React (Vite) admin/vendor web panel, and a Node/Express/Prisma/PostgreSQL backend. Brand colors: navy `#13224A`, orange `#F5841F`. Tagline: "Shop Smarter, Live Better."

## Repo & deployment status

- **GitHub**: `https://github.com/chaturbhuj9166/E-Commerce-App-New.git`, branch `main`. Currently **public** — consider making it private since it's a client project.
- **Render — Backend** (web service): `https://e-commerce-app-new-gmgz.onrender.com`
  - Build command: `npm install && npx prisma generate && npx prisma db push && node prisma/seed.js`
  - Start command: `npm start`
  - Root directory: `Backend`
- **Render — Admin panel** (static site): `https://e-commerce-app-new-1.onrender.com`
  - Build command: `npm install && npm run build`
  - Publish directory: `dist`
  - Root directory: `Frontend/web`
- **Render — Postgres**: free tier, **expires 2026-10-19** unless upgraded. Region: Virginia (US East) — keep any new Render service in the same region if it needs the *internal* database URL.

Both Render services auto-deploy on every push to `main`.

## Environment variables

Real values live in `Backend/.env` (gitignored — never committed). If you're on a new machine, copy that file over manually (USB, not chat/email). Required keys: `DATABASE_URL`, `JWT_SECRET`, `DEMO_MODE`, `NODE_ENV`, `CORS_ORIGIN`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `Backend/.env.example` has the full list with blanks.

On Render, these are set separately per-service in each service's Environment tab (Render never reads the repo's `.env`).

`DEMO_MODE=true` + `NODE_ENV=development` are intentional — this app has no real Firebase phone-OTP login or real Razorpay payments wired in yet (see "What's NOT done" below). Setting `NODE_ENV=production` while `DEMO_MODE=true` makes the backend refuse to start (`Backend/src/config.js`), by design.

## Courier tracking: what to set up with the delivery company

NTSA does not deliver with its own riders — an outside courier does. **Which
courier, and the link each one is tracked on, is admin-managed** (panel →
**Couriers**): there is no code change in switching delivery company, and no
courier name typed per order.

### The Couriers screen (admin only)

Each row is a `CourierPartner`: a display name, a **tracking URL template** with
`{awb}` where the tracking number goes (e.g.
`https://www.delhivery.com/track/package/{awb}`), optional contact phone/email
for that courier's own support desk, `active`, and a flag for the one the panel
offers first. HTTPS only, and the `{awb}` placeholder is required
(`lib/validation.js`) — without it a template would quietly link every order to
the courier's homepage.

The template is what makes the one-place change work: an order's Track link is
**built from the template every time the order is read** (`lib/courier.js`
`trackingLinkFor()`), never frozen onto the order. Fix a courier's link, or move
to a different courier's portal, and every order that courier is carrying follows
— customer app, seller panel, support, admin.

- `/admin/couriers` (GET/POST/PUT/DELETE) is admin-only; support reads the list
  through `GET /support/couriers` to fill its dropdown but cannot change it.
- Booking a shipment (`PUT /support/orders/:id/tracking`) normally sends
  `courierId`. The partner's name is copied onto the order as `courierName` — the
  name it was booked under — so order history still reads correctly after the
  partner is renamed or removed.
- **Per-order `trackingUrl` is still accepted, as an override only.** It's the
  escape hatch for a one-off link the template can't build; left empty (the normal
  case) the partner's template is used. `courierName` on its own is also still
  accepted, for a courier nobody has set up yet.
- Removing a courier clears the link on its past orders (`onDelete: SetNull`) and
  leaves the name — order history never goes blank.
- `prisma/seed.js` seeds Delhivery, Shiprocket, Ecom Express and XpressBees as a
  starting point, only when the table is empty. Verify each link against the
  courier's current tracking page before relying on it.

### The webhook

1. Set `COURIER_WEBHOOK_SECRET` in the Backend's environment (any random string of
   16+ characters). Leave it unset and the webhook route returns 404, which is the
   safe default.
2. Give the courier this endpoint: `POST https://<backend>/api/webhooks/courier`,
   with the header `x-webhook-secret: <that secret>` and a JSON body:
   `{ "awb": "...", "status": "Out For Delivery", "location": "Jaipur Hub",
   "remarks": "...", "timestamp": "2026-10-28T10:00:00Z", "courier": "Delhivery" }`.
   Most couriers can't send that shape as-is, so a small adapter (a tiny serverless
   function, or a few lines in `routes.js`) maps their payload onto those fields.
3. `status` is free text: `services/shipping.js` normalises each courier's own
   wording ("OFD", "Undelivered", "RTO Initiated"...) onto our own statuses. A
   status it does not recognise is still recorded, just as a plain update — check
   `PATTERNS` there when onboarding a new courier.
4. `courier` is matched against the configured partners rather than trusted as-is,
   with spacing and punctuation ignored (`matchCourier()` in `lib/courier.js`), so
   "ecom-express" and a partner the admin has since **renamed** both still resolve.
   When it resolves and the order had no partner linked (booked by typing a name),
   the order is linked then and there, so its Track link starts working.
5. Unknown AWBs get a 202 (so the courier stops retrying), and the same event sent
   twice is stored once. A late, out-of-order webhook can never un-deliver an order.
6. The admin/support panel can do all of this by hand (courier + AWB, and "Add
   update") for a courier with no webhook at all.

Delivery OTP: right now the Backend still generates its own OTP, which the
customer shows the rider. Most couriers send their own OTP instead — once a real
courier is signed up, decide which one is in charge and turn the other off.

## GST / Aadhaar verification: what is real and what is not

The admin panel has always had `gstVerified` / `aadharVerified` tick-boxes on
a seller and on a wholesale partner. Those stay, and they mean exactly one
thing: **an admin looked at the document**. Beside them there is now a
**"Verify from portal"** button, which is the separate, dated record of what a
government portal actually said.

### GST — real, but it needs a paid key

- `GST_VERIFY_API_KEY` in the Backend environment switches the button on.
  **Left blank the button still works and still records the attempt**, with
  the outcome `UNAVAILABLE` and a sentence telling the admin no provider is
  configured. It never shows a tick for a check that did not happen.
- There is **no free GSTN endpoint**. The government portal's own taxpayer
  search is a captcha'd web form, and `api.gst.gov.in` is reachable only
  through a licensed GST Suvidha Provider (GSP). The realistic route for NTSA
  is a reseller fronting a GSP, billed roughly Rs 0.40-0.80 per lookup.
  `services/verification.js` speaks the Appyflow shape (one GET); any other
  reseller is a few lines beside it.
- The **outcome is stored, not a boolean** (`VerificationCheck`): legal name,
  trade name, registration status, principal address, who pressed the button
  and when. The answer that matters is `MISMATCH` — a GSTIN that is live but
  **registered to a different name**. That is the fraud signal, and it also
  raises an admin notification.
- For a GSTIN the portal is the authority, so a `VERIFIED` result ticks
  `gstVerified` and a `MISMATCH` / `INACTIVE` / `NOT_FOUND` un-ticks it. An
  `UNAVAILABLE` or `ERROR` check changes nothing.
- Name matching lives in `lib/verification.js`. Honorifics and legal suffixes
  are ignored ("M/S Rajesh Kumar Traders Pvt Ltd" matches "Rajesh Traders"),
  trade words deliberately are **not** — "Rajesh Traders" and "Rajesh Stores"
  must stay different businesses.

### Aadhaar — NOT verifiable, by design, and this is not a TODO

The Aadhaar button exists and records an attempt, but it always comes back
`UNAVAILABLE` with the reason. **No fake check was built.** Online Aadhaar
authentication/eKYC requires a UIDAI **AUA/KUA licence** (or riding as a
sub-AUA under a bank or licensed KYC provider), with an audited Aadhaar Data
Vault and per-slab licence fees — not something NTSA holds. So the Aadhaar
tick-box means, and now says in the panel, "**I have seen the document**".

The two routes that need **no** UIDAI licence, if the client ever wants a real
check, are: (a) **Aadhaar Paperless Offline e-KYC**, where the *resident*
downloads a share-code-protected XML/QR from UIDAI themselves and NTSA just
verifies UIDAI's signature on it, and (b) a **DigiLocker** partner
integration via API Setu, which needs NTSA to be onboarded as a partner
organisation. Both change what the seller has to do at signup, so neither was
guessed at. `services/verification.js` has the seam ready.

### Storing full Aadhaar numbers — tell the client

`Seller.aadharNumber`, `Vendor.aadharNumber` and
`SellerApplication.aadharNumber` all hold the **full 12 digits** today, and
that is the wrong shape. The Aadhaar (Authentication and Offline Verification)
Regulations require an Aadhaar number to be **masked** before a copy is stored
(first 8 digits redacted, last 4 visible), entities that may legitimately hold
the number must keep it in an audited **Aadhaar Data Vault**, and an offline
verification-seeking entity may not store the number at all. Section 29(4) of
the Aadhaar Act also bars publishing or displaying it, and Chapter VII makes
unauthorised use of identity information an offence.

**The safe shape**: store only the last 4 digits for recognition, plus the
uploaded document reference, and drop the other 8. This is a schema migration
and a data cleanup, so it was flagged rather than done quietly — it changes
what is already in the live database. Get the client's sign-off and then do it.

## Important gotchas learned the hard way

1. **Render Static Site "Redirects/Rewrites" do NOT reliably proxy POST request bodies to an external destination.** We initially tried routing the admin panel's `/api/*` calls through a Rewrite rule to the backend — logins silently failed (POST arrived at the backend as something that didn't match the login route, backend's `auth` middleware then threw `"Please sign in again"`). The actual fix: `Frontend/web/src/api.js` now reads `import.meta.env.VITE_API_URL` (falls back to relative `/api` for local dev, where Vite's own dev-server proxy handles it) and calls the backend's real URL directly, with CORS configured on the backend (`CORS_ORIGIN` = the admin panel's exact origin). Don't re-introduce a static-site rewrite for API calls.

2. **This Windows laptop is memory-constrained (8GB RAM, often only 1–2GB free).** Flutter **release** APK builds (`flutter build apk --release`) reliably OOM-crash here — both the Dart AOT compiler and the Gradle daemon have crashed with "insufficient memory." Workarounds applied:
   - `Frontend/customer/android/gradle.properties`: lowered `org.gradle.jvmargs` from `-Xmx8G` (impossible on this machine) to `-Xmx1536m -XX:MaxMetaspaceSize=512m -XX:ReservedCodeCacheSize=128m`.
   - For sharing an APK with the client to test, a **debug** build (`flutter build apk --debug --dart-define=API_BASE_URL=...`) is what's actually been used — it's reliable here and fully functional, just larger and slightly slower, with a small debug banner.
   - Before any Android build on this machine, closing unnecessary Chrome tabs / VS Code windows first measurably helps.
   - `kotlin.incremental=false` is also set in `gradle.properties` — needed because the project lives on the `P:` drive while Gradle/pub caches live on `C:`/`D:`, and Kotlin's incremental compiler can't relativize paths across drive letters.

3. **The Flutter app's backend URL is a build-time flag, not a config file**: `Frontend/customer/lib/core/api_client.dart` defaults to `http://localhost:4000/api` and is overridden with `--dart-define=API_BASE_URL=https://e-commerce-app-new-gmgz.onrender.com/api` at build time. Any new APK build for real device testing (not `adb reverse` local testing) needs that flag.

4. **Local image storage is a dev-only stand-in.** `Backend/src/services/storage.js` falls back to saving uploads on local disk (serving them from `http://localhost:PORT/uploads/...`) only when Cloudinary env vars are absent. Cloudinary is now configured with the client's real account, so this fallback shouldn't trigger anymore — but if you ever see a product/user photo pointing at `localhost:4000/uploads/...`, it was uploaded before Cloudinary was wired in (or Cloudinary env vars are missing) and needs re-uploading.

## What's NOT done yet (needed before a real public launch, not needed for a client demo)

See `NTSA-APP-LAYOUT-IMG/NTSA-External-Services-Required.pdf` if that folder still exists (it went missing once mid-session — client's original approved design reference images may need re-requesting from the client if it's genuinely gone). Summary: real Firebase phone-OTP + Google/Apple login, real Razorpay payments. Everything else (Cloudinary, database, hosting) is done.

## Recently built features (this session)

- Admin-defined custom product attributes (free-form spec rows, e.g. "Capacity: 20L") — shown as "Specifications" on the product page.
- Wholesale portal rebuilt with its own bottom nav (Home/Categories/Messages/Settings), matching the retail app's banner slider and category browsing.
- Vendor ↔ Admin messaging (`VendorMessage` model, `/vendor/messages` + `/admin/vendors/:id/messages` endpoints, chat UI in the app and in the admin panel).
- A **Shopping Assistant** on the customer app (orange button, bottom right): the shopper types one plain sentence — "mujhe white jute lene hain aur 1500 ka mera budget hai" — and gets real catalog products back. `POST /api/products/assist` reads the sentence into filters (colour, budget, item type, leftover words) in `Backend/src/lib/shopQuery.js`, then runs the ordinary storefront query, so the same rules hold as `GET /products`: live products only, nothing wholesale-only, no dealer prices, a shop on holiday hidden. It also returns `summary` ("White · Shoes · under ₹1,500") and `relaxed` (which constraint had to be dropped to find anything), both of which the chat screen shows, so a misread word is visible to the shopper rather than silently returning the wrong shelf.
  **There is no language model here and the feature does not need one.** Hindi/Hinglish item words ("jute", "kapde", "ghadi") and Indian money phrasing ("1500 ka", "2 hazaar se kam", "₹1500 tak", "500 se 1500 ke beech") are in the lexicon in `shopQuery.js`; add words there as the catalog grows. `interpretQuery()` at the bottom of that file is the one seam a model would ever be called from — sentence in, the same filters out — with the parser left as the fallback. Tests: `Backend/test/shop-assistant.test.js`, `Frontend/customer/test/assistant_test.dart`.

## Local dev quick-start (if not just using the Render deployment)

```bash
npm install                    # root: installs Backend + Frontend/web workspaces
cd Frontend/customer && flutter pub get
```
Copy `Backend/.env` from another machine (gitignored, not in git), or fill `Backend/.env.example` with real values.
```bash
npm run dev:api      # Backend on :4000
npm run dev:web      # Admin panel on :5173 (or Vite's next free port)
cd Frontend/customer && flutter run   # or flutter run -d <device-id> for a physical phone
```
For a physical Android phone over USB (not an emulator): `adb reverse tcp:4000 tcp:4000` needs to stay active for the app to reach a locally-running backend — it drops periodically and needs re-running.

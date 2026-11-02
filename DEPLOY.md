# NTSA — Production Deployment Guide

This is a step-by-step guide for putting NTSA live:

| Piece | Where it goes | What it is |
|---|---|---|
| Backend API | Railway (web service) | Node/Express/Prisma, folder `Backend/` |
| Database | Railway Postgres | one managed Postgres instance |
| Admin / staff panel | any static host | Vite React build of `Frontend/web/` |
| Seller panel | any static host | Vite React build of `Frontend/seller/` |
| Marketing + policy site | any static host | plain HTML in `Website/` (needed for the Play Store) |
| Customer app | Play Store / APK | Flutter, `Frontend/customer/` |

Read `HANDOFF.md` first — it has history and gotchas that are still true.
Written for someone who has never seen this project. Follow it in order.

**Never paste a real secret into this file, into the repo, or into a chat.** All
real values live in `Backend/.env` on the developer's machine and in Railway's
own Variables tab. `Backend/.env` is gitignored — keep it that way.

---

## 0. Before you start

You need:

- A Railway account (railway.app) with a paid plan or trial credit.
- The repo on GitHub: `https://github.com/chaturbhuj9166/E-Commerce-App-New.git`, branch `main`.
- Logins for the client's **Cloudinary** account (image hosting) and the
  client's **Firebase** project (customer phone-OTP login and push).
- Node 22 locally (`node -v`) and the repo cloned.

Decide the three public addresses up front, because they reference each other:

- Backend, e.g. `https://ntsa-api.up.railway.app` (Railway gives you this).
- Admin panel, e.g. `https://admin.ntsa.example`.
- Seller panel, e.g. `https://seller.ntsa.example`.

---

## 1. Create the database first

1. In Railway, create a new **Project**.
2. Click **+ New → Database → Add PostgreSQL**. Wait until it is green.
3. Open the Postgres service → **Variables** tab. It already has
   `DATABASE_URL`. You do not need to copy the value anywhere by hand; step 2
   wires it up by reference.
4. Open the Postgres service → **Settings → Backups** and turn on daily
   backups. Do this now, not later.

---

## 2. Create the backend service

1. In the same project: **+ New → GitHub Repo** → pick the NTSA repo, branch
   `main`.
2. Open the new service → **Settings**:
   - **Root Directory**: `Backend`
   - **Build / Start commands**: leave them empty. `Backend/railway.json` in the
     repo already sets them:
     - Build: `npm install && npx prisma generate`
     - Start: `npx prisma migrate deploy && node src/server.js`
     - Health check: `GET /health`, 180 s timeout
   - **Networking → Generate Domain**. Note the URL it gives you; that is the
     backend address the panels and the app will use.
3. Do **not** deploy yet — set the variables first (step 3), or the first boot
   will fail.

Why Nixpacks and not a Dockerfile: the backend is a plain Node 22 app. Its only
native dependencies (`sharp`, `@prisma/client`) ship prebuilt Linux binaries
that Nixpacks' Node provider installs correctly, so a Dockerfile would only add
a second thing to keep up to date with no benefit. `Backend/.nvmrc` pins Node 22
so the build does not drift onto a newer major. If the photo-search model
(`@huggingface/transformers`) is ever turned on and needs system libraries
Nixpacks does not provide, that is the point to revisit the decision.

---

## 3. Environment variables on the backend service

Open the backend service → **Variables** → **Raw Editor**, and set these.
`Backend/.env.example` is the same list with the same comments.

### Required — the service will not start without these

| Name | What it is | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Click **Add a Variable Reference** and pick the Postgres service's `DATABASE_URL`. Do not paste the literal string — a reference keeps working if Railway rotates the password. |
| `JWT_SECRET` | Signs panel and app login tokens. Minimum 32 characters. | Generate a fresh one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Never reuse the development one. Changing it logs everybody out. |
| `NODE_ENV` | `production` | Type it. |
| `DEMO_MODE` | `false` | Type it. The app **refuses to start** if `NODE_ENV=production` and `DEMO_MODE=true` (`Backend/src/config.js:12`). See section 8 for what turning demo mode off changes. |
| `CORS_ORIGIN` | Which browser origins may call the API | A comma-separated list of the **exact** panel origins, no trailing slash, e.g. `https://admin.ntsa.example,https://seller.ntsa.example`. A mismatch here is the single most common cause of "Could not reach the NTSA server" in the panels. The Flutter app is not a browser and needs no entry. |

Do **not** set `PORT`. Railway injects it and the app reads it
(`Backend/src/config.js:5`); setting it yourself will break the health check.

### Required for the first boot only — creating the admin login

| Name | What it is | Where to get it |
|---|---|---|
| `SEED_ADMIN_EMAIL` | Email of the first admin account | Agree it with the client, e.g. `admin@ntsa.in`. |
| `SEED_ADMIN_PASSWORD` | Its password. **Minimum 12 characters.** | Generate a strong one and give it to the client over a safe channel. `prisma/seed.js` refuses to run with a shorter one. |

The seed only ever *upserts* the admin, so it never overwrites an existing
password. Keep both variables set — the seed is safe to re-run.

### Required in production — uploads

| Name | What it is | Where to get it |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name | cloudinary.com → **Dashboard → API Keys** |
| `CLOUDINARY_API_KEY` | Cloudinary key | same screen |
| `CLOUDINARY_API_SECRET` | Cloudinary secret | same screen (click to reveal) |

All three, or none. With any one missing, every photo upload is refused with
`503 Cloudinary is not configured`
(`Backend/src/services/storage.js:32` and `:60`) — which is the *correct*
behaviour, because the fallback writes to the container's local disk and
Railway wipes that on every deploy. Never run production without these.

### Required in production — customer login and push

| Name | What it is | Where to get it |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project | Firebase console → **Project settings → Service accounts → Generate new private key**. That downloads a JSON file; these three values are the `project_id`, `client_email` and `private_key` fields in it. |
| `FIREBASE_CLIENT_EMAIL` | Service account email | same JSON |
| `FIREBASE_PRIVATE_KEY` | Service account private key | same JSON. Paste it as **one line** with literal `\n` between the lines — the code converts them back (`Backend/src/services/firebase.js:8`). Delete the downloaded JSON afterwards. |

Without these, the customer app's phone-OTP sign-in fails with
`503 Firebase is not configured`, and no push notification is ever sent.

### Set this on Railway — memory

| Name | Value | Why |
|---|---|---|
| `VISUAL_SEARCH` | `off` | Photo search loads a CLIP model that needs 0.5–1 GB of RAM. It is **on by default anywhere that is not Render** (`Backend/src/services/visualSearch.js:25`), so on Railway it switches itself on and can push the container into an out-of-memory restart loop. Turn it on only after checking the plan's memory, and then watch the metrics. |

### Optional

| Name | What it is | Where to get it |
|---|---|---|
| `COURIER_WEBHOOK_SECRET` | Shared secret for `POST /api/webhooks/courier`. 16+ characters. | Generate one and give it to the courier / Shiprocket. Leave it unset and the webhook route returns 404, which is the safe default. See HANDOFF.md. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Online payments | Razorpay dashboard. **Read section 8 before setting these** — online payments are not production-ready. |
| `WATERMARK` / `WATERMARK_FILE` | `off` to stop stamping the logo on product photos, or a path to a different logo. | Leave unset for the default. |
| `VISUAL_SEARCH_WARMUP` | `0` to skip indexing the catalog at boot. | Only matters when `VISUAL_SEARCH=on`. |
| `KEEP_ALIVE` | Render-only self-ping. | Leave unset. It reads Render's own `RENDER_EXTERNAL_URL`, so on Railway it never runs. |

---

## 4. Deploy the backend and run the migration

The start command runs `npx prisma migrate deploy` before the server, so the
first deploy creates all the tables for you.

1. Click **Deploy**.
2. Watch the **Deploy Logs**. You want to see Prisma apply `0_init`, then
   `NTSA API listening on ...`, then the health check turn green.
3. Check it from your own machine:
   ```bash
   curl https://<your-backend>/health
   ```
   Expect `{"status":"ok","demo":false}`. `demo` **must** be `false`.

### Seed the catalog and the admin account

`migrate deploy` creates empty tables; the seed fills in the admin login,
the 14 categories and some sample products. Run it **once**, from the Railway
service's shell (service → the `...` menu → **Shell**, or `railway run` with
the CLI):

```bash
node prisma/seed.js
```

It is idempotent — it upserts, prints `Seed complete. Existing accounts and
products were preserved.`, and is safe to run again. It does *not* create the
demo wholesaler account, because that part only runs when `DEMO_MODE=true`.

> **Staff logins are not seeded.** A fresh database has only the one admin
> account (from `SEED_ADMIN_EMAIL`). The **packing, sales and support** team
> logins do not exist until the admin creates them in the panel: sign in as the
> admin → **Staff** → add each person with a role. The dev credentials like
> `packing@ntsa.local` only work on the old dev database where they were made by
> hand; they will **not** work on the live site until the admin creates them.
> Support tickets are visible to the admin too, so support can be handled before
> a dedicated support login exists.

Sign in to the admin panel afterwards with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` and change the password.

### If you are pointing at the old Render database instead of a new one

The old Render database was built with `prisma db push`, so its tables exist
but Prisma has no record of the `0_init` migration and `migrate deploy` would
try to create everything again and fail. Mark the migration as already applied,
once, before the first deploy:

```bash
cd Backend
DATABASE_URL="<the existing database url>" npx prisma migrate resolve --applied 0_init
```

### Changing the schema from now on

`Backend/prisma/migrations/0_init/` is the baseline, generated from
`prisma/schema.prisma`. **Stop using `prisma db push`.** When you change a
model, run this against your local Postgres:

```bash
cd Backend
npx prisma migrate dev --name what_you_changed
```

Commit the new folder under `prisma/migrations/`. The next Railway deploy
applies it automatically. Before any deploy, double-check that nothing was
changed in `schema.prisma` without a matching migration — a model with no
migration means a missing table and 500s in production.

---

## 5. Deploy the two panels

Both are static sites: a build step produces a `dist/` folder of plain files.
Any static host works (Cloudflare Pages, Netlify, Vercel, Railway static, or
Render as before). Neither panel uses client-side routing, so you do **not**
need an SPA rewrite rule.

**Do not** configure a redirect/rewrite rule that proxies `/api/*` to the
backend. It was tried and it silently broke every login — see HANDOFF.md
gotcha 1. The panels call the backend's real URL directly instead.

### Admin / staff panel

| Setting | Value |
|---|---|
| Root directory | `Frontend/web` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |

Build-time environment variables (Vite bakes them into the bundle, so they must
be set **before** the build, and changing one needs a rebuild):

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://<your-backend>/api` — note the `/api` suffix, and no trailing slash |
| `VITE_SELLER_PANEL_URL` | The seller panel's URL, e.g. `https://seller.ntsa.example/`. Used by the "View dashboard" link; it defaults to `http://127.0.0.1:5174/`, which is useless in production. |

### Seller panel

| Setting | Value |
|---|---|
| Root directory | `Frontend/seller` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |
| `VITE_API_URL` | `https://<your-backend>/api` |

### Then close the loop

Go back to the backend's `CORS_ORIGIN` and make sure it lists both panels'
final origins exactly. Redeploy the backend if you changed it.

Verify by signing in to each panel and loading one list page. If you see
"Could not reach the NTSA server", open the browser console: a CORS error means
`CORS_ORIGIN`; a 404 on `/api/...` means `VITE_API_URL`.

### Marketing and policy site (`Website/`)

Plain HTML, no build step. Publish the `Website/` folder as-is to a third static
site. You need the live `privacy-policy.html` and `terms.html` URLs for the Play
Store listing, and they must stay reachable.

---

## 6. Customer app

The backend URL is a **build-time flag**, not a config file. Every APK /
App Bundle for real devices must be built with it:

```bash
cd Frontend/customer
flutter build apk --release --dart-define=API_BASE_URL=https://<your-backend>/api
```

Note `/api` on the end. Release builds OOM on the current development laptop —
see HANDOFF.md gotcha 2 for the workarounds, and gap E4: the app is still
debug-signed and needs a release keystore before the Play Store.

---

## 7. After the first deploy — check these

- [ ] `curl https://<backend>/health` → `{"status":"ok","demo":false}`
- [ ] Admin panel: sign in, open Products, Orders, Sellers.
- [ ] Admin panel: **upload a product photo.** The resulting URL must start
      with `https://res.cloudinary.com/`. If it starts with `http://localhost`,
      Cloudinary is misconfigured and that image will vanish on the next deploy.
- [ ] Seller panel: sign in as a seller.
- [ ] Customer app (release build against the live backend): phone-OTP sign in,
      browse, add to cart, place a COD order.
- [ ] Railway → Postgres → Backups: daily backups are on.
- [ ] Railway → backend → Metrics: memory is flat and well under the plan limit
      (if it climbs toward the ceiling, `VISUAL_SEARCH` is on).

---

## 8. What turning off `DEMO_MODE` changes

`DEMO_MODE=false` is required in production, and it switches off four things
that were standing in for real services. Three of them are expected; two of them
are visible to customers and the client has to decide what to do.

1. **Local disk uploads are off.** Cloudinary is now mandatory. Correct and
   intended — see section 3.
2. **Customer phone-OTP sign-in moves to real Firebase.** On Android this
   already works: the app asks Firebase for the SMS and exchanges the Firebase
   token at `POST /auth/firebase`. Needs the three `FIREBASE_*` variables.
3. **`POST /auth/demo` and `/auth/demo/otp` start returning 404**
   (`Backend/src/routes.js:62`, `:72`). The Flutter app still routes two paths
   through them, so both break in production:
   - the **Google and Apple sign-in buttons** on the login screen, which have no
     phone number to key off (`auth_provider.dart:149`);
   - any **web** build of the customer app, which has no Firebase and falls back
     to the demo OTP (`auth_provider.dart:78`).

   Neither is a deployment problem — real Google/Apple sign-in was never built
   (gap D4). Hide those buttons or implement them. Not fixed here because it is
   an app behaviour change and a client decision.
4. **`paymentMethod: 'DEMO'` is rejected with 400**
   (`Backend/src/services/orders.js:47`). The customer app sends exactly that
   when a shopper picks "online payment" (gap B1 — Razorpay was never added to
   the app), so **online payment fails in production**. COD and wallet work.
   Sell COD-only at launch, or finish the Razorpay integration.

   Also note `Backend/src/services/payments.js:5` requires the key to start with
   `rzp_test_`, so a real **live** Razorpay key is rejected with
   `503 Razorpay test credentials are not configured`. That line has to change
   before live payments can work at all.

---

## 9. Known production gaps not covered by this guide

See `PROJECT_GAPS.md` for the full list. The ones that affect a live launch:

- Online payments and refunds-to-source are not finished (gaps B1, B2).
- Refunds go to the in-app wallet only, never back to the card/UPI.
- No crash reporting or analytics (gap H2).
- "Refer & Earn" promises ₹250 with no backend behind it (gap D1) — a trust and
  legal risk; remove it or build it.
- No in-app account deletion, which Google Play requires (gap E1).
- The app is debug-signed (gap E4).

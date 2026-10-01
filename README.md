# Muscle and Fitness Center

Bilingual (Arabic / English) gym website, member portal and admin panel for `مركز بناء ولياقة الرياضي`, serving two branches — **Main** and **Women's** — from one codebase.

- Live app: `src/` (Express + MySQL, raw parameterized SQL in `src/repositories/`). The legacy `backend/` folder is **not used**.
- Frontend: static pages in `public/` hydrated by vanilla JS (no build step).
- Staff guide (AR/EN): [docs/admin-guide.md](docs/admin-guide.md) · What changed: [CHANGELOG.md](CHANGELOG.md) · Design decisions: [docs/IMPLEMENTATION-SUMMARY.md](docs/IMPLEMENTATION-SUMMARY.md)

## Quick start (development)

```bash
npm install
cp .env.example .env            # then fill DB_*, JWT_* secrets, ADMIN_* (see table below)
mysql -u root -p < src/db/schema.sql
npm run db:migrate              # applies every migration in src/db/migrations
npm run db:seed                 # settings, homepage copy, plans/offers for BOTH branches
npm run admin:ensure            # creates the super_admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run db:seed:staging         # optional demo data for both branches (never in production)
npm start                       # http://localhost:3000
```

Open the two storefronts locally:

- Main branch: `http://localhost:3000`
- Women's branch: `http://women.localhost:3000` (browsers resolve `*.localhost` to your machine; no DNS needed)

Run the tests (real-DB tests self-skip when no database is configured):

```bash
npm test
```

### Rebuilding the dev database

Dev data is disposable. To start clean: drop the `muscle_fitness` database, then run the five commands above from `mysql ... schema.sql`. Migrations are reversible (`npm run db:rollback -- <migration_name>`).

### Demo data (staging only)

`npm run db:seed:staging` adds — per branch — plan features, coaches, FAQs, members in every state (active, expiring, expired, frozen, at-risk, no membership), check-ins, a lead with a follow-up task, and a paid reception payment with its ZATCA invoice. It is idempotent and refuses to run with `NODE_ENV=production`. Seeded members sign in with `<state>.<branch>@staging.local` / `Staging@12345` (e.g. `active.women@staging.local`). `scripts/demo-seed.js` keeps the original one-demo-member-per-branch seed (`demo@muscle-fitness.local`).

## Branches

| | Main | Women's |
|---|---|---|
| Public site | `yourdomain.com` | `women.yourdomain.com` |
| Branch code / table | `branches.code = 'main'` | `branches.code = 'women'` |
| Invoice numbers | `INV-M-<HijriYear>-000001` | `INV-W-<HijriYear>-000001` |
| VAT registration | own | own (separate sequence) |

- **Public requests** resolve the branch from the **subdomain** (`women.` → Women's, anything else → Main). In development only, `?branch=women` or an `X-Branch: women` header also works on API calls.
- **Signed-in requests** never trust the client: the branch comes from the account's own database row on every request (`req.user.branchId`). Staff with `branches:manage` (or super_admin) can switch the branch they are *viewing*; it is validated server-side.
- Members are separate per branch: the same email/phone can register once in each branch. Staff accounts are global with a home branch.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV`, `BASE_URL` | Server port, `production` in prod, canonical site URL (fallback origin for payment returns and the sitemap) |
| `CORS_ORIGIN` | Comma-separated allowed origins — **must list both** `https://yourdomain.com,https://women.yourdomain.com`. Also used to validate hosts for payment return URLs, robots.txt and sitemap.xml |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (or `DATABASE_URL`) | MySQL connection |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `BCRYPT_ROUNDS` | Sessions |
| `ADMIN_IDLE_TIMEOUT_MINUTES` | Admin sessions expire after this much inactivity (default 480) |
| `ADMIN_EMAIL`, `ADMIN_FULL_NAME`, `ADMIN_PASSWORD`, `ADMIN_REGISTRATION_SECRET` | First super_admin (`npm run admin:ensure`) and the bootstrap admin-create secret |
| `SMTP_*`, `EMAIL_FROM`, `OTP_EXPIRY_MINUTES` | Password-reset email |
| `RATE_LIMIT_LOGIN`, `RATE_LIMIT_REGISTER`, `RATE_LIMIT_OTP`, `RATE_LIMIT_ADMIN_LOGIN` | Abuse limits |
| `MOYASAR_MODE` (`test`/`live`), `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY`, `MOYASAR_WEBHOOK_SECRET`, `MOYASAR_INVOICE_TTL_MINUTES` | Online payments (see below) |
| `AI_ASSISTANT_ENABLED`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT`, `AI_RATE_LIMIT_PER_HOUR` | Admin AI assistant (off by default) |
| `GA4_MEASUREMENT_ID`, `META_PIXEL_ID` | Analytics — loaded only after the visitor accepts analytics cookies |
| `BACKUP_CRON`, `BACKUP_RETENTION_DAYS`, `MYSQLDUMP_PATH` | Scheduled database backups |
| `PAYMENT_SUCCESS_URL`, `PAYMENT_CANCEL_URL`, `STRIPE_*` | Retired Stripe adapter only (not offered in the UI) |

## Online payments (Moyasar)

Members pay from the portal (`user.html` → plan → *Pay online*). The server creates a Moyasar **invoice** (hosted checkout — no card data touches this server), the member pays on Moyasar's page, and is sent back to `/user.html?payment=<id>` on their own branch's domain.

Payment, membership activation/extension and the ZATCA invoice are committed in **one transaction**, only after the server re-fetches the invoice from Moyasar (redirect parameters and webhook bodies are never trusted for amounts or status). Duplicate webhooks, the redirect and the reconcile job can race safely.

Setup:

1. Moyasar dashboard → API keys → put the **test** keys in `.env` (`MOYASAR_MODE=test`).
2. Settings → Webhooks → URL `https://yourdomain.com/api/v1/payments/webhook/moyasar`, events `payment_paid` and `payment_failed`, and a secret token → `MOYASAR_WEBHOOK_SECRET`.
3. Each branch needs its 15-digit VAT number in Admin → Settings → "Legal & VAT details" before invoices can be issued.
4. Test in test mode: a successful mada / card payment, a declined card, and re-delivering the same webhook (the payment must not be applied twice). Moyasar publishes test card numbers in its docs.
5. For production switch to the live keys and `MOYASAR_MODE=live` (test-mode webhooks are then ignored).

A reconcile job runs every 10 minutes to settle payments whose webhook was missed and to close abandoned checkouts. Reception can also record cash / card-terminal / bank-transfer payments (Admin → Payments), which issue the same invoices.

## AI assistant

Set `AI_ASSISTANT_ENABLED=true` and `ANTHROPIC_API_KEY` to turn it on (without a key it gives basic rule-based answers). It answers questions about the viewer's branch using **read-only** tools that run the app's own queries; it can draft messages but cannot change any data, never receives member contact details, is rate-limited per admin and every question is audit-logged. Turning the flag off removes the routes and the tab.

## Backups

- `npm run db:backup` — one-off `mysqldump` (consistent snapshot, gzipped) into `storage/backups/`.
- `BACKUP_CRON` (default `0 3 * * *`, Riyadh time) runs the same backup from the app; files older than `BACKUP_RETENTION_DAYS` are deleted.
- Admin → Settings → "Back up now" triggers one on demand (roles with `backups:write`); super_admins can also download a full Excel export (no secrets).
- **Copy backups off the server.** Example system cron (03:30 daily) if you prefer the OS scheduler:

```cron
30 3 * * * cd /var/www/muscle-fitness && /usr/bin/npm run db:backup >> /var/log/mf-backup.log 2>&1 && rclone copy storage/backups remote:mf-backups --max-age 2d
```

Restore: `gunzip -c storage/backups/backup-<db>-<time>.sql.gz | mysql -u root -p muscle_fitness`.

## Member import

Admin → Users → *Import members*. Templates: [docs/member-import-template.xlsx](docs/member-import-template.xlsx) (English headers) and [docs/member-import-template-ar.xlsx](docs/member-import-template-ar.xlsx) — regenerate with `npm run import:template`. Upload → preview (nothing saved) → confirm. Create-only by default; "update existing" matches on member code.

## Deployment

1. Server: Node 20+, MySQL 8, nginx, PM2 (`ecosystem.config.js`). See [DEPLOYMENT.md](DEPLOYMENT.md).
2. DNS: A/AAAA records for `yourdomain.com` **and** `women.yourdomain.com`.
3. TLS: `certbot certonly --nginx -d yourdomain.com -d women.yourdomain.com`.
4. nginx: `nginx.conf` already contains a server block for each host, both proxying to the same Node app (the app decides the branch from the host).
5. `.env`: `NODE_ENV=production`, `BASE_URL=https://yourdomain.com`, `CORS_ORIGIN=https://yourdomain.com,https://women.yourdomain.com`, live Moyasar keys, strong JWT secrets.
6. `npm ci && npm run db:migrate && npm run admin:ensure && pm2 start ecosystem.config.js`.
7. In the admin (switch to each branch): Settings → Legal & VAT details, Contact info, plans, coaches, FAQs.
8. Submit `https://yourdomain.com/sitemap.xml` and `https://women.yourdomain.com/sitemap.xml` to Google Search Console as two properties.

## Architecture

- `src/app.js` — security middleware (helmet CSP, rate limits, CORS allowlist), branch resolver, routes under `/api/v1`.
- `src/middleware/branchResolver.js` (public branch by host) · `src/security/branchAccess.js` (viewing branch, write branch, by-id ownership → 404 across branches).
- `src/services/paymentService.js` (Moyasar + reception payments) · `invoicePdfService.js` (ZATCA PDF) · `aiAssistantService.js` · `importService.js` · `checkinService.js` · `backupService.js`.
- `src/jobs/cron.js` — membership expiry, 7/3/1-day reminders, at-risk members, payment reconcile, backups, OTP cleanup.
- `public/admin.html` + `public/assets/js/admin-dashboard.js` — the single admin panel; `public/assets/js/i18n.js` holds all UI strings in both languages.
- Tests: `test/*.test.js` (Node's built-in runner) — cross-branch security, payments (mock Moyasar), reports, imports, CMS, AI (mock API), and more.

# Implementation summary

Written summary required by the Master Implementation Prompt (Part 1 §20 and Part 5 item 6). Branch: `feature/women-branch` (built on `feature/admin-core` → `feature/invoicing`). Nothing has been merged to `main`.

## Decisions confirmed with the owner

| Topic | Decision | Where it shows |
|---|---|---|
| Payment provider | **Moyasar** (the prompt said Tap; owner confirmed Moyasar on 2026-09-09 and again 2026-09-18 and 2026-10-01). Stripe retired. | `src/services/moyasarClient.js`, `paymentService.js` |
| Branch routing | **Subdomain** (`women.yourdomain.com`) | `src/middleware/branchResolver.js`, `nginx.conf` |
| VAT registration (§7a) | **Two separate registrations** → each branch has its own VAT number and its own gap-free invoice sequence | `invoiceRepository.allocateInvoiceNumber`, `business_settings` per branch |
| Plans / offers | Every plan and offer belongs to **exactly one** branch (no shared NULL tier) | `plans.branch_id`, `offers.branch_id` NOT NULL |
| Invoice numbering | Hijri-year reset: `INV-<M|W>-<HijriYear>-<6 digits>` | `src/utils/hijri.js` |

Decisions I made and you can revisit:

- **FAQs** *can* be shared: `faqs.branch_id` NULL = shown on both sites, a branch id = that branch only. Only cross-branch admins may edit shared FAQs. Slides follow the same rule. (The no-shared rule above applies to plans/offers only.)
- **Optional Part 2 features not built** (the prompt marks them "optional, if the business wants them"): group classes & bookings, family/linked accounts, e-signature waivers, body-progress tracking, recurring/auto-renewal billing with saved cards, standalone PT packages, retail POS, referral program.
- **Admin panel language** stays Arabic-only as it was before; every new admin string still has both an Arabic and an English translation in `public/assets/js/i18n.js`.
- **Leads before the migration** (and any leads with no branch) were assigned to the Main branch.

## How branch resolution works

**Public / unauthenticated requests** (landing page, public plans/offers/coaches/FAQs, registration, contact form): the branch comes from the request host — `women.<domain>` → Women's, anything else → Main (`src/middleware/branchResolver.js`, sets `req.branch`). In development only, `?branch=women` or `X-Branch: women` override it on API calls. The static HTML is identical for both branches; `main.js` fetches `/api/v1/public/bootstrap` and the server returns that branch's content.

**Authenticated requests:** the branch is **never** taken from the client. `authenticate()` loads the principal from the database on every request and sets `req.user.branchId` (immune to stale tokens). For admin data, `attachEffectiveBranch` sets `req.effectiveBranchId`:

- a normal staff account → always their own branch, whatever they send;
- super_admin / `branches:manage` → the branch chosen in the "Viewing branch" switcher (`X-View-Branch` header), validated server-side.

Writes go to `resolveWriteBranchId` (same rules), and every by-id route runs `assertBranchOwnership` — a record from another branch is a **404**, indistinguishable from a missing one. Consolidated reports, audit logs and AI answers (`?scope=all`) are refused with 403 unless the admin can switch branches.

## Tables / repositories that gained branch filtering

- **Schema** (migrations): `users` composite uniqueness; `settings`, `homepage_text`, `slider_images`, `business_settings`, `invoice_counters`, `coaches`, `tasks`, `messages` (leads), `faqs` (nullable = shared), `zakat_worksheets`, `import_jobs` gained or use `branch_id`; `plans.branch_id` / `offers.branch_id` made NOT NULL.
- **Repositories now filtering by branch:** plan, offer, public (bootstrap), settings, slider, customer, user (admin list/detail/export), membership, payment, invoice, attendance, expense, report, coach, task, message (leads), faq, admin (dashboard), import/export, AI tools.

## Schema approach

Additive, reversible **migrations** in `src/db/migrations/` (each with a `.down.sql`) rather than editing `schema.sql`, matching the existing convention and so the shared dev database could be upgraded in place while other work continued on it. A fresh database still starts from `schema.sql` and then `npm run db:migrate`.

New in this round: `202610010001_moyasar_payments`, `…0002_zakat_worksheets`, `…0003_member_ops` (lead branches + at-risk settings), `…0004_import_jobs` (+ member code/QR backfill), `…0005_admin_feed`, `…0006_cms`.

## Environment and nginx changes

- `nginx.conf`: a second server block for `women.yourdomain.com` proxying to the same app; DNS record + certificate needed (README → Deployment).
- `CORS_ORIGIN` is a comma-separated allowlist and **must list both domains**. It is also what validates the host used for Moyasar return URLs, `robots.txt` and `sitemap.xml` (a spoofed Host header can't inject URLs).
- New variables: `MOYASAR_*` (incl. `MOYASAR_WEBHOOK_SECRET`, `MOYASAR_INVOICE_TTL_MINUTES`), `AI_ASSISTANT_ENABLED`, `GEMINI_API_KEY`, `AI_MODEL`, `AI_RATE_LIMIT_PER_HOUR`, `RATE_LIMIT_ADMIN_LOGIN`, `MYSQLDUMP_PATH`; existing `GA4_MEASUREMENT_ID`, `META_PIXEL_ID`, `BACKUP_CRON`, `BACKUP_RETENTION_DAYS` are now actually used.
- Content-Security-Policy now allows `googletagmanager.com` and `connect.facebook.net` (loaded only after cookie consent).

## SEO per branch (§2.5)

Subdomains were chosen, so each branch is its own site for search engines: its own `sitemap.xml` and `robots.txt` (generated per host), per-branch title/description/favicon from the admin, `canonical` on its own origin, `hreflang` alternates for Arabic/English (`?lang=ar|en`), and JSON-LD built from that branch's data. Submit both sitemaps as two Search Console properties.

## Test results

`npm test` — **104 tests, all passing** against the real development MySQL database (database tests skip themselves when no database is configured):

| Suite | Tests | Covers |
|---|---|---|
| crossBranchSecurity | 15 | Part 1 §18: other-branch user data, plan/branch mismatch, spoofed branch in body/query/header, branch-scoped admin lists and by-id routes, OTP across branches, Main branch unaffected |
| branchAccess | 9 | Switcher can't be spoofed by a non-super admin |
| moyasar | 8 | Checkout, signed webhook, **duplicate/concurrent deliveries never double-apply**, wrong secret rejected, renewal, failure + task, amount mismatch, cross-branch plan, return-URL allowlist |
| adminPayments | 4 | Reception payment = payment + membership + invoice; same submission never twice (incl. concurrent); cross-branch 404; branch-only lists/exports |
| invoiceNumbering | 2 | Gap-free sequence under concurrency; independent per-branch sequences |
| zatcaQr / arabicText | 14 | ZATCA TLV QR; Arabic shaping in PDFs |
| reports | 4 | VAT figures, leak fix, consolidated only for cross-branch admins, Zakat inputs, churn |
| checkin | 7 | Allow/deny reasons, duplicate scans, cross-branch, Riyadh-local stats |
| members | 5 | /users scoping, branch-scoped leads, freeze/unfreeze/extend, notes/QR/soft delete, at-risk tasks |
| tasks / leads / coaches | 15 | CRUD + auto-generation, branch ownership |
| imports | 4 | Preview writes nothing, commit once, other branch can't commit, update mode, exports, backup has no secrets |
| staffOps | 4 | Forced password change, super_admin protection, audit log scoping, bell feed |
| cms | 5 | Contact/FAQ/slide branch rules, scheduling, reorder, plan in use, VAT details |
| aiAssistant | 4 | Tools return only the scoped branch, no phone numbers, permission-filtered tools, Gemini-compatible schemas, free-quota (429) message, flag off removes it |
| publicSite | 4 | robots/sitemap (spoofed host), 404/500, CSP, bootstrap |

Moyasar and the AI assistant are tested against local mocks of their APIs. **Before going live, run the test-mode checklist in README → Online payments against Moyasar's real sandbox** (a mada payment, a card payment, a declined card, a re-delivered webhook).

## Known limits / follow-ups

- Moyasar has only been exercised against a mock built from its public docs (invoices + webhooks); confirm the real sandbox behaviour before switching to live keys.
- Accessibility: new screens have labels, keyboard reordering and focus handling, but no full WCAG audit of the older admin screens was done.
- Images: uploads are converted to WebP in the browser; the existing hero images were not regenerated with `srcset`.
- The legacy `backend/` folder is untouched and still unused — it can be deleted once you confirm nothing deploys it.

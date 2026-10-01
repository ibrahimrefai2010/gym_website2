# Changelog

All changes since `main` (the `feature/admin-core` → `feature/invoicing` → `feature/women-branch` line). Grouped by area; each entry is shipped with its migration (in `src/db/migrations/`, all reversible) and tests (`test/`).

## Branch support (Women's branch)

- Second branch as a row in `branches` (`code = 'women'`), reusing the existing `branch_id` columns; no parallel men/women concept.
- Public branch resolution by **subdomain** (`women.<domain>`); dev-only `?branch=` / `X-Branch`. Signed-in requests always use the account's own branch from the database.
- Member identity per branch: `users` unique on `(branch_id, email)` and `(branch_id, phone)`; login, registration and password reset are branch-scoped.
- Branch-scoped content: `settings`, `homepage_text`, `slider_images`, `business_settings`, plans, offers, coaches, FAQs (shared or per branch), contact/social/SEO.
- Two VAT registrations → independent, gap-free Hijri-year invoice sequences per branch (`INV-M-…`, `INV-W-…`).
- Admin "viewing branch" switcher + always-visible colour-coded branch badge; branch named in every consequential confirmation.
- Server-side branch ownership on every by-id admin route (another branch's record is a 404, never data).
- nginx server block and `.env.example` for the subdomain; `CORS_ORIGIN` accepts a comma-separated allowlist.
- Cross-branch security test suite.

### Security fixes found along the way

- Reports (`/reports/summary`, `/reports/revenue`) returned all branches when no `branchId` was sent; now server-scoped, consolidated only for cross-branch admins.
- Expenses list/create/update, the AI assistant, the admin `/users` list/detail/**member export**, contact-form **leads**, slides, and role assignments trusted client input or had no branch scoping — all fixed.
- Attendance check-out, coaches assignment and FAQs: cross-branch ids are 404s.

## Payments & invoicing

- ZATCA Phase 1 simplified tax invoices: TLV/Base64 QR, Arabic-shaped PDF, Hijri-year sequential numbers (self-healing counter).
- **Moyasar** online payments (Stripe retired): hosted checkout, signed + idempotent webhook, server-side verification, reconcile job, renewal extends the active membership, failures notify the member and raise a task.
- Payment + membership + invoice committed in **one transaction**; VAT-inclusive invoice lines (price incl. 15% VAT invoices to the exact amount paid).
- Reception payments (cash / card terminal / bank transfer) through the same path, idempotent per submission.
- Admin payments list (filters, totals, Excel), tax-invoice list with PDF, overdue tracker.
- Member portal: plan picker + "Pay online", payment result banner, invoice history.
- Per-branch "Legal & VAT details" screen (VAT number, CR, address) used on invoices.

## Members, check-in, coaches

- Member list: status (active / frozen / expired / pending / suspended / none), days left, coach, last visit; filters (plan, coach, expiry window, at-risk) and sorting.
- Member profile actions: freeze / unfreeze / extend (with reason), suspend / reactivate, regenerate QR card, soft delete, internal notes, attendance history, invoice links.
- At-risk detection (configurable inactivity window per branch) with daily follow-up tasks; dashboard counters for expiring (7/3/1 days) and at-risk.
- Reception check-in: QR / code / phone / email, full-screen station, refusal reasons (incl. frozen), duplicate-scan protection, daily log, peak-hour heatmap, Riyadh-local stats.
- Coaches: admin CRUD with photos, member assignment, public "Our coaches" section per branch.
- Admin-created and converted members now get member codes and QR cards (previously only self-registered members did).

## Tasks

- `tasks` table (branch-scoped, linked to members / leads / payments / memberships), "My tasks", priorities, outcomes, dashboard widget.
- Auto-generated for expiring memberships, new leads, failed online payments and at-risk members — each switchable per branch.

## Leads / CRM

- Contact-form leads are branch-scoped, with pipeline status, assignee, notes thread and convert-to-member; honeypot + per-IP rate limit.

## Reports

- VAT (month / quarter / year / custom, by branch and payment method), Zakat helper worksheet per Hijri year (system figures + accountant inputs), annual revenue (month / plan / method / branch), renewal & churn — per branch and consolidated, all exportable to Excel.

## AI assistant

- Claude-backed (`claude-opus-5-5`), read-only branch-scoped tools (KPIs, revenue, expiring, at-risk, unpaid, attendance, churn, VAT, admin guide), drafts only, no member contact details sent, permission-filtered tools, per-admin rate limit, audit-logged, feature flag; deterministic daily insights on the dashboard.

## Import / export

- Excel export on members, payments, invoices, leads, tasks, attendance, reports and the audit log (filters + branch respected, audit-logged).
- Super-admin full backup workbook (one sheet per core table, no secrets).
- Member import: xlsx/csv → validate → preview → commit, create-only by default, opt-in update by member code with before/after; downloadable bilingual templates.

## Admin platform

- Staff accounts: create / edit / disable, RBAC roles, one-time temporary passwords with forced change at first sign-in (with the missing change-password dialog), reset revokes sessions, last sign-in + IP.
- Audit log viewer (filters, pagination, details, export).
- Notification bell (new leads, payments received / failed, new members, my tasks, expiring tomorrow).
- Dashboard widgets: new leads, check-ins today, 30-day renewal rate, insights.
- CMS: per-branch contact / WhatsApp message / socials / SEO, FAQ manager, plan features, offer & slide scheduling, drag-and-drop + keyboard reordering, plan deletion blocked while in use.
- Real `mysqldump` backups (admin button, `BACKUP_CRON`, `npm run db:backup`, retention).
- Admin image uploads are resized and converted to WebP in the browser.
- Admin panel no longer bounces roles without some permissions back to the login page.

## Public site

- WhatsApp links with the branch number and a pre-filled message in the visitor's language; footer social links.
- Plan comparison table; body-fat calculator (US Navy method); empty states.
- SEO: per-branch title/description/favicon, canonical + hreflang (`?lang=`), JSON-LD (HealthClub, plan offers, FAQPage), dynamic `robots.txt` and `sitemap.xml` per host.
- PDPL cookie consent; GA4 / Meta Pixel load only after consent; CSP allows exactly those vendors.
- Branded bilingual 404 and 500 pages.

## Fixes to pre-existing bugs

- `LIMIT ? OFFSET ?` bound parameters failed on this MySQL (branch, attendance, document, expense and invoice lists).
- `customerRepository.getCustomer` column collision; FAQs always served from the hard-coded list; plan features never saved; scheduled offers shown before their start date; slides created without a branch.

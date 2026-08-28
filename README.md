# Muscle and Fitness Center

Production-oriented bilingual gym management system for `مركز بناء ولياقة الرياضي`.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Setup

1. Copy `.env.example` to `.env` and set database, JWT, SMTP, CORS, and admin secret values.
2. Create the MySQL schema:

```bash
mysql -u root -p < src/db/schema.sql
```

3. Seed public settings and membership plans:

```bash
npm run db:migrate
npm run db:seed
```

`npm run db:migrate` applies safe additive migrations such as enterprise RBAC tables.
Use `npm run db:rollback -- 202606280001_enterprise_rbac` to roll back the latest RBAC migration if needed.

## Enterprise API Modules

The active API is versioned under `/api/v1`. Enterprise modules added by migrations include:

- `/api/v1/branches`
- `/api/v1/customers`
- `/api/v1/invoices`
- `/api/v1/expenses`
- `/api/v1/attendance`
- `/api/v1/documents`
- `/api/v1/reports`
- `/api/v1/search`
- `/api/v1/ai/assistant`

These endpoints reuse existing auth/RBAC middleware and extend existing `users`, `admin_users`, `memberships`, `plans`, `payments`, `settings`, `notifications`, and `logs` tables.

## Architecture

- `public/` contains the bilingual frontend.
- `src/app.js` configures Express security middleware and `/api/v1` routes.
- `src/services/authService.js` implements access JWTs, refresh-cookie rotation, OTP password reset, and admin auth.
- `src/repositories/` contains parameterized MySQL access.
- `src/jobs/cron.js` expires memberships, sends renewal notifications, and cleans OTP tokens.

## Production

Use `ecosystem.config.js` with PM2 and `nginx.conf` as the reverse proxy template. See [DEPLOYMENT.md](DEPLOYMENT.md).

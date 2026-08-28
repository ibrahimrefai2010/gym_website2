# Production Deployment

## Runtime

- Backend: Node.js app from `server.js` on port `3000`.
- Frontend: static files from `public/` or a built `dist/` copy.
- Database: MySQL schema from `src/db/schema.sql`.
- Process manager: PM2 using `ecosystem.config.js`.
- Reverse proxy: Nginx using `nginx.conf`.

## Required Environment

Copy `.env.example` and set production values for database credentials, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, SMTP credentials, `CORS_ORIGIN`, `BASE_URL`, and `ADMIN_REGISTRATION_SECRET`.

## Release Checklist

```bash
npm install
mysql -u <user> -p < src/db/schema.sql
npm run db:seed
npm run check
npm run build
npm run prod:check
pm2 start ecosystem.config.js --env production
```

## Nginx

Use the included `nginx.conf` as the reverse proxy template. It serves `/api/` from `http://localhost:3000` and static files from `/var/www/muscle-fitness/public`.

## Data Rules

- Refresh tokens live only in an `httpOnly; Secure; SameSite=Strict` cookie.
- Access tokens are short-lived and held in browser memory only.
- Membership purchases create pending memberships and pending payments.
- Payment completion activates memberships only when `membership_activation_mode` is `auto`; otherwise admins activate manually.
- Users, plans, offers, and admin users are soft-deleted with `deleted_at`.

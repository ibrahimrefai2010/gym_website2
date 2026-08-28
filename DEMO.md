# Demo deployment (throwaway URL for a client to try)

This gives you **one public URL** the client opens in a browser — no install, no
GitHub account for them. It is a disposable demo, **not** production:

- One free container runs MariaDB + Node together.
- The database is **re-created and re-seeded on every deploy/restart** (all data
  is throwaway sample data).
- On the free tier the service **sleeps after ~15 min idle**; the next visit
  takes **~1–2 minutes** to wake and rebuild the demo data. Open it once
  yourself right before sending the link.
- Password-reset emails are **not** sent (no mail server configured). Everything
  else works.

Files involved: `Dockerfile.demo`, `docker/demo-entrypoint.sh`, `render.yaml`,
`scripts/demo-seed.js`.

---

## Deploy on Render (free, no credit card)

1. **Put the repo on GitHub** (private is fine — Render reads private repos):
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. Go to <https://dashboard.render.com> → sign up / log in with GitHub.

3. **New +** → **Blueprint** → pick this repository. Render reads `render.yaml`
   and creates a Docker web service `muscle-fitness-demo` on the **Free** plan.
   The three secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `ADMIN_REGISTRATION_SECRET`) are generated automatically. `BASE_URL` /
   `CORS_ORIGIN` default to the Render URL on their own.

4. Click **Apply** / **Create**. First build takes ~5–8 min.

5. When it's live you get a URL like
   `https://muscle-fitness-demo.onrender.com` — that's the link to send.

To take it down: delete the service in the Render dashboard.

---

## What the client can do

| Where | Login |
|---|---|
| Public site | `https://<url>/` — browse, EN/AR toggle |
| Member portal | `https://<url>/login.html` → `demo@muscle-fitness.local` / `Demo@12345` |
| Admin dashboard | `https://<url>/login.html` → `admin@demo.local` / `Demo!Admin2026` |

The demo member is pre-loaded with an active membership, an expired one in
history, a completed payment, a digital card + QR, and three notifications, so
every section shows real content. A bottom banner reminds the viewer it's a demo
and shows the member login.

---

## Run the same demo image locally (optional)

```bash
docker build -f Dockerfile.demo -t mfc-demo .
docker run --rm -p 3000:3000 mfc-demo
# open http://localhost:3000
```

## Other hosts

Any host that builds a `Dockerfile` works — point it at `Dockerfile.demo`,
expose port `3000`, and set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`ADMIN_REGISTRATION_SECRET` (any random strings), plus `BASE_URL` /
`CORS_ORIGIN` to the public URL if the platform doesn't set
`RENDER_EXTERNAL_URL`.

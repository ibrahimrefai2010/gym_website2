// Public site plumbing (Part 2 §2.5 / §2.7.7) -- no DB needed for most
// checks; the app boots in DB-less mode when no database is configured.
//
// Covers: robots.txt blocks admin/member/API paths and points at the
// sitemap; the sitemap lists hreflang alternates and never trusts a spoofed
// Host header; unknown website pages get the branded 404 page (API 404s stay
// JSON); the CSP allows exactly the analytics vendors; the bootstrap carries
// the analytics IDs and branch SEO fields.

process.env.GA4_MEASUREMENT_ID = "G-TEST123";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const cron = require("node-cron");

let server;
let port;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test.before(async () => {
  const app = require("../src/app");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  const { getPool } = require("../src/config/database");
  const pool = getPool();
  if (pool) await pool.end();
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("robots.txt hides private areas and points at the sitemap", async () => {
  const res = await get("/robots.txt");
  assert.equal(res.status, 200);
  for (const path of ["/admin.html", "/user.html", "/api/"]) assert.match(res.body, new RegExp(`Disallow: ${path.replace(/\//g, "\\/")}`));
  assert.match(res.body, /Sitemap: https?:\/\/.+\/sitemap\.xml/);
});

test("sitemap has hreflang alternates and ignores a spoofed Host", async () => {
  const { env } = require("../src/config/env");
  const res = await get("/sitemap.xml", { Host: "evil.example" });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /xml/);
  assert.ok(!res.body.includes("evil.example"));
  assert.ok(res.body.includes(String(env.baseUrl).replace(/\/$/, "")));
  assert.match(res.body, /hreflang="ar"/);
  assert.match(res.body, /hreflang="x-default"/);
});

test("unknown pages get the branded 404 page; API 404s stay JSON", async () => {
  const page = await get("/no-such-page", { Accept: "text/html" });
  assert.equal(page.status, 404);
  assert.match(page.body, /الصفحة غير موجودة/);
  assert.match(page.body, /Page not found/);
  const api = await get("/api/v1/no-such-endpoint");
  assert.equal(api.status, 404);
  assert.equal(JSON.parse(api.body).success, false);
});

test("CSP allows exactly the analytics vendors; bootstrap carries analytics + SEO", async () => {
  const res = await get("/api/v1/public/bootstrap");
  const csp = res.headers["content-security-policy"];
  assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/connect\.facebook\.net/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "no inline scripts allowed");
  const data = JSON.parse(res.body).data;
  assert.equal(data.analytics.ga4MeasurementId, "G-TEST123");
  assert.ok(data.contact && "whatsappMessage" in data.contact);
});

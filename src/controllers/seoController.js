// robots.txt and sitemap.xml (Part 2 §2.5 / §2.7.7), generated per request
// host so each branch subdomain advertises its own URLs. The host is only
// trusted when it is on the CORS allowlist; anything else falls back to
// BASE_URL (a spoofed Host header can never inject URLs into the sitemap).

const { env } = require("../config/env");

function siteOrigin(req) {
  const allowed = String(env.corsOrigin || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const candidate = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
  return allowed.includes(candidate) ? candidate : String(env.baseUrl).replace(/\/$/, "");
}

function robots(req, res) {
  const origin = siteOrigin(req);
  res.type("text/plain").send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin.html",
      "Disallow: /user.html",
      "Disallow: /card.html",
      "Disallow: /reset-password.html",
      "Disallow: /api/",
      "",
      `Sitemap: ${origin}/sitemap.xml`,
      ""
    ].join("\n")
  );
}

const PAGES = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/login.html", priority: "0.5", changefreq: "monthly" },
  { path: "/privacy.html", priority: "0.3", changefreq: "yearly" }
];

function sitemap(req, res) {
  const origin = siteOrigin(req);
  const today = new Date().toISOString().slice(0, 10);
  const url = (path, lang) => `${origin}${path}${lang ? `${path.includes("?") ? "&" : "?"}lang=${lang}` : ""}`;
  const entries = PAGES.map(
    (page) => `  <url>
    <loc>${url(page.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${url(page.path, "en")}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${url(page.path, "ar")}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(page.path)}"/>
  </url>`
  ).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`);
}

module.exports = { robots, siteOrigin, sitemap };

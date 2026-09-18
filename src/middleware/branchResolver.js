// Resolves which branch a PUBLIC (unauthenticated) request belongs to, and
// attaches it to req.branch = { id, code } for downstream public handlers
// (bootstrap, public plan/offer listings, register) to use.
//
// Owner-confirmed routing mechanism: subdomain. `women.<domain>` -> the
// Women's branch; the bare/main domain (or `main.`, `www.`, `localhost`,
// anything else unrecognized) -> the Main branch. This mirrors real DNS/nginx
// subdomain routing -- nginx proxies both hostnames to the same Node app
// (see nginx.conf), and branch resolution happens here in Node via
// req.hostname, not in nginx.
//
// SECURITY: this resolver is for PUBLIC routes only. Authenticated routes
// must never use req.branch -- they derive branch exclusively from
// req.user.branchId, which middleware/auth.js sets from the authenticated
// principal's own DB row (never from client input). A logged-in request's
// body/query/header cannot influence which branch it is scoped to.
const { hasDatabaseConfig, query } = require("../config/database");
const { env } = require("../config/env");

const KNOWN_CODES = ["main", "women"];
const FALLBACK_BRANCH = { id: 1, code: "main" };

// Tiny (2-row) reference table -- cache it in memory rather than querying on
// every single public request. Refreshed lazily if a code isn't found (e.g.
// a branch was just added) so this never goes permanently stale.
let cache = null; // Map<code, {id, code}>

async function loadBranches() {
  if (!hasDatabaseConfig()) {
    cache = new Map([["main", FALLBACK_BRANCH]]);
    return cache;
  }
  const rows = await query("SELECT id, code FROM branches WHERE status = 'active' AND deleted_at IS NULL");
  cache = new Map(rows.map((row) => [row.code, { id: row.id, code: row.code }]));
  return cache;
}

async function branchByCode(code) {
  if (!cache || !cache.has(code)) {
    await loadBranches();
  }
  return cache.get(code) || null;
}

function codeFromHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host.startsWith("women.")) {
    return "women";
  }
  return "main";
}

async function resolveBranch(req, _res, next) {
  try {
    let code = codeFromHostname(req.hostname);

    // Dev-only convenience override so a single local machine can exercise
    // both branches without real subdomains/DNS. Public routes only, and
    // explicitly disabled in production -- never trust client input for
    // branch identity outside local development.
    if (env.nodeEnv !== "production") {
      const override = String(req.query.branch || req.get("X-Branch") || "").toLowerCase();
      if (KNOWN_CODES.includes(override)) {
        code = override;
      }
    }

    let branch = await branchByCode(code);
    if (!branch && code !== "main") {
      // Unknown/inactive code -> fall back to Main rather than failing the
      // request (e.g. a stale ?branch= override, or a branch deactivated).
      branch = await branchByCode("main");
    }

    req.branch = branch || FALLBACK_BRANCH;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { resolveBranch };

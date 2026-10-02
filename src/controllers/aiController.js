const aiAssistantService = require("../services/aiAssistantService");
const { resolveReportBranchIds } = require("./reportController");
const { query } = require("../config/database");
const { env } = require("../config/env");
const { createHttpError } = require("../utils/httpError");

// Branch scope is always server-resolved: the admin's effective branch, or
// consolidated (?scope=all) only for admins who can switch branches -- the
// same rule as the finance reports. The client never sends a branch id.
async function resolveScope(req) {
  const branchIds = await resolveReportBranchIds(req);
  const rows = await query(`SELECT id, name_en FROM branches WHERE id IN (${branchIds.map(() => "?").join(",")})`, branchIds);
  return {
    branchIds,
    branchNames: Object.fromEntries(rows.map((row) => [Number(row.id), row.name_en])),
    consolidated: String(req.query.scope || "") === "all"
  };
}

function ensureEnabled() {
  if (!env.aiAssistantEnabled) {
    throw createHttpError(404, "Not found.", "AI_DISABLED");
  }
}

async function status(_req, res) {
  res.json({ success: true, data: { enabled: env.aiAssistantEnabled, mode: env.geminiApiKey ? "ai" : "basic" } });
}

async function ask(req, res) {
  ensureEnabled();
  const data = await aiAssistantService.ask({
    prompt: req.body?.prompt,
    scope: await resolveScope(req),
    admin: { id: req.user.id, role: req.user.role },
    ipAddress: req.ip
  });
  res.json({ success: true, data });
}

async function insights(req, res) {
  ensureEnabled();
  const data = await aiAssistantService.insights(await resolveScope(req));
  res.json({ success: true, data });
}

module.exports = { ask, insights, status };

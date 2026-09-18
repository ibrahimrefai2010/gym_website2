const publicRepository = require("../repositories/publicRepository");
const memberPortalService = require("../services/memberPortalService");
const { createHttpError } = require("../utils/httpError");
const { env } = require("../config/env");

async function bootstrap(req, res) {
  const data = await publicRepository.getBootstrap(req.branch?.id || null);
  res.json({ success: true, data });
}

async function health(_req, res) {
  res.json({
    success: true,
    data: {
    ok: true,
    service: "muscle-fitness",
    demo: env.demoMode,
    timestamp: new Date().toISOString()
    }
  });
}

async function verifyCard(req, res) {
  const token = String(req.params.token || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(token)) {
    throw createHttpError(404, "Membership card not found.", "CARD_NOT_FOUND");
  }
  const data = await memberPortalService.getPublicCard(token);
  if (!data) {
    throw createHttpError(404, "Membership card not found.", "CARD_NOT_FOUND");
  }
  res.json({ success: true, data });
}

module.exports = {
  bootstrap,
  health,
  verifyCard
};

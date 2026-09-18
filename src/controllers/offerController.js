const offerRepository = require("../repositories/offerRepository");
const { createLog } = require("../utils/logger");

// Public route (no auth) -- branch comes from req.branch (subdomain), set by
// the branchResolver middleware mounted ahead of this route in app.js.
async function list(req, res) {
  const data = await offerRepository.listOffers({ branchId: req.branch?.id || null });
  res.json({ success: true, data });
}

// Admin routes (authenticated); see planController.create for the same
// branchId-wiring note (full RBAC enforcement is a later phase).
async function create(req, res) {
  const data = await offerRepository.saveOffer({ ...req.body, branchId: req.body.branchId || req.user?.branchId });
  await createLog("admin", req.user?.id, "offer.create", "offers", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const data = await offerRepository.saveOffer({
    ...req.body,
    id: req.params.id,
    branchId: req.body.branchId || req.user?.branchId
  });
  await createLog("admin", req.user?.id, "offer.update", "offers", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

async function remove(req, res) {
  const data = await offerRepository.deleteOffer(req.params.id);
  await createLog("admin", req.user?.id, "offer.delete", "offers", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  create,
  list,
  remove,
  update
};

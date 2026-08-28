const offerRepository = require("../repositories/offerRepository");
const { createLog } = require("../utils/logger");

async function list(_req, res) {
  const data = await offerRepository.listOffers();
  res.json({ success: true, data });
}

async function create(req, res) {
  const data = await offerRepository.saveOffer(req.body);
  await createLog("admin", req.user?.id, "offer.create", "offers", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const data = await offerRepository.saveOffer({ ...req.body, id: req.params.id });
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

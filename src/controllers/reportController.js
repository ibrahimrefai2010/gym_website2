const reportRepository = require("../repositories/reportRepository");
const { cleanString } = require("../utils/validator");

async function summary(req, res) {
  const data = await reportRepository.summary({
    branchId: cleanString(req.query.branchId, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20)
  });
  res.json({ success: true, data });
}

async function revenue(req, res) {
  const data = await reportRepository.revenueByMonth({
    branchId: cleanString(req.query.branchId, 20),
    months: req.query.months || 12
  });
  res.json({ success: true, data });
}

module.exports = {
  revenue,
  summary
};

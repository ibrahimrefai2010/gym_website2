const attendanceRepository = require("../repositories/attendanceRepository");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function list(req, res) {
  const data = await attendanceRepository.listAttendance({
    ...pagination(req.query),
    branchId: cleanString(req.query.branchId, 20),
    userId: cleanString(req.query.userId, 20),
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20)
  });
  res.json({ success: true, data });
}

async function checkIn(req, res) {
  requireFields(req.body, ["userId"]);
  const data = await attendanceRepository.checkIn(req.body, req.user?.id);
  await createLog("admin", req.user?.id, "attendance.check_in", "attendance_logs", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function checkOut(req, res) {
  const data = await attendanceRepository.checkOut(req.params.id, req.user?.id);
  await createLog("admin", req.user?.id, "attendance.check_out", "attendance_logs", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  checkIn,
  checkOut,
  list
};

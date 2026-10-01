const attendanceRepository = require("../repositories/attendanceRepository");
const checkinService = require("../services/checkinService");
const { createLog } = require("../utils/logger");
const { cleanString, pagination } = require("../utils/validator");

// branchId is server-derived (req.effectiveBranchId), same convention as
// taskController.list/coachController.list -- attendance previously trusted
// a client-supplied query.branchId here, which is the same class of gap
// Part 1's audit closed everywhere else in this app.
async function list(req, res) {
  const data = await attendanceRepository.listAttendance({
    ...pagination(req.query),
    branchId: req.effectiveBranchId || "",
    userId: cleanString(req.query.userId, 20),
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20)
  });
  res.json({ success: true, data });
}

// Reception check-in: resolves the scanned QR / manual entry to a member,
// then hands off to checkinService.verifyAndCheckIn -- the one place that
// decides active-vs-not and either writes the attendance_logs row or
// returns a clear rejection reason. Replaces the old blind
// attendanceRepository.checkIn(req.body, ...) call, which inserted for any
// userId with no membership check at all (see brief's Feature 2 gap #1).
async function checkIn(req, res) {
  const resolved = await checkinService.resolveMember({
    cardToken: req.body.cardToken,
    code: req.body.code,
    userId: req.body.userId,
    query: req.body.query,
    branchId: req.effectiveBranchId || null
  });

  if (!resolved) {
    return res.status(200).json({
      success: true,
      data: { allowed: false, reason: "not_found", member: null }
    });
  }

  const result = await checkinService.verifyAndCheckIn(resolved.userId, req.body.method || "manual", req.user?.id, {
    branchId: req.effectiveBranchId || null,
    notes: cleanString(req.body.notes, 255)
  });

  if (result.allowed && !result.duplicate) {
    await createLog("admin", req.user?.id, "attendance.check_in", "attendance_logs", result.attendance.id, { reason: null }, req.ip, result.member.branchId);
  } else if (!result.allowed) {
    await createLog("admin", req.user?.id, "attendance.check_in_rejected", "users", resolved.userId, { reason: result.reason }, req.ip, req.effectiveBranchId || null);
  }

  res.status(result.allowed && !result.duplicate ? 201 : 200).json({ success: true, data: result });
}

async function checkOut(req, res) {
  const data = await attendanceRepository.checkOut(req.params.id, req.user?.id, req.effectiveBranchId || null);
  await createLog("admin", req.user?.id, "attendance.check_out", "attendance_logs", req.params.id, null, req.ip, req.effectiveBranchId || null);
  res.json({ success: true, data });
}

async function dailyLog(req, res) {
  const data = await attendanceRepository.dailyLog({
    branchId: req.effectiveBranchId || "",
    date: cleanString(req.query.date, 10)
  });
  res.json({ success: true, data });
}

async function heatmap(req, res) {
  const data = await attendanceRepository.heatmap({
    branchId: req.effectiveBranchId || "",
    days: req.query.days
  });
  res.json({ success: true, data });
}

async function summary(req, res) {
  const data = await attendanceRepository.summary({ branchId: req.effectiveBranchId || "" });
  res.json({ success: true, data });
}

module.exports = {
  checkIn,
  checkOut,
  dailyLog,
  heatmap,
  list,
  summary
};

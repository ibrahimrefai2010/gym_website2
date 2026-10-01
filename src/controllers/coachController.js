const coachRepository = require("../repositories/coachRepository");
const { assertBranchOwnership, resolveWriteBranchId } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { requireFields } = require("../utils/validator");

function coachNotFoundError() {
  return createHttpError(404, "Coach not found.", "COACH_NOT_FOUND");
}

async function list(req, res) {
  // branchId is server-derived (req.effectiveBranchId), same pattern as
  // taskController.list/customerController.list -- never taken from the
  // query string.
  const data = await coachRepository.listCoaches({
    branchId: req.effectiveBranchId || "",
    includeInactive: req.query.includeInactive === "true"
  });
  res.json({ success: true, data });
}

async function detail(req, res) {
  const data = await coachRepository.getCoach(req.params.id);
  await assertBranchOwnership(data, req, coachNotFoundError());
  const members = await coachRepository.listAssignedMembers(data.id);
  res.json({ success: true, data: { ...data, members } });
}

async function create(req, res) {
  requireFields(req.body, ["nameEn", "nameAr"]);
  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await coachRepository.saveCoach({ ...req.body, branchId }, req.user?.id);
  await createLog("admin", req.user?.id, "coach.create", "coaches", data.id, null, req.ip, branchId);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  // Ownership must be checked against the coach's *existing* branch before
  // the write resolves its target branch -- same reasoning as
  // planController.update's own comment on this exact gap.
  const existing = await coachRepository.getCoach(req.params.id);
  await assertBranchOwnership(existing, req, coachNotFoundError());

  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await coachRepository.saveCoach({ ...req.body, id: req.params.id, branchId }, req.user?.id);
  await createLog("admin", req.user?.id, "coach.update", "coaches", req.params.id, null, req.ip, branchId);
  res.json({ success: true, data });
}

async function remove(req, res) {
  const existing = await coachRepository.getCoach(req.params.id);
  await assertBranchOwnership(existing, req, coachNotFoundError());

  const data = await coachRepository.deleteCoach(req.params.id, req.user?.id);
  await createLog("admin", req.user?.id, "coach.delete", "coaches", req.params.id, null, req.ip, existing.branchId);
  res.json({ success: true, data });
}

async function assign(req, res) {
  requireFields(req.body, ["userId"]);
  // Ownership check on the coach side first (by-id gap) -- the repository
  // itself re-checks both sides' branch_id independently (see
  // coachRepository.assignMember's own comment), but this also gives a
  // cross-branch coach id the same 404 (not a data-existence-leaking 422)
  // every other by-id route in this app uses.
  const existing = await coachRepository.getCoach(req.params.id);
  await assertBranchOwnership(existing, req, coachNotFoundError());

  const data = await coachRepository.assignMember(req.params.id, req.body.userId, req.user?.id);
  await createLog("admin", req.user?.id, "coach.assign_member", "customer_profiles", req.body.userId, { coachId: req.params.id }, req.ip, existing.branchId);
  res.json({ success: true, data });
}

async function unassign(req, res) {
  const member = await coachRepository.getMemberBranch(req.params.userId);
  await assertBranchOwnership(member, req, createHttpError(404, "Member not found.", "CUSTOMER_NOT_FOUND"));

  const data = await coachRepository.unassignMember(req.params.userId, req.user?.id);
  await createLog("admin", req.user?.id, "coach.unassign_member", "customer_profiles", req.params.userId, null, req.ip, member.branchId);
  res.json({ success: true, data });
}

module.exports = {
  assign,
  create,
  detail,
  list,
  remove,
  unassign,
  update
};

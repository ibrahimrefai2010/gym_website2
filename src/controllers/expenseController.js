const expenseRepository = require("../repositories/expenseRepository");
const { assertBranchOwnership, resolveWriteBranchId } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function categories(_req, res) {
  const data = await expenseRepository.listCategories();
  res.json({ success: true, data });
}

async function list(req, res) {
  const data = await expenseRepository.listExpenses({
    ...pagination(req.query),
    // Server-derived branch, never ?branchId= (expenses feed the Zakat
    // worksheet -- a cross-branch list was a financial data leak).
    branchId: req.effectiveBranchId || "",
    categoryId: cleanString(req.query.categoryId, 20),
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20)
  });
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["title", "amount"]);
  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await expenseRepository.createExpense({ ...req.body, branchId }, req.user?.id);
  await createLog("admin", req.user?.id, "expense.create", "expenses", data.id, null, req.ip, branchId);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const owner = await expenseRepository.getExpenseBranch(req.params.id);
  await assertBranchOwnership(owner, req, createHttpError(404, "Expense not found.", "EXPENSE_NOT_FOUND"));
  const { branchId: _ignored, ...changes } = req.body || {};
  req.body = changes;
  const data = await expenseRepository.updateExpense(req.params.id, req.body, req.user?.id);
  await createLog("admin", req.user?.id, "expense.update", "expenses", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  categories,
  create,
  list,
  update
};

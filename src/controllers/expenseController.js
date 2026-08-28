const expenseRepository = require("../repositories/expenseRepository");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function categories(_req, res) {
  const data = await expenseRepository.listCategories();
  res.json({ success: true, data });
}

async function list(req, res) {
  const data = await expenseRepository.listExpenses({
    ...pagination(req.query),
    branchId: cleanString(req.query.branchId, 20),
    categoryId: cleanString(req.query.categoryId, 20),
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20)
  });
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["title", "amount"]);
  const data = await expenseRepository.createExpense(req.body, req.user?.id);
  await createLog("admin", req.user?.id, "expense.create", "expenses", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
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

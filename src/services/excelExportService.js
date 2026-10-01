// Generic, bilingual Excel export for admin list screens (Part 2 §2.4).
//
// Every list export goes through here so they all look and behave the same:
// one sheet, a bold frozen header row, RTL when the admin asked for Arabic,
// and the rows the screen's own filters produced (the caller builds the
// rows from the same branch-scoped repository query the list uses -- this
// module never queries anything itself, so it can't widen branch scope).
//
// columns: [{ key, en, ar, width?, type? }]  type: "money" | "date" | "datetime"

const ExcelJS = require("exceljs");

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function buildWorkbook(sheets, lang = "en") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muscle and Fitness Center";
  workbook.created = new Date();
  for (const sheet of sheets) {
    addSheet(workbook, sheet, lang);
  }
  return workbook;
}

function addSheet(workbook, { name, columns, rows }, lang = "en") {
  const sheetName = String((name && (name[lang] || name.en)) || name || "Sheet").slice(0, 31);
  const ws = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1, rightToLeft: lang === "ar" }] });
  ws.columns = columns.map((column) => ({
    key: column.key,
    header: lang === "ar" ? column.ar || column.en : column.en,
    width: column.width || 16
  }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    const values = {};
    for (const column of columns) {
      let value = row[column.key];
      if (column.type === "money") value = value == null || value === "" ? null : Number(value);
      if (column.type === "date" || column.type === "datetime") value = toDate(value);
      values[column.key] = value ?? "";
    }
    ws.addRow(values);
  }
  columns.forEach((column, index) => {
    const col = ws.getColumn(index + 1);
    if (column.type === "money") col.numFmt = "#,##0.00";
    if (column.type === "date") col.numFmt = "yyyy-mm-dd";
    if (column.type === "datetime") col.numFmt = "yyyy-mm-dd hh:mm";
  });
  return ws;
}

async function sendWorkbook(res, filename, sheets, lang = "en") {
  const workbook = await buildWorkbook(sheets, lang);
  const safe = String(filename).replace(/[^\w.-]+/g, "-");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Cache-Control", "no-store");
  await workbook.xlsx.write(res);
  res.end();
}

function exportLang(req) {
  return String(req.query.lang || "").toLowerCase() === "ar" ? "ar" : "en";
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { addSheet, buildWorkbook, exportLang, sendWorkbook, stamp };

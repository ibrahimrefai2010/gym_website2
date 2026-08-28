const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { classifyMembership } = require("./memberPortalService");

const ARABIC_FONT = path.join(__dirname, "..", "assets", "fonts", "Amiri-Regular.ttf");
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

const T = {
  sheet: { en: "Members", ar: "الأعضاء" },
  title: { en: "Members export", ar: "تصدير الأعضاء" },
  generated: { en: "Generated", ar: "تاريخ الإنشاء" },
  count: { en: "members", ar: "عضو" },
  none: { en: "No membership", ar: "لا توجد عضوية" }
};

const MEMBERSHIP_STATE = {
  active: { en: "Active", ar: "نشطة" },
  expiring_soon: { en: "Expiring soon", ar: "قريبة الانتهاء" },
  expired: { en: "Expired", ar: "منتهية" },
  pending: { en: "Pending", ar: "قيد الانتظار" },
  cancelled: { en: "Cancelled", ar: "ملغاة" },
  none: { en: "No membership", ar: "لا توجد عضوية" }
};

const ACCOUNT_STATUS = {
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Inactive", ar: "غير نشط" },
  suspended: { en: "Suspended", ar: "موقوف" }
};

function pick(map, key, lang) {
  const entry = map[String(key || "").toLowerCase()];
  return entry ? entry[lang] || entry.en : key || "";
}

function isoDate(value) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function columnDefs(lang) {
  const label = (en, ar) => (lang === "ar" ? ar : en);
  return [
    { key: "memberCode", header: label("Member ID", "رقم العضو"), width: 16 },
    { key: "fullName", header: label("Full name", "الاسم الكامل"), width: 26 },
    { key: "email", header: label("Email", "البريد الإلكتروني"), width: 30 },
    { key: "phone", header: label("Phone", "الجوال"), width: 16 },
    { key: "plan", header: label("Plan", "الباقة"), width: 20 },
    { key: "membershipState", header: label("Membership", "العضوية"), width: 16 },
    { key: "startDate", header: label("Start date", "تاريخ البدء"), width: 14 },
    { key: "endDate", header: label("Expiry date", "تاريخ الانتهاء"), width: 14 },
    { key: "remainingDays", header: label("Days left", "الأيام المتبقية"), width: 12 },
    { key: "accountStatus", header: label("Account", "الحساب"), width: 12 },
    { key: "registeredAt", header: label("Registered", "تاريخ التسجيل"), width: 14 }
  ];
}

function shapeRows(rawRows, lang) {
  return rawRows.map((row) => {
    const classification = classifyMembership(
      row.membership_status
        ? { status: row.membership_status, startDate: row.start_date, endDate: row.end_date }
        : null
    );
    const planName =
      lang === "ar" ? row.plan_ar || row.plan_en : row.plan_en || row.plan_ar;
    return {
      memberCode: row.member_code || "",
      fullName: row.full_name || "",
      email: row.email || "",
      phone: row.phone || "",
      plan: planName || T.none[lang],
      membershipState: pick(MEMBERSHIP_STATE, classification.state, lang),
      startDate: isoDate(classification.startDate || row.start_date),
      endDate: isoDate(classification.endDate || row.end_date),
      remainingDays: classification.remainingDays == null ? "" : classification.remainingDays,
      accountStatus: pick(ACCOUNT_STATUS, row.account_status, lang),
      registeredAt: isoDate(row.created_at)
    };
  });
}

async function buildWorkbook(rawRows, lang) {
  const columns = columnDefs(lang);
  const rows = shapeRows(rawRows, lang);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muscle and Fitness Center";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(T.sheet[lang], {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: lang === "ar" }]
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101010" } };
  headerRow.alignment = { vertical: "middle" };

  rows.forEach((row) => sheet.addRow(row));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  return workbook.xlsx.writeBuffer();
}

function buildPdf(rawRows, lang, options = {}) {
  const columns = columnDefs(lang);
  const rows = shapeRows(rawRows, lang);
  const gymName = options.gymName || "Muscle and Fitness Center";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let hasArabicFont = false;
    try {
      doc.registerFont("arabic", ARABIC_FONT);
      hasArabicFont = true;
    } catch (_error) {
      hasArabicFont = false;
    }

    const font = (text) =>
      hasArabicFont && ARABIC_RE.test(String(text || "")) ? "arabic" : "Helvetica";

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#101010").text(gymName);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#666666")
      .text(
        `${T.generated[lang]}: ${new Date().toISOString().slice(0, 10)}   -   ${rows.length} ${T.count[lang]}`
      );
    doc.moveDown(0.6).fillColor("#000000");

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weightTotal = columns.reduce((sum, column) => sum + column.width, 0);
    const widths = columns.map((column) => (column.width / weightTotal) * usable);
    const xs = [];
    widths.reduce((acc, width, index) => {
      xs[index] = left + acc;
      return acc + width;
    }, 0);

    const rowHeight = 16;
    const bottom = doc.page.height - doc.page.margins.bottom;
    let y = doc.y;

    const drawHeader = () => {
      doc.save().rect(left, y, usable, rowHeight).fill("#101010").restore();
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff");
      columns.forEach((column, index) => {
        doc.text(column.header, xs[index] + 3, y + 4, {
          width: widths[index] - 6,
          lineBreak: false,
          ellipsis: true
        });
      });
      y += rowHeight;
      doc.fillColor("#000000");
    };

    drawHeader();

    rows.forEach((row, rowIndex) => {
      if (y + rowHeight > bottom) {
        doc.addPage();
        y = doc.y;
        drawHeader();
      }
      if (rowIndex % 2 === 1) {
        doc.save().rect(left, y, usable, rowHeight).fill("#f4f2ec").restore();
        doc.fillColor("#000000");
      }
      doc.fontSize(7.5);
      columns.forEach((column, index) => {
        const value = row[column.key] === 0 ? "0" : String(row[column.key] || "");
        doc.font(font(value)).text(value, xs[index] + 3, y + 4, {
          width: widths[index] - 6,
          lineBreak: false,
          ellipsis: true
        });
      });
      y += rowHeight;
    });

    if (rows.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#666666").text("", left, y + 6);
    }

    doc.end();
  });
}

module.exports = {
  buildPdf,
  buildWorkbook
};

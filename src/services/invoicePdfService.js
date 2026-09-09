const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { env } = require("../config/env");
const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { appLogger } = require("../utils/logger");
const invoiceRepository = require("../repositories/invoiceRepository");
const businessSettingsRepository = require("../repositories/businessSettingsRepository");
const { prepareForPdf, isArabicText } = require("../utils/arabicText");

const ARABIC_FONT = path.join(__dirname, "..", "assets", "fonts", "Amiri-Regular.ttf");

const MONEY = (value) => `SAR ${Number(value || 0).toFixed(2)}`;
const PAGE_MARGIN = 40;

function riyadhDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

async function gymNames() {
  if (!hasDatabaseConfig()) return { en: env.appName, ar: env.appName };
  const rows = await query(
    "SELECT key_name, value FROM settings WHERE key_name IN ('gym_name_en','gym_name_ar')"
  );
  const map = Object.fromEntries(rows.map((r) => [r.key_name, r.value]));
  return { en: map.gym_name_en || env.appName, ar: map.gym_name_ar || env.appName };
}

async function loadInvoiceContext(invoiceId) {
  const found = await invoiceRepository.getInvoice(invoiceId);
  if (!found) {
    throw createHttpError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  }
  const [seller, names] = await Promise.all([businessSettingsRepository.get(), gymNames()]);
  return { invoice: found.invoice, items: found.items, seller: seller || {}, names };
}

/**
 * Render a ZATCA Phase 1 simplified tax invoice as a PDF Buffer.
 * @param {number|string} invoiceId
 */
async function renderInvoicePdf(invoiceId) {
  const { invoice, items, seller, names } = await loadInvoiceContext(invoiceId);

  let qrPng = null;
  if (invoice.zatca_qr) {
    try {
      qrPng = await QRCode.toBuffer(invoice.zatca_qr, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 260,
        color: { dark: "#0b0b0b", light: "#ffffff" }
      });
    } catch (error) {
      appLogger.error({ error, invoiceId }, "Failed to render ZATCA QR for invoice PDF");
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let hasArabic = false;
    try {
      doc.registerFont("arabic", ARABIC_FONT);
      hasArabic = true;
    } catch (_error) {
      hasArabic = false;
    }

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // Writes a string picking the Arabic font + shaping when needed.
    const write = (text, x, y, options = {}) => {
      const value = text == null ? "" : String(text);
      const arabic = hasArabic && isArabicText(value);
      doc.font(arabic ? "arabic" : options.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(arabic ? prepareForPdf(value) : value, x, y, {
        width: options.w,
        align: options.align || (arabic ? "right" : "left"),
        lineBreak: options.lineBreak !== false,
        ...options
      });
    };

    // ---- Header -------------------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#101010").text(names.en, left, PAGE_MARGIN, { width: width * 0.6 });
    if (hasArabic) {
      doc.font("arabic").fontSize(13).fillColor("#333333").text(prepareForPdf(names.ar), left, doc.y + 2, {
        width: width * 0.6,
        align: "left"
      });
    }
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#101010")
      .text("SIMPLIFIED TAX INVOICE", left + width * 0.6, PAGE_MARGIN, { width: width * 0.4, align: "right" });
    if (hasArabic) {
      doc
        .font("arabic")
        .fontSize(11)
        .fillColor("#333333")
        .text(prepareForPdf("فاتورة ضريبية مبسطة"), left + width * 0.6, doc.y + 2, {
          width: width * 0.4,
          align: "right"
        });
    }

    let y = Math.max(doc.y, PAGE_MARGIN + 54) + 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
    y += 12;

    // ---- Seller / Buyer boxes -------------------------------------------------
    const colW = (width - 16) / 2;
    const sellerLines = [
      ["Seller / البائع", true],
      [seller.legalEntityNameEn || names.en],
      [seller.legalEntityNameAr || names.ar],
      [`VAT No: ${seller.vatNumber || "-"}`],
      [`CR No: ${seller.crNumber || "-"}`],
      [
        [
          seller.streetAr || seller.streetEn,
          seller.districtAr || seller.districtEn,
          seller.cityAr || seller.cityEn,
          seller.countryCode
        ]
          .filter(Boolean)
          .join("، ")
      ]
    ];
    const buyerLines = [
      ["Buyer / المشتري", true],
      [invoice.buyer_name || invoice.customer || "-"],
      [`Phone: ${invoice.buyer_phone || invoice.phone || "-"}`],
      invoice.buyer_vat_number ? [`VAT No: ${invoice.buyer_vat_number}`] : null
    ].filter(Boolean);

    const boxTop = y;
    const drawBox = (lines, x) => {
      let ly = boxTop + 8;
      for (const [text, bold] of lines) {
        doc.fontSize(bold ? 9.5 : 9).fillColor(bold ? "#101010" : "#333333");
        write(text, x + 8, ly, { w: colW - 16, bold });
        ly = doc.y + 3;
      }
      return ly;
    };
    const sellerBottom = drawBox(sellerLines, left);
    const buyerBottom = drawBox(buyerLines, left + colW + 16);
    const boxBottom = Math.max(sellerBottom, buyerBottom) + 6;
    doc.rect(left, boxTop, colW, boxBottom - boxTop).strokeColor("#dddddd").stroke();
    doc.rect(left + colW + 16, boxTop, colW, boxBottom - boxTop).strokeColor("#dddddd").stroke();
    y = boxBottom + 14;

    // ---- Invoice meta ------------------------------------------------------
    doc.font("Helvetica").fontSize(9.5).fillColor("#333333");
    doc.text(`Invoice No: ${invoice.invoice_number}`, left, y);
    doc.text(
      `Issue date (${env.timezone}): ${riyadhDateTime(invoice.issued_at || invoice.issue_date)}`,
      left,
      doc.y + 2
    );
    doc.text(`Status: ${String(invoice.status || "").toUpperCase()}`, left, doc.y + 2);
    y = doc.y + 12;

    // ---- Items table -----------------------------------------------------
    const cols = [
      { key: "idx", label: "#", w: 0.05, align: "left" },
      { key: "desc", label: "Description", w: 0.37, align: "left" },
      { key: "qty", label: "Qty", w: 0.09, align: "right" },
      { key: "unit", label: "Unit (excl. VAT)", w: 0.17, align: "right" },
      { key: "vat", label: "VAT 15%", w: 0.15, align: "right" },
      { key: "total", label: "Line total", w: 0.17, align: "right" }
    ];
    const xs = [];
    cols.reduce((acc, c) => {
      xs.push(left + acc * width);
      return acc + c.w;
    }, 0);
    const cw = (i) => cols[i].w * width;

    const rowH = 18;
    const headerFill = "#101010";
    doc.save().rect(left, y, width, rowH).fill(headerFill).restore();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    cols.forEach((c, i) => doc.text(c.label, xs[i] + 3, y + 5, { width: cw(i) - 6, align: c.align, lineBreak: false }));
    y += rowH;

    const bottomLimit = doc.page.height - doc.page.margins.bottom - 170;
    items.forEach((item, index) => {
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      if (index % 2 === 1) {
        doc.save().rect(left, y, width, rowH).fill("#f5f3ee").restore();
      }
      doc.fillColor("#000000").fontSize(8.5);
      const unit = Number(item.unit_price);
      const cells = [
        String(index + 1),
        item.description || "",
        String(Number(item.quantity)),
        unit.toFixed(2),
        Number(item.tax_amount).toFixed(2),
        Number(item.line_total).toFixed(2)
      ];
      cells.forEach((value, i) => {
        const arabic = hasArabic && isArabicText(value);
        doc.font(arabic ? "arabic" : "Helvetica");
        doc.text(arabic ? prepareForPdf(value) : value, xs[i] + 3, y + 5, {
          width: cw(i) - 6,
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true
        });
      });
      y += rowH;
    });
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
    y += 10;

    // ---- Totals ---------------------------------------------------------
    const totalsX = left + width * 0.55;
    const totalsW = width * 0.45;
    const totalRow = (label, value, bold) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9.5).fillColor("#101010");
      doc.text(label, totalsX, y, { width: totalsW * 0.55, align: "left" });
      doc.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: "right" });
      y = doc.y + 4;
    };
    totalRow("Subtotal (excl. VAT)", MONEY(invoice.subtotal));
    if (Number(invoice.discount_total) > 0) totalRow("Discount", `- ${MONEY(invoice.discount_total)}`);
    totalRow("Total VAT (15%)", MONEY(invoice.tax_total));
    totalRow("Grand total", MONEY(invoice.total), true);
    if (Number(invoice.paid_total) > 0) {
      totalRow("Paid", MONEY(invoice.paid_total));
      totalRow("Balance due", MONEY(invoice.balance_due));
    }

    // ---- ZATCA QR + footer --------------------------------------------
    const qrY = doc.page.height - doc.page.margins.bottom - 130;
    if (qrPng) {
      doc.image(qrPng, left, qrY, { width: 110 });
      doc.font("Helvetica").fontSize(7).fillColor("#666666").text("ZATCA e-invoice QR", left, qrY + 114, { width: 110, align: "center" });
    }
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#888888")
      .text(
        "This is a simplified tax invoice issued under ZATCA Phase 1. Amounts in Saudi Riyal (SAR).",
        left + 130,
        qrY + 90,
        { width: width - 130 }
      );

    doc.end();
  });
}

module.exports = { renderInvoicePdf };

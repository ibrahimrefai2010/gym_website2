// ZATCA (Saudi ZATCA / Fatoora) Phase 1 "generation phase" QR payload for a
// simplified tax invoice.
//
// The payload is a TLV byte string, Base64-encoded. Five tags, in order:
//   1  Seller name                (UTF-8)
//   2  VAT registration number    (UTF-8, 15 digits)
//   3  Invoice timestamp          (ISO 8601, e.g. 2026-09-09T18:30:00Z)
//   4  Invoice total with VAT     (decimal string, 2 dp)
//   5  VAT total                  (decimal string, 2 dp)
//
// Each field: 1 byte tag + 1 byte length (UTF-8 byte length of the value) +
// value bytes. Concatenate all five, then Base64-encode.

function tlv(tag, value) {
  const valueBuf = Buffer.from(String(value), "utf8");
  if (valueBuf.length > 255) {
    throw new Error(`ZATCA QR: TLV value for tag ${tag} is ${valueBuf.length} bytes (max 255).`);
  }
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

function toIso8601(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("ZATCA QR: invalid timestamp.");
  }
  // ZATCA accepts ISO 8601; use second precision with a trailing Z.
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeAmount(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`ZATCA QR: ${label} must be a non-negative number.`);
  }
  return number.toFixed(2);
}

/**
 * Build the Base64 ZATCA Phase 1 QR payload for a simplified tax invoice.
 *
 * @param {object} p
 * @param {string} p.sellerName           Registered seller / legal entity name.
 * @param {string} p.vatNumber            15-digit VAT registration number.
 * @param {Date|string|number} p.timestamp Invoice issue instant.
 * @param {number|string} p.invoiceTotal  Grand total including VAT.
 * @param {number|string} p.vatTotal      Total VAT amount.
 * @returns {string} Base64 string to encode into the QR image.
 */
function buildZatcaQrBase64({ sellerName, vatNumber, timestamp, invoiceTotal, vatTotal }) {
  const name = String(sellerName || "").trim();
  if (!name) {
    throw new Error("ZATCA QR: sellerName is required.");
  }
  if (!/^\d{15}$/.test(String(vatNumber || ""))) {
    throw new Error("ZATCA QR: vatNumber must be exactly 15 digits.");
  }

  const payload = Buffer.concat([
    tlv(1, name),
    tlv(2, String(vatNumber)),
    tlv(3, toIso8601(timestamp)),
    tlv(4, normalizeAmount(invoiceTotal, "invoiceTotal")),
    tlv(5, normalizeAmount(vatTotal, "vatTotal"))
  ]);

  return payload.toString("base64");
}

/**
 * Decode a Base64 ZATCA QR payload back to a { tag: value } map. For tests and
 * for validating generated invoices; not used in the hot path.
 */
function decodeZatcaQrBase64(base64) {
  const buffer = Buffer.from(String(base64), "base64");
  const fields = {};
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    if (offset + 2 + length > buffer.length) {
      throw new Error("ZATCA QR: truncated TLV payload.");
    }
    fields[tag] = buffer.subarray(offset + 2, offset + 2 + length).toString("utf8");
    offset += 2 + length;
  }
  return fields;
}

module.exports = { buildZatcaQrBase64, decodeZatcaQrBase64 };

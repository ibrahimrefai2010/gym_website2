const test = require("node:test");
const assert = require("node:assert/strict");
const { buildZatcaQrBase64, decodeZatcaQrBase64 } = require("../src/utils/zatcaQr");

const SELLER = "Muscle and Fitness Center";
const VAT = "310160591300003";

test("produces valid base64 that round-trips to the five ZATCA tags", () => {
  const b64 = buildZatcaQrBase64({
    sellerName: SELLER,
    vatNumber: VAT,
    timestamp: "2026-09-09T18:30:00Z",
    invoiceTotal: 402.5,
    vatTotal: 52.5
  });
  assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/);

  const decoded = decodeZatcaQrBase64(b64);
  assert.equal(decoded[1], SELLER);
  assert.equal(decoded[2], VAT);
  assert.equal(decoded[3], "2026-09-09T18:30:00Z");
  assert.equal(decoded[4], "402.50");
  assert.equal(decoded[5], "52.50");
});

test("TLV framing: tag, byte-length, value in order 1..5", () => {
  const b64 = buildZatcaQrBase64({
    sellerName: SELLER,
    vatNumber: VAT,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    invoiceTotal: "115.00",
    vatTotal: "15.00"
  });
  const buf = Buffer.from(b64, "base64");
  // Tag 1
  assert.equal(buf[0], 1);
  assert.equal(buf[1], Buffer.byteLength(SELLER, "utf8"));
  // Walk to tag 2 and check it is the VAT number tag with length 15.
  const afterTag1 = 2 + buf[1];
  assert.equal(buf[afterTag1], 2);
  assert.equal(buf[afterTag1 + 1], 15);
});

test("Arabic seller name uses UTF-8 byte length, not char length", () => {
  const arabic = "مؤسسة مركز بناء ولياقة الرياضي";
  const b64 = buildZatcaQrBase64({
    sellerName: arabic,
    vatNumber: VAT,
    timestamp: "2026-09-09T18:30:00Z",
    invoiceTotal: 100,
    vatTotal: 13.04
  });
  const buf = Buffer.from(b64, "base64");
  assert.equal(buf[0], 1);
  assert.equal(buf[1], Buffer.byteLength(arabic, "utf8"));
  assert.notEqual(buf[1], arabic.length); // byte length != char length for Arabic
  assert.equal(decodeZatcaQrBase64(b64)[1], arabic);
});

test("amounts are always formatted to 2 decimal places", () => {
  const decoded = decodeZatcaQrBase64(
    buildZatcaQrBase64({
      sellerName: SELLER,
      vatNumber: VAT,
      timestamp: "2026-09-09T18:30:00Z",
      invoiceTotal: 7,
      vatTotal: 0
    })
  );
  assert.equal(decoded[4], "7.00");
  assert.equal(decoded[5], "0.00");
});

test("rejects a VAT number that is not 15 digits", () => {
  assert.throws(
    () => buildZatcaQrBase64({ sellerName: SELLER, vatNumber: "12345", timestamp: Date.now(), invoiceTotal: 1, vatTotal: 0 }),
    /15 digits/
  );
});

test("rejects an invalid timestamp and negative amounts", () => {
  assert.throws(
    () => buildZatcaQrBase64({ sellerName: SELLER, vatNumber: VAT, timestamp: "not-a-date", invoiceTotal: 1, vatTotal: 0 }),
    /invalid timestamp/
  );
  assert.throws(
    () => buildZatcaQrBase64({ sellerName: SELLER, vatNumber: VAT, timestamp: Date.now(), invoiceTotal: -1, vatTotal: 0 }),
    /non-negative/
  );
});

test("rejects a seller name longer than 255 UTF-8 bytes", () => {
  assert.throws(
    () =>
      buildZatcaQrBase64({
        sellerName: "x".repeat(256),
        vatNumber: VAT,
        timestamp: Date.now(),
        invoiceTotal: 1,
        vatTotal: 0
      }),
    /max 255/
  );
});

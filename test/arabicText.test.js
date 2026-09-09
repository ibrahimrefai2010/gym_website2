const test = require("node:test");
const assert = require("node:assert/strict");
const { isArabicText, shapeArabic, reorderForRtl, prepareForPdf } = require("../src/utils/arabicText");

const inPresentationBlock = (str) =>
  Array.from(str).every((ch) => {
    const cp = ch.codePointAt(0);
    return (
      (cp >= 0xfb50 && cp <= 0xfeff) || // Arabic presentation forms A + B
      cp === 0x20 || // space
      (cp >= 0x30 && cp <= 0x39) || // digits
      (cp >= 0x41 && cp <= 0x7a) // latin
    );
  });

const hasRawArabicBlock = (str) =>
  Array.from(str).some((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x0600 && cp <= 0x06ff;
  });

test("pure Latin / ASCII passes through untouched", () => {
  assert.equal(prepareForPdf("Muscle and Fitness Center"), "Muscle and Fitness Center");
  assert.equal(prepareForPdf("INV-1447-000001"), "INV-1447-000001");
  assert.equal(isArabicText("Hello 123"), false);
});

test("shapeArabic maps letters to contextual presentation forms", () => {
  // الله : alef(isolated) lam(initial) lam(medial) heh(final)
  assert.equal(shapeArabic("الله"), "ﺍﻟﻠﻪ");
  const shaped = shapeArabic("مركز بناء ولياقة الرياضي");
  assert.ok(inPresentationBlock(shaped), `unexpected chars in: ${shaped}`);
  assert.equal(hasRawArabicBlock(shaped), false, "no unshaped Arabic-block letters remain");
});

test("lam-alef ligature", () => {
  assert.equal(shapeArabic("لا"), "ﻻ"); // isolated ligature
  assert.equal(shapeArabic("بلا"), "ﺑﻼ"); // beh connects -> final-form ligature
});

test("reorderForRtl reverses Arabic but keeps digit runs in reading order", () => {
  const out = prepareForPdf("الرحاب 1");
  assert.equal(hasRawArabicBlock(out), false);
  // "1" must land to the LEFT of the Arabic word in the LTR-rendered string.
  assert.ok(out.indexOf("1") < out.search(/[ﭐ-﻿]/), `got: ${out}`);
});

test("prepareForPdf on a mixed address keeps the Latin token upright", () => {
  const out = prepareForPdf("جازان SA");
  assert.ok(out.includes("SA"));
  assert.equal(hasRawArabicBlock(out), false);
  // Latin run kept in order (not "AS")
  assert.ok(out.includes("SA") && !out.includes("AS"));
});

test("round-trip letter count is preserved for a plain word (no ligatures)", () => {
  // مدير = 4 letters, no lam-alef, no combining marks
  assert.equal(Array.from(shapeArabic("مدير")).length, 4);
});

test("combining harakat are dropped rather than corrupting the reversal", () => {
  const withHaraka = "مُحَمَّد";
  const out = shapeArabic(withHaraka);
  assert.equal(hasRawArabicBlock(out), false);
  assert.ok(inPresentationBlock(out));
});

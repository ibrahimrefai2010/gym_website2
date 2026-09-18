const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const invoiceRepository = require("../src/repositories/invoiceRepository");
const businessSettingsRepository = require("../src/repositories/businessSettingsRepository");

const noDb = !hasDatabaseConfig();

test.after(async () => {
  const pool = getPool();
  if (pool) await pool.end();
});

test("Hijri-year invoice numbers are sequential and gap-free under concurrency", { skip: noDb }, async () => {
  const users = await query("SELECT id FROM users ORDER BY id LIMIT 1");
  if (!users[0]) {
    return; // nothing to attach an invoice to on this database
  }
  const userId = users[0].id;
  const item = { description: "Test line", quantity: 1, unitPrice: 100, taxRate: 15, itemType: "other" };

  // No branchId passed -> createInvoice defaults to branch 1 (Main).
  const branch = await query("SELECT code FROM branches WHERE id = 1 LIMIT 1");
  const tag = branch[0].code[0].toUpperCase();

  // Snapshot existing seqs so the assertion is independent of prior data.
  const before = await query("SELECT hijri_year, last_seq FROM invoice_counters WHERE branch_id = 1");
  const baseline = new Map(before.map((r) => [r.hijri_year, Number(r.last_seq)]));

  const created = await Promise.all(
    Array.from({ length: 12 }, () => invoiceRepository.createInvoice({ userId, items: [item] }))
  );
  const ids = created.map((c) => c.id);

  try {
    const rows = await query(
      `SELECT hijri_year, invoice_seq, invoice_number FROM invoices WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY invoice_seq`,
      ids
    );
    const year = rows[0].hijri_year;
    const start = (baseline.get(year) || 0) + 1;
    const expected = Array.from({ length: 12 }, (_, i) => start + i);
    assert.deepEqual(rows.map((r) => Number(r.invoice_seq)), expected, "sequence has no gaps or duplicates");
    for (const r of rows) {
      assert.equal(r.invoice_number, `INV-${tag}-${year}-${String(r.invoice_seq).padStart(6, "0")}`);
    }
    const uniqueNumbers = new Set(rows.map((r) => r.invoice_number));
    assert.equal(uniqueNumbers.size, rows.length, "invoice numbers are unique");
  } finally {
    await query(`DELETE FROM invoice_items WHERE invoice_id IN (${ids.map(() => "?").join(",")})`, ids);
    await query(`DELETE FROM invoices WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  }
});

test("invoice numbers are branch-scoped: two branches can share the same Hijri-year sequence number", { skip: noDb }, async () => {
  const users = await query("SELECT id FROM users ORDER BY id LIMIT 1");
  const women = await query("SELECT id, code FROM branches WHERE code = 'women' LIMIT 1");
  if (!users[0] || !women[0]) {
    return; // needs a user and the Women's branch row (added by this feature's migration)
  }
  const userId = users[0].id;
  const womenBranchId = women[0].id;
  const item = { description: "Test line", quantity: 1, unitPrice: 100, taxRate: 15, itemType: "other" };

  // createInvoice refuses to issue when the branch has no 15-digit VAT number
  // configured yet (by design -- see businessSettingsRepository). The
  // Women's branch row this migration creates is intentionally blank until
  // an admin fills in its real registration, so seed a throwaway VAT number
  // for the duration of this test and restore it afterwards.
  const originalSettings = await businessSettingsRepository.get(womenBranchId);
  await businessSettingsRepository.update(
    { vatNumber: "310160591300099", legalEntityNameEn: "Test Women Branch", legalEntityNameAr: "فرع تجريبي" },
    null,
    womenBranchId
  );

  const mainInvoice = await invoiceRepository.createInvoice({ userId, branchId: 1, items: [item] });
  const womenInvoice = await invoiceRepository.createInvoice({ userId, branchId: womenBranchId, items: [item] });

  try {
    const rows = await query("SELECT id, branch_id, invoice_number FROM invoices WHERE id IN (?, ?)", [
      mainInvoice.id,
      womenInvoice.id
    ]);
    const main = rows.find((r) => r.id === mainInvoice.id);
    const women2 = rows.find((r) => r.id === womenInvoice.id);
    assert.match(main.invoice_number, /^INV-M-\d+-\d{6}$/, "Main branch invoice number is tagged M");
    assert.match(women2.invoice_number, /^INV-W-\d+-\d{6}$/, "Women's branch invoice number is tagged W");
    assert.notEqual(main.invoice_number, women2.invoice_number);
  } finally {
    await query("DELETE FROM invoice_items WHERE invoice_id IN (?, ?)", [mainInvoice.id, womenInvoice.id]);
    await query("DELETE FROM invoices WHERE id IN (?, ?)", [mainInvoice.id, womenInvoice.id]);
    await businessSettingsRepository.update(
      {
        vatNumber: originalSettings?.vatNumber || "",
        legalEntityNameEn: originalSettings?.legalEntityNameEn || "",
        legalEntityNameAr: originalSettings?.legalEntityNameAr || ""
      },
      null,
      womenBranchId
    );
  }
});

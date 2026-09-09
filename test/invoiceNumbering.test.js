const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const invoiceRepository = require("../src/repositories/invoiceRepository");

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

  // Snapshot existing seqs so the assertion is independent of prior data.
  const before = await query("SELECT hijri_year, last_seq FROM invoice_counters");
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
      assert.equal(r.invoice_number, `INV-${year}-${String(r.invoice_seq).padStart(6, "0")}`);
    }
    const uniqueNumbers = new Set(rows.map((r) => r.invoice_number));
    assert.equal(uniqueNumbers.size, rows.length, "invoice numbers are unique");
  } finally {
    await query(`DELETE FROM invoice_items WHERE invoice_id IN (${ids.map(() => "?").join(",")})`, ids);
    await query(`DELETE FROM invoices WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  }
});

// Umm al-Qura (islamic-umalqura) Hijri date helpers, evaluated in the
// business timezone (Asia/Riyadh). Used for ZATCA invoice numbering and the
// Zakat worksheet, both of which are keyed to the Hijri year.

const { env } = require("../config/env");

const YEAR_FORMATTER = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
  timeZone: env.timezone,
  year: "numeric"
});

/**
 * Hijri year (integer, e.g. 1447) for the given instant, in Asia/Riyadh.
 * @param {Date|string|number} [instant] Defaults to now.
 */
function hijriYear(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error("hijriYear: invalid date.");
  }
  // Formatter output looks like "1447 AH" -> take the leading digits.
  const formatted = YEAR_FORMATTER.format(date);
  const match = formatted.match(/\d+/);
  if (!match) {
    throw new Error(`hijriYear: could not parse "${formatted}".`);
  }
  return Number(match[0]);
}

module.exports = { hijriYear };

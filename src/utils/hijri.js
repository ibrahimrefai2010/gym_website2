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

// Gregorian start/end dates (YYYY-MM-DD, Asia/Riyadh) of a Hijri year --
// used to bound the Zakat worksheet's expense/revenue queries. Estimates
// the start from the mean Hijri year length, then scans day by day around
// it with the same Umm al-Qura formatter, so it is exact for that calendar.
function hijriYearBounds(year) {
  const target = Number(year);
  if (!Number.isInteger(target) || target < 1300 || target > 1600) {
    throw new Error("hijriYearBounds: year out of range.");
  }
  const DAY = 86400000;
  const epoch = Date.UTC(622, 6, 16);
  const estimate = epoch + (target - 1) * 354.36708 * DAY;
  // Noon UTC = 15:00 Riyadh, safely inside the local calendar day.
  const dayAt = (ms) => new Date(Math.floor(ms / DAY) * DAY + 12 * 3600000);
  let start = dayAt(estimate - 40 * DAY);
  while (hijriYear(start) < target) start = new Date(start.getTime() + DAY);
  let end = dayAt(start.getTime() + 350 * DAY);
  while (hijriYear(new Date(end.getTime() + DAY)) === target) end = new Date(end.getTime() + DAY);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

module.exports = { hijriYear, hijriYearBounds };

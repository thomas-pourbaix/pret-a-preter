/**
 * French formatting and tolerant parsing.
 *
 * The interface is in French and every figure is displayed fr-FR, but the code and the
 * engine stay locale-neutral: nothing here is imported by src/core/finance.js.
 */

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const euroRounded = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});

const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" });

export const formatEuro = (value) => euro.format(value);
export const formatEuroRounded = (value) => euroRounded.format(value);
export const formatMonth = (date) => monthLabel.format(date);

export const formatNumber = (value, decimals = 2) =>
  value.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

export const formatPercent = (value, decimals = 3) =>
  formatNumber(value * 100, decimals) + " %";

/**
 * Accepts what a French keyboard produces: `200 000`, `1 234,56`, narrow and
 * non-breaking spaces included. Returns NaN on anything it cannot read, so the caller
 * can show a message instead of letting NaN reach the screen.
 *
 * @param {string} raw
 * @returns {number}
 */
export function parseFrenchNumber(raw) {
  if (typeof raw !== "string") return NaN;

  const cleaned = raw
    .replace(/[\s\u00A0\u202F\u2009]/g, "") // plain, non-breaking and narrow spaces
    .replace(/,/g, ".")
    .replace(/[^\d.\-]/g, "");

  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  return Number(cleaned);
}

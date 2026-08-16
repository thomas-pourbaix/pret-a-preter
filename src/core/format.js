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

const longMonthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

const dayLabel = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export const formatEuro = (value) => euro.format(value);
export const formatEuroRounded = (value) => euroRounded.format(value);
export const formatMonth = (date) => monthLabel.format(date);
/** Spelled out, for prose rather than for a column of figures: « octobre 2026 ». */
export const formatLongMonth = (date) => longMonthLabel.format(date);
/** A calendar date as a French contract writes it: 05/10/2026. */
export const formatDate = (date) => dayLabel.format(date);

export const formatNumber = (value, decimals = 2) =>
  value.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

export const formatPercent = (value, decimals = 3) =>
  formatNumber(value * 100, decimals) + " %";

/**
 * The step a rate is read in: five hundredths of a point, the same quantum the rate field
 * is typed in.
 *
 * A rate the solver lands on is a full-precision number — 2,9116 % — because it was chosen
 * to make whole-euro instalments settle a debt to the cent, not because anyone negotiated
 * four decimals. Printed as it stands it is unreadable and, worse, it invites comparison at
 * a precision that means nothing: nobody haggles over eleven ten-thousandths of a point.
 * So the headline is read on the grid the negotiation actually uses, and the exact figure
 * is stated beside it, since that is the one the schedule was computed from.
 */
export const RATE_STEP = 0.0005;

/** Nearest step, without the binary drift that turns 0,029 into 0,028999999999999998. */
export const roundToRateStep = (value) =>
  Number((Math.round(value / RATE_STEP) * RATE_STEP).toFixed(6));

/** A rate as it is negotiated: « 2,90 % ». */
export const formatSteppedPercent = (value) => formatPercent(roundToRateStep(value), 2);

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

/**
 * CSV export, tuned for a French Excel: semicolon separator, UTF-8 BOM so accents
 * survive the double-click, and comma decimal separators so figures land as numbers
 * rather than as text.
 */

import { round2, toIsoDate } from "../core/finance.js";
import { scheduleHeaders } from "./xlsx.js";

/** French Excel reads `1234,56`, never `1234.56`. */
const decimal = (value) => String(value).replace(".", ",");

/**
 * Renders the schedule as CSV text, BOM included.
 *
 * @param {object} solved result of solveLoan()
 * @param {{constantEuros?: boolean}} [options] same columns as the workbook
 * @returns {string}
 */
export function buildCsv(solved, { constantEuros = true } = {}) {
  const lines = [scheduleHeaders({ constantEuros }).join(";")];

  solved.schedule.forEach((row) => {
    lines.push(
      [
        row.number,
        toIsoDate(row.date),
        decimal(row.instalment),
        decimal(row.interest),
        decimal(row.capital),
        decimal(row.balance),
        decimal(row.cumulativeInterest),
        decimal(row.cumulativeCapital),
        ...(constantEuros
          ? [
              decimal(round2(row.constantBalance)),
              decimal(round2(row.constantCumulativeInterest))
            ]
          : [])
      ].join(";")
    );
  });

  return "﻿" + lines.join("\r\n");
}

/**
 * Hands the CSV to the browser as a download.
 *
 * @param {object} solved result of solveLoan()
 * @param {string} filename
 * @param {{constantEuros?: boolean}} [options]
 */
export function exportCsv(solved, filename = "echeancier-pret.csv", options) {
  if (!solved || !solved.schedule.length) return;

  const blob = new Blob([buildCsv(solved, options)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

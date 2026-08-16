/**
 * CSV export, tuned for a French Excel: semicolon separator, UTF-8 BOM so accents
 * survive the double-click, and comma decimal separators so figures land as numbers
 * rather than as text.
 */

import { round2, toIsoDate } from "../core/finance.js";
import {
  columnHeading,
  scheduleColumns,
  scheduleGroups
} from "../core/schedule-columns.js";
import { GENERATED_BY } from "../core/version.js";

/** French Excel reads `1234,56`, never `1234.56`. */
const decimal = (value) => String(value).replace(".", ",");

/**
 * Renders the schedule as CSV text, BOM included.
 *
 * Two header rows, as in the workbook and on screen: the three families first, spread over
 * the columns they name, then the columns themselves. Colour cannot cross into a text file,
 * but the grouping can, and a schedule laid out one way on screen and another in the file
 * exported from it is two documents to reconcile.
 *
 * The last line names the application and its version. It is separated by a blank line, so
 * a reader importing the file can drop the tail without touching the figures.
 *
 * @param {object} solved result of solveLoan()
 * @param {{constantEuros?: boolean}} [options] same columns as the workbook
 * @returns {string}
 */
export function buildCsv(solved, options) {
  const columns = scheduleColumns(options);
  const groups = scheduleGroups(options);

  const lines = [
    groups
      .flatMap((group) =>
        group.columns.map((_column, index) => (index === 0 && group.label ? group.label : ""))
      )
      .join(";"),
    columns.map(columnHeading).join(";")
  ];

  solved.schedule.forEach((row) => {
    lines.push(
      columns
        .map((column) =>
          column.type === "date"
            ? toIsoDate(row[column.key])
            : column.type === "money"
              ? decimal(round2(row[column.key]))
              : row[column.key]
        )
        .join(";")
    );
  });

  lines.push("", GENERATED_BY);

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

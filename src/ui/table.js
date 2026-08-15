/**
 * The schedule table: instalments grouped by calendar year, with a subtotal row per
 * year and two levels of detail.
 */

import { formatEuro, formatMonth } from "../core/format.js";
import { round2 } from "../core/finance.js";

/**
 * @param {object} params
 * @param {HTMLElement} params.tbody target, cleared on each render
 * @param {Array<object>} params.schedule rows from buildSchedule()
 * @param {"monthly"|"yearly"} params.view whether to list the individual instalments
 */
export function renderTable({ tbody, schedule, view }) {
  tbody.replaceChildren();
  if (!schedule.length) return;

  const fragment = document.createDocumentFragment();

  for (const [year, rows] of groupByYear(schedule)) {
    const last = rows[rows.length - 1];

    fragment.appendChild(
      buildRow(
        [
          `Année ${year}`,
          `${rows.length} éch.`,
          formatEuro(total(rows, "instalment")),
          formatEuro(total(rows, "interest")),
          formatEuro(total(rows, "capital")),
          formatEuro(last.balance),
          formatEuro(last.cumulativeInterest),
          formatEuro(last.cumulativeCapital)
        ],
        "year-row"
      )
    );

    if (view !== "monthly") continue;

    for (const row of rows) {
      const tr = buildRow(
        [
          String(row.number),
          formatMonth(row.date),
          formatEuro(row.instalment),
          formatEuro(row.interest),
          formatEuro(row.capital),
          formatEuro(row.balance),
          formatEuro(row.cumulativeInterest),
          formatEuro(row.cumulativeCapital)
        ],
        row.adjusted ? "adjusted-row" : ""
      );

      if (row.adjusted) {
        const flag = document.createElement("span");
        flag.className = "flag";
        flag.textContent = "ajustée";
        tr.children[2].append(" ", flag);
      }

      tr.children[3].classList.add("interest");
      tr.children[4].classList.add("capital");
      fragment.appendChild(tr);
    }
  }

  tbody.appendChild(fragment);
}

function groupByYear(schedule) {
  const groups = new Map();
  for (const row of schedule) {
    const year = row.date.getFullYear();
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(row);
  }
  return groups;
}

const total = (rows, key) => round2(rows.reduce((sum, row) => sum + row[key], 0));

/** Cells are set as text, never as HTML: nothing here goes through innerHTML. */
function buildRow(cells, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;

  for (const value of cells) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.appendChild(td);
  }

  return tr;
}

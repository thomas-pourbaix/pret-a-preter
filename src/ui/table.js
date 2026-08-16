/**
 * The schedule table: instalments grouped by calendar year, with a subtotal row per
 * year and two levels of detail.
 *
 * Columns come from src/core/schedule-columns.js, which is also what the workbook, the CSV
 * and the annex of the deed lay themselves out from. Both header rows are written here
 * rather than in the page, because the constant-euro family comes and goes with the
 * inflation view and a header that no longer matches its columns is worse than none.
 */

import { formatEuro, formatMonth } from "../core/format.js";
import { round2 } from "../core/finance.js";
import { columnHeading, scheduleColumns, scheduleGroups } from "../core/schedule-columns.js";

/** Which ground a family is drawn on. `identity` keeps the paper of the panel. */
const GROUND = {
  instalment: "g-instalment",
  loan: "g-loan",
  inflation: "g-inflation"
};

/**
 * @param {object} params
 * @param {HTMLElement} params.thead target for the two header rows
 * @param {HTMLElement} params.tbody target, cleared on each render
 * @param {Array<object>} params.schedule rows from buildSchedule()
 * @param {"monthly"|"yearly"} params.view whether to list the individual instalments
 * @param {boolean} [params.constantEuros] whether the inflation family is shown
 */
export function renderTable({ thead, tbody, schedule, view, constantEuros = true }) {
  const columns = scheduleColumns({ constantEuros });

  renderHead(thead, { constantEuros });
  tbody.replaceChildren();
  if (!schedule.length) return;

  const fragment = document.createDocumentFragment();

  for (const [year, rows] of groupByYear(schedule)) {
    const last = rows[rows.length - 1];

    fragment.appendChild(
      buildRow(
        columns,
        {
          number: `Année ${year}`,
          date: `${rows.length} éch.`,
          instalment: formatEuro(total(rows, "instalment")),
          interest: formatEuro(total(rows, "interest")),
          capital: formatEuro(total(rows, "capital")),
          balance: formatEuro(last.balance),
          cumulativeInterest: formatEuro(last.cumulativeInterest),
          cumulativeCapital: formatEuro(last.cumulativeCapital),
          constantBalance: formatEuro(last.constantBalance),
          constantCumulativeInterest: formatEuro(last.constantCumulativeInterest)
        },
        "year-row"
      )
    );

    if (view !== "monthly") continue;

    for (const row of rows) {
      const tr = buildRow(columns, {
        number: String(row.number),
        date: formatMonth(row.date),
        instalment: formatEuro(row.instalment),
        interest: formatEuro(row.interest),
        capital: formatEuro(row.capital),
        balance: formatEuro(row.balance),
        cumulativeInterest: formatEuro(row.cumulativeInterest),
        cumulativeCapital: formatEuro(row.cumulativeCapital),
        constantBalance: formatEuro(row.constantBalance),
        constantCumulativeInterest: formatEuro(row.constantCumulativeInterest)
      });

      fragment.appendChild(tr);
    }
  }

  tbody.appendChild(fragment);
}

/**
 * Two rows: the families, then the columns. The family row is what the colours hang off,
 * and each column keeps its unit on a line of its own so « Capital restant dû » and
 * « Capital restant dû (€ constants) » are told apart at a glance.
 */
function renderHead(thead, { constantEuros }) {
  const groups = scheduleGroups({ constantEuros });

  const groupRow = document.createElement("tr");
  groupRow.className = "groups";

  const columnRow = document.createElement("tr");
  columnRow.className = "columns";

  for (const group of groups) {
    const ground = GROUND[group.key] || "identity";

    const head = document.createElement("th");
    head.scope = "colgroup";
    head.colSpan = group.columns.length;
    head.className = `${ground}${group.key === "identity" ? "" : " first-of-group"}`;
    head.textContent = group.label ? group.label.toUpperCase() : "";
    groupRow.appendChild(head);

    group.columns.forEach((column, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.className = [
        GROUND[group.key] || "",
        index === 0 && group.key !== "identity" ? "first-of-group" : ""
      ]
        .filter(Boolean)
        .join(" ");

      cell.append(document.createTextNode(column.label));
      if (column.unit) {
        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = column.unit;
        cell.appendChild(unit);
      }
      columnRow.appendChild(cell);
    });
  }

  thead.replaceChildren(groupRow, columnRow);
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
function buildRow(columns, values, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;

  columns.forEach((column, index) => {
    const td = document.createElement("td");
    td.textContent = values[column.key];

    const previous = index > 0 ? columns[index - 1].group : null;
    td.className = [
      GROUND[column.group] || "",
      column.group !== previous && column.group !== "identity" ? "first-of-group" : "",
      column.key === "interest" ? "interest" : "",
      column.key === "capital" ? "capital" : ""
    ]
      .filter(Boolean)
      .join(" ");

    tr.appendChild(td);
  });

  return tr;
}

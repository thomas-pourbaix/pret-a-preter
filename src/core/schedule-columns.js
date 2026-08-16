/**
 * The columns of the repayment schedule, and the three families they fall into.
 *
 * One model, read by the table on screen, the workbook, the CSV and the annex of the deed,
 * because a schedule that is laid out one way on screen and another in the file exported
 * from it is two documents the reader has to reconcile. Asked for in the fifth round of
 * feedback: « matérialise avec des fonds colorés différents les 3 grandes catégories.
 * Propage partout où tu affiches l'échéancier. »
 *
 * The three families answer three different questions:
 *
 *   - **la mensualité** — what leaves the account this month, and how it splits;
 *   - **l'état du prêt** — where the loan stands after it;
 *   - **l'effet de l'inflation** — the same two figures in euros of the day it started.
 *
 * The identifying columns (rank and date) belong to no family: they say which row this is,
 * not what it holds.
 *
 * Nothing here formats anything. Each consumer reads `key` and renders the value in its own
 * terms — euros to the cent on screen, a real number in the workbook, a comma decimal in
 * the CSV — and reads `label` and `group` to lay the header out the same way everywhere.
 */

/** Column families, in the order they are read. `key` is what the colours are keyed on. */
export const SCHEDULE_GROUPS = [
  {
    key: "identity",
    label: null,
    columns: [
      { key: "number", label: "N°", type: "rank" },
      { key: "date", label: "Échéance", type: "date" }
    ]
  },
  {
    key: "instalment",
    label: "La mensualité",
    columns: [
      { key: "instalment", label: "Mensualité", unit: "€", type: "money" },
      { key: "interest", label: "Intérêts", unit: "€", type: "money" },
      { key: "capital", label: "Capital amorti", unit: "€", type: "money" }
    ]
  },
  {
    key: "loan",
    label: "L'état du prêt",
    columns: [
      { key: "balance", label: "Capital restant dû", unit: "€", type: "money" },
      { key: "cumulativeInterest", label: "Intérêts cumulés", unit: "€", type: "money" },
      { key: "cumulativeCapital", label: "Capital remboursé", unit: "€", type: "money" }
    ]
  },
  {
    key: "inflation",
    label: "L'effet de l'inflation",
    columns: [
      {
        key: "constantBalance",
        label: "Capital restant dû",
        unit: "€ constants",
        type: "money"
      },
      {
        key: "constantCumulativeInterest",
        label: "Intérêts cumulés",
        unit: "€ constants",
        type: "money"
      }
    ]
  }
];

/**
 * The groups to lay out.
 *
 * The constant-euro family is dropped when the reader has turned the inflation view off,
 * and is never offered at all where a contract is being written — see INV-016: purchasing
 * power is a reading of the loan, and the schedule annexed to a deed is one of its terms.
 *
 * @param {{constantEuros?: boolean}} [options]
 * @returns {Array<object>}
 */
export function scheduleGroups({ constantEuros = true } = {}) {
  return constantEuros
    ? SCHEDULE_GROUPS
    : SCHEDULE_GROUPS.filter((group) => group.key !== "inflation");
}

/** The columns themselves, flattened, each carrying the key of the family it belongs to. */
export function scheduleColumns(options) {
  return scheduleGroups(options).flatMap((group) =>
    group.columns.map((column) => ({ ...column, group: group.key }))
  );
}

/** A column's full heading — « Capital restant dû (€ constants) ». */
export const columnHeading = (column) =>
  column.unit ? `${column.label} (${column.unit})` : column.label;

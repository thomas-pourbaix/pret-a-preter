/**
 * Spreadsheet export — values only.
 *
 * Live formulas were taken out of scope, so the workbook carries computed values with
 * proper number formats rather than a recalculating model. Everything the reader needs
 * to redo the arithmetic by hand is on the Hypothèses sheet.
 *
 * The writer is injected rather than imported so this module can be exercised outside a
 * browser; in the page it resolves to the vendored write-excel-file UMD bundle.
 */

const MONEY = "#,##0.00";
const RATE_MONTHLY = "0.00000%";
const RATE_ANNUAL = "0.000%";
const DATE = "dd/mm/yyyy";

const SHEET_ASSUMPTIONS = "Hypothèses";
const SHEET_SCHEDULE = "Échéancier";

export const SCHEDULE_HEADERS = [
  "N°",
  "Échéance",
  "Mensualité (€)",
  "Intérêts (€)",
  "Capital amorti (€)",
  "Capital restant dû (€)",
  "Intérêts cumulés (€)",
  "Capital remboursé (€)",
  "Capital restant dû (€ constants)",
  "Intérêts cumulés (€ constants)"
];

/** Same petrol ink as the page, so the workbook reads as part of the same tool. */
const INK = "#17262B";
const RULE = "#DCE5E4";

/**
 * Header cells: reversed out of the dark ink, and aligned the way their column is, so
 * the label sits over its own figures rather than drifting away from them.
 */
const header = (value, align = "right") => ({
  value,
  type: String,
  fontWeight: "bold",
  color: "#FFFFFF",
  backgroundColor: INK,
  align,
  alignVertical: "center",
  wrap: true
});

const money = (value) => ({ value, type: Number, format: MONEY, align: "right" });
const label = (value) => ({ value, type: String });
const note = (value) => ({ value, type: String, color: "#5F757C" });

/**
 * Builds the two sheets of the workbook.
 *
 * @param {object} solved result of solveLoan()
 * @returns {{sheets: Array, columns: Array}} write-excel-file payload
 */
export function buildWorkbook(solved) {
  const {
    principal,
    periods,
    schedule,
    rate,
    annualNominalRate,
    annualEquivalentRate,
    payment,
    effectiveCost,
    targetCost,
    costDrift,
    rateIsKnown,
    iterations
  } = solved;

  const assumptions = [
    [header("Hypothèse", "left"), header("Valeur", "left"), header("Note", "left")],
    [
      label("Capital emprunté (€)"),
      money(principal),
      note("saisi")
    ],
    [
      label("Nombre de mensualités"),
      { value: periods, type: Number },
      note("saisi")
    ],
    [
      label("Taux mensuel"),
      { value: rate, type: Number, format: RATE_MONTHLY },
      {
        value: solved.roundPayment.applied
          ? "choisi pour que la mensualité ronde solde exactement"
          : rateIsKnown
            ? "taux annuel nominal / 12"
            : `résolu par dichotomie, ${iterations} itérations`,
        type: String
      }
    ],
    [
      label("Mensualité (€)"),
      money(payment),
      {
        value: solved.roundPayment.applied
          ? "euros ronds, identique sur les " + periods + " échéances"
          : "arrondie au centime, dernière échéance ajustée",
        type: String
      }
    ],
    [
      label("Taux annuel nominal"),
      { value: annualNominalRate, type: Number, format: RATE_ANNUAL },
      note("taux mensuel × 12 (taux proportionnel)")
    ],
    [
      label("Taux annuel équivalent"),
      { value: annualEquivalentRate, type: Number, format: RATE_ANNUAL },
      note("(1 + taux mensuel)^12 − 1 (actuariel)")
    ],
    [
      label("Taux d'inflation annuel"),
      { value: solved.annualInflation, type: Number, format: RATE_ANNUAL, align: "right" },
      note("saisi ; sert à exprimer les montants en euros constants")
    ],
    [
      label("Taux annuel réel"),
      { value: solved.realAnnualRate, type: Number, format: RATE_ANNUAL, align: "right" },
      note("(1 + taux nominal) / (1 + inflation) − 1, formule de Fisher")
    ],
    [
      label("Coût total des intérêts (€)"),
      money(effectiveCost),
      note("somme de la colonne Intérêts")
    ],
    [
      label(rateIsKnown ? "Coût déduit du taux (€)" : "Coût saisi (€)"),
      money(round2(targetCost)),
      note("hypothèse de départ")
    ],
    [
      label("Écart d'arrondi (€)"),
      money(costDrift),
      {
        value: solved.roundPayment.applied
          ? "coût effectif − hypothèse, dû à la mensualité en euros ronds"
          : "coût effectif − hypothèse, dû aux arrondis au centime",
        type: String
      }
    ],
    [
      label("Coût des intérêts (€ constants)"),
      money(solved.constantCost),
      note("chaque échéance déflatée à sa propre date, puis sommée")
    ],
    [
      label("Première échéance"),
      schedule.length
        ? { value: schedule[0].date, type: Date, format: DATE }
        : { value: null, type: String },
      note("saisie")
    ],
    [],
    [
      {
        value:
          "Hors assurance emprunteur, frais de dossier, garantie et frais annexes : ce n'est pas un TAEG.",
        type: String
      }
    ]
  ];

  // The first two columns identify the row rather than measure it, so they are aligned
  // left and are the two that stay put when the sheet is scrolled sideways.
  const scheduleRows = [
    SCHEDULE_HEADERS.map((text, column) => header(text, column < 2 ? "left" : "right")),
    ...schedule.map((row) => [
      { value: row.number, type: Number, align: "left" },
      { value: row.date, type: Date, format: DATE, align: "left" },
      money(row.instalment),
      money(row.interest),
      money(row.capital),
      money(row.balance),
      money(row.cumulativeInterest),
      money(row.cumulativeCapital),
      money(row.constantBalance),
      money(row.constantCumulativeInterest)
    ])
  ];

  // write-excel-file takes one object per sheet, each carrying its own column widths and
  // its own frozen panes.
  return [
    {
      sheet: SHEET_ASSUMPTIONS,
      data: assumptions,
      columns: [{ width: 34 }, { width: 20 }, { width: 52 }],
      stickyRowsCount: 1
    },
    {
      sheet: SHEET_SCHEDULE,
      data: scheduleRows,
      // The header row and the two identifying columns stay visible: on a 240-row
      // schedule, scrolling to instalment 180 otherwise loses both the column names and
      // the date of the row being read.
      stickyRowsCount: 1,
      stickyColumnsCount: 2,
      columns: [
        { width: 6 },
        { width: 13 },
        { width: 15 },
        { width: 13 },
        { width: 18 },
        { width: 20 },
        { width: 18 },
        { width: 20 },
        { width: 26 },
        { width: 26 }
      ]
    }
  ];
}

/** Local copy of the rounding helper, to keep this module free of core imports. */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Writes the workbook and hands it to the browser as a download.
 *
 * @param {object} solved result of solveLoan()
 * @param {string} filename
 * @param {Function} [writer] injectable write-excel-file entry point
 */
export async function exportXlsx(solved, filename = "echeancier-pret.xlsx", writer) {
  const write = writer || globalThis.writeXlsxFile;
  if (typeof write !== "function") {
    throw new Error("write-excel-file is not loaded");
  }
  if (!solved || !solved.schedule.length) return;

  await write(buildWorkbook(solved)).toFile(filename);
}

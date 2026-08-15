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
  "Capital remboursé (€)"
];

const header = (value) => ({ value, type: String, fontWeight: "bold" });
const money = (value) => ({ value, type: Number, format: MONEY });

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
    [header("Hypothèse"), header("Valeur"), header("Note")],
    [
      { value: "Capital emprunté (€)", type: String },
      money(principal),
      { value: "saisi", type: String }
    ],
    [
      { value: "Nombre de mensualités", type: String },
      { value: periods, type: Number },
      { value: "saisi", type: String }
    ],
    [
      { value: "Taux mensuel", type: String },
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
      { value: "Mensualité (€)", type: String },
      money(payment),
      {
        value: solved.roundPayment.applied
          ? "euros ronds, identique sur les " + periods + " échéances"
          : "arrondie au centime, dernière échéance ajustée",
        type: String
      }
    ],
    [
      { value: "Taux annuel nominal", type: String },
      { value: annualNominalRate, type: Number, format: RATE_ANNUAL },
      { value: "taux mensuel × 12 (taux proportionnel)", type: String }
    ],
    [
      { value: "Taux annuel équivalent", type: String },
      { value: annualEquivalentRate, type: Number, format: RATE_ANNUAL },
      { value: "(1 + taux mensuel)^12 − 1 (actuariel)", type: String }
    ],
    [
      { value: "Coût total des intérêts (€)", type: String },
      money(effectiveCost),
      { value: "somme de la colonne Intérêts", type: String }
    ],
    [
      { value: rateIsKnown ? "Coût déduit du taux (€)" : "Coût saisi (€)", type: String },
      money(round2(targetCost)),
      { value: "hypothèse de départ", type: String }
    ],
    [
      { value: "Écart d'arrondi (€)", type: String },
      money(costDrift),
      {
        value: solved.roundPayment.applied
          ? "coût effectif − hypothèse, dû à la mensualité en euros ronds"
          : "coût effectif − hypothèse, dû aux arrondis au centime",
        type: String
      }
    ],
    [
      { value: "Première échéance", type: String },
      schedule.length
        ? { value: schedule[0].date, type: Date, format: DATE }
        : { value: null, type: String },
      { value: "saisie", type: String }
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

  const scheduleRows = [
    SCHEDULE_HEADERS.map(header),
    ...schedule.map((row) => [
      { value: row.number, type: Number },
      { value: row.date, type: Date, format: DATE },
      money(row.instalment),
      money(row.interest),
      money(row.capital),
      money(row.balance),
      money(row.cumulativeInterest),
      money(row.cumulativeCapital)
    ])
  ];

  // write-excel-file takes one object per sheet, each carrying its own column widths.
  return [
    {
      sheet: SHEET_ASSUMPTIONS,
      data: assumptions,
      columns: [{ width: 30 }, { width: 18 }, { width: 46 }]
    },
    {
      sheet: SHEET_SCHEDULE,
      data: scheduleRows,
      columns: [
        { width: 6 },
        { width: 13 },
        { width: 15 },
        { width: 13 },
        { width: 18 },
        { width: 20 },
        { width: 18 },
        { width: 20 }
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

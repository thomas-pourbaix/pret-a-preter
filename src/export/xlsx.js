/**
 * Spreadsheet export — values only.
 *
 * Live formulas were taken out of scope, so the workbook carries computed values with
 * proper number formats rather than a recalculating model. Everything the reader needs
 * to redo the arithmetic by hand is on the Hypothèses sheet.
 *
 * The writer is injected rather than imported so this module can be exercised outside a
 * browser; in the page it resolves to the vendored write-excel-file UMD bundle.
 *
 * Layout is computed from the data rather than guessed (see fitColumns / headerHeight):
 * hand-picked widths left half a column of blank either side of every figure, and a
 * wrapped header with no row height set is clipped to one line by the spreadsheet.
 */

import { VERSION } from "../core/version.js";

const MONEY = "#,##0.00";
const RATE_MONTHLY = "0.00000%";
const RATE_ANNUAL = "0.000%";
const DATE = "dd/mm/yyyy";

const SHEET_ASSUMPTIONS = "Hypothèses";
const SHEET_SCHEDULE = "Échéancier";

/** Every column of the schedule, constant-euro readings included. */
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

/** How many trailing columns belong to the constant-euro reading. */
const CONSTANT_COLUMNS = 2;

/**
 * The columns to write. The constant-euro pair is dropped when the reader has turned the
 * inflation view off on screen: exporting a reading they chose not to look at would put
 * two columns of purchasing power next to figures they asked to see in current euros.
 *
 * @param {{constantEuros?: boolean}} [options]
 * @returns {Array<string>}
 */
export function scheduleHeaders({ constantEuros = true } = {}) {
  return constantEuros
    ? SCHEDULE_HEADERS
    : SCHEDULE_HEADERS.slice(0, SCHEDULE_HEADERS.length - CONSTANT_COLUMNS);
}

/** Same petrol ink as the page, so the workbook reads as part of the same tool. */
const INK = "#17262B";
/** Every other row, faintly, so the eye keeps its line across ten columns. */
const BAND = "#F1F5F4";

/** Excel column widths are in characters; a value wants a little air on either side. */
const PADDING = 2;
/** Rows are in points: one wrapped line of the default 11 pt font, plus its leading. */
const LINE_HEIGHT = 15;
/** Prose columns stop widening here rather than push the figures off the screen. */
const MAX_WIDTH = 56;
/**
 * A header may stack this many lines. Beyond it the column is widened a character at a
 * time instead: the figures are short, so a header left to wrap freely would tower over
 * its own column — five words down a ten-character column costs far more vertical room
 * than the one or two characters of white that buy a line back.
 */
const MAX_HEADER_LINES = 3;

/**
 * Header cells: reversed out of the dark ink, wrapped, and centred over their column.
 * The row height that makes the wrap visible is set by headerHeight().
 *
 * The font colour property is `textColor`, and this is not a detail: write-excel-file
 * ignores an unknown cell property in silence, so `color` produced a header written in the
 * default black on a near-black fill — legible in the payload, invisible in the workbook.
 * Nothing errored, nothing warned; the trap is that the wrong name looks right.
 */
const header = (value) => ({
  value,
  type: String,
  fontWeight: "bold",
  textColor: "#FFFFFF",
  backgroundColor: INK,
  align: "center",
  alignVertical: "center",
  wrap: true
});

const money = (value) => ({ value, type: Number, format: MONEY });
const label = (value) => ({ value, type: String, align: "left" });
const note = (value) => ({ value, type: String, textColor: "#5F757C", align: "left" });

/* ------------------------------------------------------------------------ layout */

/** A wrapped header can be no narrower than its longest unbreakable word. */
const longestWord = (text) =>
  String(text ?? "")
    .split(/\s+/)
    .reduce((most, word) => Math.max(most, word.length), 0);

/** How many lines `text` takes once wrapped at `width` characters. */
function wrappedLines(text, width) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return 1;

  let lines = 1;
  let used = words[0].length;

  for (const word of words.slice(1)) {
    if (used + 1 + word.length <= width) {
      used += 1 + word.length;
    } else {
      lines++;
      used = word.length;
    }
  }
  return lines;
}

const integerDigits = (value) =>
  Math.max(1, Math.floor(Math.log10(Math.abs(value) || 1)) + 1);

/**
 * Width of a number once the spreadsheet has printed it: sign, thousands separators,
 * decimal separator and decimals all take room the raw value does not show.
 */
function numberWidth(value, format) {
  const percent = format === RATE_MONTHLY || format === RATE_ANNUAL;
  const decimals = format === RATE_MONTHLY ? 5 : format === RATE_ANNUAL ? 3 : format === MONEY ? 2 : 0;
  const printed = percent ? value * 100 : value;
  const digits = integerDigits(printed);

  return (
    (printed < 0 ? 1 : 0) +
    digits +
    (format === MONEY ? Math.floor((digits - 1) / 3) : 0) +
    (decimals ? decimals + 1 : 0) +
    (percent ? 1 : 0)
  );
}

/** Width of one cell's printed content, in characters. */
function printedWidth(cell) {
  if (!cell || cell.value == null) return 0;
  if (cell.type === Date) return 10; // dd/mm/yyyy
  if (cell.type === Number) return numberWidth(cell.value, cell.format);
  return String(cell.value).length;
}

/**
 * Column widths taken from what is actually in the column: the widest figure below, and
 * the longest word of the header above, since the header wraps and no longer dictates the
 * width on its own. Prose columns are capped, or a sixty-character note would set the
 * width of the whole sheet.
 *
 * @param {Array<Array<object>>} rows header row first
 * @returns {Array<number>}
 */
function fitColumns(rows) {
  const count = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const widths = [];

  for (let column = 0; column < count; column++) {
    let widest = 0;

    rows.forEach((row, index) => {
      const cell = row[column];
      const width = index === 0 ? longestWord(cell && cell.value) : printedWidth(cell);
      if (width > widest) widest = width;
    });

    let width = Math.min(widest + PADDING, MAX_WIDTH);

    const label = rows[0][column] && rows[0][column].value;
    while (width < MAX_WIDTH && wrappedLines(label, width - PADDING) > MAX_HEADER_LINES) {
      width++;
    }

    widths.push(width);
  }

  return widths;
}

/**
 * Height the header row needs for its longest wrapped label. Without it the spreadsheet
 * keeps the default one-line height and clips everything below the first line, which is
 * exactly what makes a wrapped header unreadable.
 */
function headerHeight(headerRow, widths) {
  const lines = headerRow.reduce(
    (most, cell, column) =>
      Math.max(most, wrappedLines(cell.value, widths[column] - PADDING)),
    1
  );
  return lines * LINE_HEIGHT + 6;
}

/**
 * Applies the reading aids that are pure presentation: values centred on both axes, one
 * row in two tinted. Cells keep any alignment they set for themselves, which is how the
 * prose columns of the Hypothèses sheet stay left-aligned.
 */
function dress(dataRows) {
  return dataRows.map((row, index) =>
    row.map((cell) =>
      cell == null
        ? cell
        : {
            align: "center",
            alignVertical: "center",
            ...(index % 2 ? { backgroundColor: BAND } : {}),
            ...cell
          }
    )
  );
}

/** Assembles a sheet: header row measured, data rows dressed, columns fitted. */
function sheet(name, headerRow, dataRows, extra = {}) {
  const widths = fitColumns([headerRow, ...dataRows]);
  const height = headerHeight(headerRow, widths);

  return {
    sheet: name,
    data: [headerRow.map((cell) => ({ ...cell, height })), ...dress(dataRows)],
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1,
    ...extra
  };
}

/* ------------------------------------------------------------------------ workbook */

/**
 * Builds the two sheets of the workbook.
 *
 * @param {object} solved result of solveLoan()
 * @param {{constantEuros?: boolean}} [options] whether to carry the constant-euro columns
 * @returns {Array} write-excel-file payload, one object per sheet
 */
export function buildWorkbook(solved, { constantEuros = true } = {}) {
  const {
    principal,
    periods,
    schedule,
    rate,
    annualNominalRate,
    payment,
    effectiveCost,
    targetCost,
    costDrift,
    rateIsKnown,
    iterations
  } = solved;

  const assumptions = [
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
      note(
        solved.roundPayment.applied
          ? "choisi pour que la mensualité ronde solde exactement"
          : rateIsKnown
            ? "taux annuel nominal / 12"
            : `résolu par dichotomie, ${iterations} itérations`
      )
    ],
    [
      label("Mensualité (€)"),
      money(payment),
      note(
        solved.roundPayment.applied
          ? "euros ronds, identique sur les " + periods + " échéances"
          : "arrondie au centime, dernière échéance ajustée"
      )
    ],
    [
      label("Taux annuel nominal"),
      { value: annualNominalRate, type: Number, format: RATE_ANNUAL },
      note("taux mensuel × 12 (taux proportionnel)")
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
      note(
        solved.roundPayment.applied
          ? "coût effectif − hypothèse, dû à la mensualité en euros ronds"
          : "coût effectif − hypothèse, dû aux arrondis au centime"
      )
    ],
    ...(constantEuros
      ? [
          [
            label("Taux d'inflation annuel"),
            { value: solved.annualInflation, type: Number, format: RATE_ANNUAL },
            note("saisi ; sert à exprimer les montants en euros constants")
          ],
          [
            label("Taux annuel réel"),
            { value: solved.realAnnualRate, type: Number, format: RATE_ANNUAL },
            note("(1 + taux nominal) / (1 + inflation) − 1, formule de Fisher")
          ],
          [
            label("Coût des intérêts (€ constants)"),
            money(solved.constantCost),
            note("chaque échéance déflatée à sa propre date, puis sommée")
          ]
        ]
      : []),
    [
      label("Première échéance"),
      schedule.length
        ? { value: schedule[0].date, type: Date, format: DATE }
        : { value: null, type: String },
      note("saisie")
    ],
    // Which build produced the file. A workbook outlives the tab it was exported from,
    // and a figure questioned six months later is only checkable against a known version.
    [label("Version de l'outil"), label(VERSION), note("échéancier de prêt")]
  ];

  const headers = scheduleHeaders({ constantEuros });

  const scheduleRows = schedule.map((row) =>
    [
      { value: row.number, type: Number },
      { value: row.date, type: Date, format: DATE },
      money(row.instalment),
      money(row.interest),
      money(row.capital),
      money(row.balance),
      money(row.cumulativeInterest),
      money(row.cumulativeCapital),
      ...(constantEuros
        ? [money(row.constantBalance), money(row.constantCumulativeInterest)]
        : [])
    ]
  );

  // write-excel-file takes one object per sheet, each carrying its own column widths and
  // its own frozen panes.
  return [
    sheet(
      SHEET_ASSUMPTIONS,
      [header("Hypothèse"), header("Valeur"), header("Note")],
      assumptions
    ),
    sheet(SHEET_SCHEDULE, headers.map(header), scheduleRows, {
      // The header row and the two identifying columns stay visible: on a 240-row
      // schedule, scrolling to instalment 180 otherwise loses both the column names and
      // the date of the row being read.
      stickyColumnsCount: 2
    })
  ];
}

/**
 * Local copy of the rounding helper: this module takes nothing from the core but the
 * version string, and no arithmetic at all. Two lines of duplication buy an export layer
 * that could be lifted out whole.
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Writes the workbook and hands it to the browser as a download.
 *
 * @param {object} solved result of solveLoan()
 * @param {string} filename
 * @param {{constantEuros?: boolean}} [options]
 * @param {Function} [writer] injectable write-excel-file entry point
 */
export async function exportXlsx(solved, filename = "echeancier-pret.xlsx", options, writer) {
  const write = writer || globalThis.writeXlsxFile;
  if (typeof write !== "function") {
    throw new Error("write-excel-file is not loaded");
  }
  if (!solved || !solved.schedule.length) return;

  await write(buildWorkbook(solved, options)).toFile(filename);
}

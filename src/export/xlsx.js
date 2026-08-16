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

import { APP_NAME, APP_TAGLINE, VERSION } from "../core/version.js";
import {
  columnHeading,
  scheduleColumns,
  scheduleGroups
} from "../core/schedule-columns.js";

const MONEY = "#,##0.00";
const RATE_MONTHLY = "0.00000%";
const RATE_ANNUAL = "0.000%";
const DATE = "dd/mm/yyyy";

const SHEET_ASSUMPTIONS = "Hypothèses";
const SHEET_SCHEDULE = "Échéancier";

/**
 * The columns to write, as headings.
 *
 * Taken from the shared model, so the workbook, the CSV, the table on screen and the annex
 * of the deed cannot drift apart. The constant-euro pair is dropped when the reader has
 * turned the inflation view off on screen: exporting a reading they chose not to look at
 * would put two columns of purchasing power next to figures they asked to see in current
 * euros.
 *
 * @param {{constantEuros?: boolean}} [options]
 * @returns {Array<string>}
 */
export function scheduleHeaders(options) {
  return scheduleColumns(options).map(columnHeading);
}

/** Every column of the schedule, constant-euro readings included. */
export const SCHEDULE_HEADERS = scheduleHeaders();

/** Same petrol ink as the page, so the workbook reads as part of the same tool. */
const INK = "#17262B";
/** Every other row, faintly, so the eye keeps its line across the assumptions. */
const BAND = "#F1F5F4";

/**
 * The three families of schedule columns, in the same three tones as the page: a dark one
 * for the group heading, a wash of it for the figures beneath. Ten columns of figures all
 * on the same white are a wall; three grounds make them three answers.
 */
const GROUP_TONE = {
  identity: { head: INK, wash: "#FFFFFF" },
  instalment: { head: "#4B3A7A", wash: "#F5F2FB" },
  loan: { head: "#1F6F78", wash: "#EEF5F5" },
  inflation: { head: "#8A6A2F", wash: "#F9F4EA" }
};

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
const header = (value, backgroundColor = INK) => ({
  value,
  type: String,
  fontWeight: "bold",
  textColor: "#FFFFFF",
  backgroundColor,
  align: "center",
  alignVertical: "center",
  wrap: true
});

/**
 * A group heading, stretched over the columns it names.
 *
 * `span` is what write-excel-file merges on; the cells it covers must still be present in
 * the row, as nulls, or the merge writes past the end of it.
 */
const groupHeader = (value, columns, backgroundColor) => [
  { ...header(value, backgroundColor), span: columns },
  ...Array.from({ length: columns - 1 }, () => null)
];

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
 * the longest word of the column heading above, since the heading wraps and no longer
 * dictates the width on its own. Prose columns are capped, or a sixty-character note would
 * set the width of the whole sheet.
 *
 * A group heading takes no part in this: it is stretched over several columns, so its
 * length says nothing about any one of them.
 *
 * @param {Array<Array<object>>} headerRows the column-heading row last
 * @param {Array<Array<object>>} dataRows
 * @returns {Array<number>}
 */
function fitColumns(headerRows, dataRows) {
  const headings = headerRows[headerRows.length - 1];
  const count = [...headerRows, ...dataRows].reduce(
    (most, row) => Math.max(most, row.length),
    0
  );
  const widths = [];

  for (let column = 0; column < count; column++) {
    let widest = longestWord(headings[column] && headings[column].value);

    for (const row of dataRows) {
      const width = printedWidth(row[column]);
      if (width > widest) widest = width;
    }

    let width = Math.min(widest + PADDING, MAX_WIDTH);

    const label = headings[column] && headings[column].value;
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
      cell == null ? most : Math.max(most, wrappedLines(cell.value, widths[column] - PADDING)),
    1
  );
  return lines * LINE_HEIGHT + 6;
}

/**
 * Applies the reading aids that are pure presentation: values centred on both axes, and a
 * ground behind them — one row in two on a sheet of assumptions, the colour of its own
 * family on a schedule. Cells keep any alignment they set for themselves, which is how the
 * prose columns of the Hypothèses sheet stay left-aligned.
 *
 * @param {Array<Array<object>>} dataRows
 * @param {(row: number, column: number) => string|null} ground
 */
function dress(dataRows, ground) {
  return dataRows.map((row, index) =>
    row.map((cell, column) => {
      if (cell == null) return cell;
      const backgroundColor = ground(index, column);

      return {
        align: "center",
        alignVertical: "center",
        ...(backgroundColor ? { backgroundColor } : {}),
        ...cell
      };
    })
  );
}

/** Every other row, which is what a sheet with no families to colour gets instead. */
const banded = (row) => (row % 2 ? BAND : null);

/**
 * Assembles a sheet: heading row measured, data rows dressed, columns fitted.
 *
 * `headerRows` may be one row or two — a schedule carries its three families on a row of
 * its own above the column headings, and both rows stay frozen at the top.
 */
function sheet(name, headerRows, dataRows, { ground = banded, ...extra } = {}) {
  const widths = fitColumns(headerRows, dataRows);
  const headings = headerRows[headerRows.length - 1];
  const height = headerHeight(headings, widths);

  return {
    sheet: name,
    data: [
      ...headerRows.slice(0, -1),
      headings.map((cell) => (cell == null ? cell : { ...cell, height })),
      ...dress(dataRows, ground)
    ],
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: headerRows.length,
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
      note(
        principal === solved.requestedPrincipal
          ? "saisi"
          : `saisi ${formatWhole(solved.requestedPrincipal)} €, déplacé pour que les ` +
            `${periods} mensualités tombent juste`
      )
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
      note(`euros ronds, identique sur les ${periods} échéances, aucune ajustée`)
    ],
    [
      label("Taux annuel nominal"),
      { value: annualNominalRate, type: Number, format: RATE_ANNUAL },
      note("taux mensuel × 12 ; valeur indicative, c'est l'échéancier qui fait foi")
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
      note("coût effectif − hypothèse, dû à la mensualité en euros ronds")
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
    // What produced the file, and which build of it. A workbook outlives the tab it was
    // exported from — it is mailed, filed, reopened by the other party — and a figure
    // questioned six months later is only checkable against a named tool and a version.
    [label("Généré par"), label(`${APP_NAME} — version ${VERSION}`), note(APP_TAGLINE)]
  ];

  const columns = scheduleColumns({ constantEuros });
  const groups = scheduleGroups({ constantEuros });

  // Two header rows: the three families above, their columns below, each on the ground of
  // its own family — the same three tones as the page, so the file and the screen read as
  // one document.
  const groupRow = groups.flatMap((group) =>
    groupHeader(group.label ? group.label.toUpperCase() : "", group.columns.length, GROUP_TONE[group.key].head)
  );
  const columnRow = columns.map((column) =>
    header(columnHeading(column), GROUP_TONE[column.group].head)
  );

  const scheduleRows = schedule.map((row) =>
    columns.map((column) =>
      column.type === "money"
        ? money(round2(row[column.key]))
        : column.type === "date"
          ? { value: row[column.key], type: Date, format: DATE }
          : { value: row[column.key], type: Number }
    )
  );

  const washes = columns.map((column) => GROUP_TONE[column.group].wash);

  // write-excel-file takes one object per sheet, each carrying its own column widths and
  // its own frozen panes.
  return [
    sheet(
      SHEET_ASSUMPTIONS,
      [[header("Hypothèse"), header("Valeur"), header("Note")]],
      assumptions
    ),
    sheet(SHEET_SCHEDULE, [groupRow, columnRow], scheduleRows, {
      ground: (_row, column) => washes[column],
      // Both header rows and the two identifying columns stay visible: on a 240-row
      // schedule, scrolling to instalment 180 otherwise loses both the column names and
      // the date of the row being read.
      stickyColumnsCount: 2
    })
  ];
}

/** A whole number of euros, French thousands separator, for a note. */
const formatWhole = (value) => Math.round(value).toLocaleString("fr-FR");

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
export async function exportXlsx(solved, filename = "pret-a-preter-echeancier.xlsx", options, writer) {
  const write = writer || globalThis.writeXlsxFile;
  if (typeof write !== "function") {
    throw new Error("write-excel-file is not loaded");
  }
  if (!solved || !solved.schedule.length) return;

  await write(buildWorkbook(solved, options)).toFile(filename);
}

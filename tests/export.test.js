/**
 * Export layer: the workbook payload handed to write-excel-file, and the CSV text.
 *
 * The XLSX case goes all the way to a real .xlsx blob, produced by the very bundle the
 * page ships, so that an API change in the vendored file breaks a test rather than the
 * download button.
 */

import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { solveLoan } from "../src/core/finance.js";
import { APP_NAME, VERSION } from "../src/core/version.js";
import { buildCsv } from "../src/export/csv.js";
import {
  SCHEDULE_HEADERS,
  buildWorkbook,
  exportXlsx,
  scheduleHeaders
} from "../src/export/xlsx.js";

const require = createRequire(import.meta.url);
require("../vendor/write-excel-file.min.js");
const writeXlsxFile = globalThis.writeXlsxFile;

const solved = solveLoan({
  principal: 200_000,
  periods: 240,
  totalCost: 52_000,
  startDate: new Date(2026, 8, 5)
});

describe("workbook payload", () => {
  const sheets = buildWorkbook(solved);

  it("has an assumptions sheet and a schedule sheet", () => {
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Hypothèses", "Échéancier"]);
  });

  it("gives the schedule two header rows plus one row per instalment", () => {
    expect(sheets[1].data).toHaveLength(242);
    expect(sheets[1].data[1].map((cell) => cell.value)).toEqual(SCHEDULE_HEADERS);
  });

  /**
   * The three families, spread over the columns they name. Merging is what makes them
   * read as one heading rather than as a word sitting above the first column of each.
   */
  it("heads the schedule with its three families, each spanning its own columns", () => {
    const groups = sheets[1].data[0];

    expect(groups.filter(Boolean).map((cell) => [cell.value, cell.span])).toEqual([
      ["", 2],
      ["LA MENSUALITÉ", 3],
      ["L'ÉTAT DU PRÊT", 3],
      ["L'EFFET DE L'INFLATION", 2]
    ]);
    // The cells a merge covers must still be there, or write-excel-file merges past the
    // end of the row.
    expect(groups).toHaveLength(SCHEDULE_HEADERS.length);
  });

  it("grounds each family in its own colour, headings and figures alike", () => {
    const grounds = (row) => sheets[1].data[row].map((cell) => cell && cell.backgroundColor);

    // Group band, column headings, first instalment: three rows, one palette.
    expect(grounds(0)).toEqual([
      "#17262B", null, "#4B3A7A", null, null, "#1F6F78", null, null, "#8A6A2F", null
    ]);
    expect(grounds(1)).toEqual([
      "#17262B", "#17262B", "#4B3A7A", "#4B3A7A", "#4B3A7A",
      "#1F6F78", "#1F6F78", "#1F6F78", "#8A6A2F", "#8A6A2F"
    ]);
    expect(grounds(2)).toEqual([
      "#FFFFFF", "#FFFFFF", "#F5F2FB", "#F5F2FB", "#F5F2FB",
      "#EEF5F5", "#EEF5F5", "#EEF5F5", "#F9F4EA", "#F9F4EA"
    ]);
  });

  it("writes numbers as numbers, not as pre-formatted strings", () => {
    const firstInstalment = sheets[1].data[2];
    expect(firstInstalment[2]).toMatchObject({ value: 1_050, type: Number });
    expect(firstInstalment[3].type).toBe(Number);
    expect(firstInstalment[1].type).toBe(Date);
  });

  it("carries the solved rate under the sole proportional convention", () => {
    const values = sheets[0].data.map((row) => row[0] && row[0].value);
    expect(values).toContain("Taux mensuel");
    expect(values).toContain("Taux annuel nominal");
    expect(values).toContain("Écart d'arrondi (€)");
    // The equivalent rate was dropped: on an amortising loan the borrower never
    // pays it, and the workbook should not imply otherwise.
    expect(values).not.toContain("Taux annuel équivalent");
  });

  it("states the rounding gap rather than hiding it", () => {
    const driftRow = sheets[0].data.find(
      (row) => row[0] && row[0].value === "Écart d'arrondi (€)"
    );
    expect(driftRow[1].value).toBe(-0.04);
  });

  it("sizes every column of both sheets", () => {
    expect(sheets[0].columns).toHaveLength(3);
    expect(sheets[1].columns).toHaveLength(SCHEDULE_HEADERS.length);
  });

  // Scrolling to instalment 180 on a 240-row sheet otherwise loses both the column names
  // and the date of the row being read.
  it("freezes both header rows and the two identifying columns of the schedule", () => {
    expect(sheets[1].stickyRowsCount).toBe(2);
    expect(sheets[1].stickyColumnsCount).toBe(2);
  });

  it("freezes the header row of the assumptions sheet too", () => {
    expect(sheets[0].stickyRowsCount).toBe(1);
  });

  it("states the inflation assumption and the real rate", () => {
    const values = sheets[0].data.map((row) => row[0] && row[0].value);
    expect(values).toContain("Taux d'inflation annuel");
    expect(values).toContain("Taux annuel réel");
    expect(values).toContain("Coût des intérêts (€ constants)");
  });
});

/**
 * The workbook was unreadable in a spreadsheet for reasons that have nothing to do with
 * the figures: a wrapped header with no row height is clipped to its first line, and
 * hand-picked column widths left a column of blank beside every number.
 */
describe("workbook layout", () => {
  const [assumptions, schedule] = buildWorkbook(solved);
  const headerRow = schedule.data[1];
  const dataRows = schedule.data.slice(2);

  it("gives the heading row the height its wrapped labels need", () => {
    // One line of the default font is 15 pt; anything at or below that is a clipped wrap.
    expect(headerRow[0].height).toBeGreaterThan(15);
    for (const cell of headerRow) {
      expect(cell.wrap).toBe(true);
      expect(cell.height).toBe(headerRow[0].height);
    }
    expect(assumptions.data[0][0].height).toBeGreaterThan(0);
  });

  it("centres every value on both axes", () => {
    for (const row of dataRows) {
      for (const cell of row) {
        expect(cell.align).toBe("center");
        expect(cell.alignVertical).toBe("center");
      }
    }
    expect(headerRow.every((cell) => cell.align === "center")).toBe(true);
  });

  it("leaves the prose columns of the assumptions sheet ranged left", () => {
    const [term, value, comment] = assumptions.data[1];
    expect(term.align).toBe("left");
    expect(comment.align).toBe("left");
    expect(value.align).toBe("center");
  });

  /**
   * Banding and family grounds answer the same need — keeping the eye on its line — so
   * they do not share a sheet. The assumptions have no families and keep the bands; the
   * schedule has three, and a band over a wash would only muddy both.
   */
  it("bands the assumptions sheet, and grounds the schedule by family instead", () => {
    const bands = assumptions.data.slice(1).map((row) => row[0].backgroundColor);
    expect(bands.slice(0, 4)).toEqual([undefined, "#F1F5F4", undefined, "#F1F5F4"]);

    const washes = dataRows.slice(0, 4).map((row) => row[2].backgroundColor);
    expect(washes).toEqual(["#F5F2FB", "#F5F2FB", "#F5F2FB", "#F5F2FB"]);
  });

  /**
   * The widths this replaces were 6/13/15/13/18/20/18/20/26/26 against figures no wider
   * than eleven characters. The rule now is: fit the content, and never leave more than
   * the two characters of padding a centred value needs.
   */
  it("fits each column to its own content", () => {
    const widths = schedule.columns.map((column) => column.width);

    // "199 353,44" is ten characters; the column that holds it wants twelve, not twenty.
    expect(widths[5]).toBeLessThanOrEqual(13);
    // The instalment number never exceeds three digits on a schedule this long.
    expect(widths[0]).toBeLessThanOrEqual(6);
    // Nothing may be narrower than the longest unbreakable word of its own header.
    SCHEDULE_HEADERS.forEach((label, column) => {
      const longest = Math.max(...label.split(/\s+/).map((word) => word.length));
      expect(widths[column]).toBeGreaterThanOrEqual(longest);
    });
  });

  it("still writes a real xlsx once dressed", async () => {
    const blob = await writeXlsxFile(buildWorkbook(solved)).toBlob();
    expect(blob.size).toBeGreaterThan(1_000);
  });
});

/**
 * The header was written in the default black on a near-black fill — bold, centred,
 * correctly wrapped and completely invisible. The payload said `color: "#FFFFFF"`; the
 * property write-excel-file reads is `textColor`, and an unknown one is dropped without a
 * word. Nothing in the payload could have shown that, so this test reads the styles the
 * spreadsheet will actually apply, out of the file itself.
 */
describe("what the spreadsheet actually receives", () => {
  /** One entry of the .xlsx, which is a zip of XML: local header, then a raw deflate. */
  async function entry(blob, wanted) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    let offset = 0;

    while (offset < bytes.length - 4 && bytes.readUInt32LE(offset) === 0x04034b50) {
      const method = bytes.readUInt16LE(offset + 8);
      const size = bytes.readUInt32LE(offset + 18);
      const nameLength = bytes.readUInt16LE(offset + 26);
      const extraLength = bytes.readUInt16LE(offset + 28);
      const name = bytes.toString("utf8", offset + 30, offset + 30 + nameLength);
      const start = offset + 30 + nameLength + extraLength;

      if (name === wanted) {
        const data = bytes.subarray(start, start + size);
        return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
      }
      offset = start + size;
    }
    return null;
  }

  it("writes the header in white on the dark fill, not in the default ink", async () => {
    const blob = await writeXlsxFile(buildWorkbook(solved)).toBlob();
    const styles = await entry(blob, "xl/styles.xml");

    // ARGB, alpha first. Without the fix the only font colours were `theme="1"` — black.
    expect(styles).toContain('<color rgb="FFFFFFFF"/>');
    expect(styles).toContain('<fgColor rgb="FF17262B"/>');

    // The bold font of the header row is the one carrying that white.
    const fonts = styles.slice(styles.indexOf("<fonts"), styles.indexOf("</fonts>"));
    expect(fonts).toMatch(/<b\/>[^]*?<color rgb="FFFFFFFF"\/>/);
  });

  it("carries the grey of the notes column as a real font colour", async () => {
    const blob = await writeXlsxFile(buildWorkbook(solved)).toBlob();
    const styles = await entry(blob, "xl/styles.xml");

    expect(styles).toContain('<color rgb="FF5F757C"/>');
  });
});

/**
 * The inflation reading is a switch on screen, so it is a switch in the exports too:
 * shipping two columns of purchasing power to someone who turned that view off would
 * answer a question they declined to ask.
 */
describe("inflation view off", () => {
  const [assumptions, schedule] = buildWorkbook(solved, { constantEuros: false });

  it("drops the two constant-euro columns", () => {
    expect(scheduleHeaders({ constantEuros: false })).toHaveLength(8);
    expect(scheduleHeaders()).toEqual(SCHEDULE_HEADERS);
    expect(schedule.data[0]).toHaveLength(8);
    expect(schedule.data[1]).toHaveLength(8);
    expect(schedule.columns).toHaveLength(8);
  });

  it("drops the inflation family with them", () => {
    expect(schedule.data[0].filter(Boolean).map((cell) => cell.value)).toEqual([
      "",
      "LA MENSUALITÉ",
      "L'ÉTAT DU PRÊT"
    ]);
  });

  it("drops the inflation lines of the assumptions sheet", () => {
    const values = assumptions.data.map((row) => row[0] && row[0].value);
    expect(values).not.toContain("Taux d'inflation annuel");
    expect(values).not.toContain("Taux annuel réel");
    expect(values).toContain("Taux annuel nominal");
  });

  it("drops them from the CSV too", () => {
    const lines = buildCsv(solved, { constantEuros: false }).split("\r\n");
    expect(lines[0].split(";")).toHaveLength(8);
    expect(lines[1].split(";")).toHaveLength(8);
    expect(lines[2].split(";")).toHaveLength(8);
    // Two headings, 240 instalments, a blank line and the provenance line.
    expect(lines).toHaveLength(244);
  });
});

describe("workbook writing", () => {
  it("produces a real xlsx blob through the vendored bundle", async () => {
    const blob = await writeXlsxFile(buildWorkbook(solved)).toBlob();
    expect(blob.size).toBeGreaterThan(1_000);

    // A .xlsx is a zip: check the local file header magic rather than trusting the size.
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect(Array.from(header)).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("refuses to write when the bundle is missing", async () => {
    const saved = globalThis.writeXlsxFile;
    delete globalThis.writeXlsxFile;
    try {
      await expect(exportXlsx(solved, "x.xlsx")).rejects.toThrow(
        /write-excel-file is not loaded/
      );
    } finally {
      globalThis.writeXlsxFile = saved;
    }
  });
});

describe("csv", () => {
  const csv = buildCsv(solved);
  const lines = csv.split("\r\n");

  it("opens with a UTF-8 BOM", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("has two header rows, one row per instalment, and a line of provenance", () => {
    expect(lines).toHaveLength(244);
    expect(lines[1].split(";")).toEqual(SCHEDULE_HEADERS);
    expect(lines[242]).toBe("");
    expect(lines[243]).toContain(APP_NAME);
    expect(lines[243]).toContain(VERSION);
  });

  /** The families, laid out over the columns they name — as in the workbook, minus colour. */
  it("carries the three families on a row of their own", () => {
    expect(lines[0]).toBe("﻿;;La mensualité;;;L'état du prêt;;;L'effet de l'inflation;");
  });

  it("separates with semicolons and uses comma decimals", () => {
    const first = lines[2].split(";");
    expect(first).toHaveLength(SCHEDULE_HEADERS.length);
    expect(first[0]).toBe("1");
    expect(first[1]).toBe("2026-09-05");
    expect(first[2]).toBe("1050");
    expect(first[3]).toBe("399,85");
  });

  // The provenance line carries a version number, which is the one place a dot is meant.
  it("never emits a dot as a decimal separator", () => {
    expect(lines.slice(0, 242).join("\r\n")).not.toMatch(/\d\.\d/);
  });
});

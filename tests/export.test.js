/**
 * Export layer: the workbook payload handed to write-excel-file, and the CSV text.
 *
 * The XLSX case goes all the way to a real .xlsx blob, produced by the very bundle the
 * page ships, so that an API change in the vendored file breaks a test rather than the
 * download button.
 */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { solveLoan } from "../src/core/finance.js";
import { buildCsv } from "../src/export/csv.js";
import { SCHEDULE_HEADERS, buildWorkbook, exportXlsx } from "../src/export/xlsx.js";

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

  it("gives the schedule one header row plus one row per instalment", () => {
    expect(sheets[1].data).toHaveLength(241);
    expect(sheets[1].data[0].map((cell) => cell.value)).toEqual(SCHEDULE_HEADERS);
  });

  it("writes numbers as numbers, not as pre-formatted strings", () => {
    const firstInstalment = sheets[1].data[1];
    expect(firstInstalment[2]).toMatchObject({ value: 1_050, type: Number });
    expect(firstInstalment[3].type).toBe(Number);
    expect(firstInstalment[1].type).toBe(Date);
  });

  it("carries the solved rate and both annual conventions", () => {
    const values = sheets[0].data.map((row) => row[0] && row[0].value);
    expect(values).toContain("Taux mensuel");
    expect(values).toContain("Taux annuel nominal");
    expect(values).toContain("Taux annuel équivalent");
    expect(values).toContain("Écart d'arrondi (€)");
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

  it("has a header row plus one row per instalment", () => {
    expect(lines).toHaveLength(241);
  });

  it("separates with semicolons and uses comma decimals", () => {
    const first = lines[1].split(";");
    expect(first).toHaveLength(8);
    expect(first[0]).toBe("1");
    expect(first[1]).toBe("2026-09-05");
    expect(first[2]).toBe("1050");
    expect(first[3]).toBe("399,85");
  });

  it("never emits a dot as a decimal separator", () => {
    expect(csv).not.toMatch(/\d\.\d/);
  });
});

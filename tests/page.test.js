/**
 * What the page claims, against what the code does.
 *
 * index.html carries prose the tests would otherwise never see: conventions, a tax rate,
 * a version. Prose drifts — it is the part of a repository nothing recompiles — so the
 * few sentences that state a figure the code also holds are checked against that figure
 * rather than trusted.
 *
 * The page is read as text on purpose. There is no DOM here and none is wanted: the point
 * is the source that ships, byte for byte, since it is served exactly as it lies.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FLAT_TAX_INCOME_RATE,
  FLAT_TAX_RATE,
  FLAT_TAX_SOCIAL_RATE
} from "../src/core/finance.js";
import { formatPercent } from "../src/core/format.js";
import { VERSION } from "../src/core/version.js";

const url = (path) => new URL(path, import.meta.url);
const page = readFileSync(url("../index.html"), "utf8");
const manifest = JSON.parse(readFileSync(url("../package.json"), "utf8"));

/** fr-FR puts a narrow no-break space before « % » — invisible in a test file. */
const flatten = (text) => text.replace(/[\s   ]+/g, " ");
const flat = flatten(page);

describe("the version", () => {
  it("is the same in the module and in the manifest", () => {
    expect(manifest.version).toBe(VERSION);
  });

  it("looks like a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has somewhere to be written in the page footer", () => {
    expect(page).toContain('id="app-version"');
  });
});

describe("the tax paragraph", () => {
  it("quotes the rates the code applies", () => {
    expect(flat).toContain(flatten(formatPercent(FLAT_TAX_RATE, 0)));
    expect(flat).toContain(flatten(formatPercent(FLAT_TAX_INCOME_RATE, 1)));
    expect(flat).toContain(flatten(formatPercent(FLAT_TAX_SOCIAL_RATE, 1)));
  });

  it("says where it got them", () => {
    expect(page).toContain("service-public.fr");
    // An order of magnitude presented as one, since the real bill depends on the lender.
    expect(flat).toMatch(/indicatif|ordre de grandeur/);
  });
});

describe("what the page no longer says", () => {
  /**
   * « hors assurance et frais annexes » was printed on the screen, in the workbook and on
   * the deed. It answered a question nobody had asked, and reads as a disclaimer against
   * the tool's own figures — « elle inspire méfiance ». The scope is stated by what the
   * tool computes, not by a list of what it does not.
   */
  const sources = ["../index.html", "../src/export/xlsx.js", "../src/export/pdf/deed.js"];

  it.each(sources)("%s carries no insurance-and-fees disclaimer", (path) => {
    const text = readFileSync(url(path), "utf8");
    expect(text).not.toMatch(/hors assurance/i);
    expect(text).not.toMatch(/frais annexes/i);
    expect(text).not.toMatch(/TAEG/);
  });
});

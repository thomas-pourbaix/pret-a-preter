/**
 * French formatting, and the one place where formatting is a decision rather than a
 * presentation: the step a rate is read on.
 */

import { describe, expect, it } from "vitest";

import {
  RATE_STEP,
  formatNumber,
  formatPercent,
  formatSteppedPercent,
  parseFrenchNumber,
  roundToRateStep
} from "../src/core/format.js";

/** fr-FR separates with narrow no-break spaces, invisible in a test file. */
const flatten = (text) => text.replace(/[\s   ]+/g, " ");

describe("rates are read on the grid they are negotiated on", () => {
  it("steps by five hundredths of a point", () => {
    expect(RATE_STEP).toBe(0.0005);
  });

  it.each([
    [0.029116, "2,90 %"],
    [0.0299, "3,00 %"],
    [0.030249, "3,00 %"],
    [0.03026, "3,05 %"],
    [0.001583, "0,15 %"],
    [0, "0,00 %"],
    [-0.0004, "-0,05 %"]
  ])("%s reads as %s", (value, expected) => {
    expect(flatten(formatSteppedPercent(value))).toBe(flatten(expected));
  });

  it("rounds to the nearest step, up or down, without binary drift", () => {
    expect(roundToRateStep(0.029116)).toBe(0.029);
    expect(roundToRateStep(0.0335)).toBe(0.0335);
    // 0,0285 + 0,0005 must not come out as 0,028999999999999998.
    expect(roundToRateStep(0.0287)).toBe(0.0285);
  });

  /**
   * The exact rate is never lost, only moved: it is what the schedule was computed from,
   * so the balance sheet restates it under the rounded one.
   */
  it("leaves the full precision available beside it", () => {
    expect(flatten(formatPercent(0.029116, 4))).toBe(flatten("2,9116 %"));
  });
});

describe("numbers and parsing", () => {
  it("prints with the requested number of decimals", () => {
    expect(flatten(formatNumber(1234.5, 2))).toBe(flatten("1 234,50"));
    expect(formatNumber(3, 0)).toBe("3");
  });

  it("reads back what a French keyboard produces", () => {
    expect(parseFrenchNumber("10 000")).toBe(10000);
    expect(parseFrenchNumber("1 234,56")).toBe(1234.56);
    expect(parseFrenchNumber("")).toBeNaN();
  });
});

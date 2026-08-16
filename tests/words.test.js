/**
 * Amounts in French words — the mention the borrower has to copy out by hand.
 *
 * Worth testing to the letter: article 1376 makes the written words prevail over the
 * figures, so a wrong "quatre-vingts" is not a typo, it is the operative sum.
 */

import { describe, expect, it } from "vitest";

import { spellEuros, spellInteger } from "../src/core/words.js";

describe("whole numbers", () => {
  it("spells the units and the teens", () => {
    expect(spellInteger(0)).toBe("zéro");
    expect(spellInteger(1)).toBe("un");
    expect(spellInteger(11)).toBe("onze");
    expect(spellInteger(16)).toBe("seize");
    expect(spellInteger(17)).toBe("dix-sept");
  });

  it("puts « et » where French puts it, and a hyphen everywhere else", () => {
    expect(spellInteger(21)).toBe("vingt et un");
    expect(spellInteger(22)).toBe("vingt-deux");
    expect(spellInteger(31)).toBe("trente et un");
    expect(spellInteger(71)).toBe("soixante et onze");
    expect(spellInteger(81)).toBe("quatre-vingt-un");
  });

  it("counts the seventies and the nineties from sixty and eighty", () => {
    expect(spellInteger(70)).toBe("soixante-dix");
    expect(spellInteger(77)).toBe("soixante-dix-sept");
    expect(spellInteger(90)).toBe("quatre-vingt-dix");
    expect(spellInteger(96)).toBe("quatre-vingt-seize");
    expect(spellInteger(99)).toBe("quatre-vingt-dix-neuf");
  });

  it("pluralises vingt and cent only when nothing follows them", () => {
    expect(spellInteger(80)).toBe("quatre-vingts");
    expect(spellInteger(200)).toBe("deux cents");
    expect(spellInteger(201)).toBe("deux cent un");
    expect(spellInteger(100)).toBe("cent");
    expect(spellInteger(101)).toBe("cent un");
  });

  /** "mille" is a numeral adjective: it cancels the plural of what multiplies it. */
  it("writes quatre-vingt mille and deux cent mille without their s", () => {
    expect(spellInteger(80_000)).toBe("quatre-vingt mille");
    expect(spellInteger(200_000)).toBe("deux cent mille");
    expect(spellInteger(80_000_000)).toBe("quatre-vingts millions");
  });

  it("never says « un mille », and never pluralises mille", () => {
    expect(spellInteger(1_000)).toBe("mille");
    expect(spellInteger(2_000)).toBe("deux mille");
    expect(spellInteger(10_000)).toBe("dix mille");
  });

  it("chains the scales", () => {
    expect(spellInteger(1_587)).toBe("mille cinq cent quatre-vingt-sept");
    expect(spellInteger(12_345)).toBe("douze mille trois cent quarante-cinq");
    expect(spellInteger(1_000_000)).toBe("un million");
    expect(spellInteger(2_000_001)).toBe("deux millions un");
    expect(spellInteger(1_234_567)).toBe(
      "un million deux cent trente-quatre mille cinq cent soixante-sept"
    );
  });

  it("refuses what it cannot spell rather than inventing", () => {
    expect(() => spellInteger(-1)).toThrow(RangeError);
    expect(() => spellInteger(1e12)).toThrow(RangeError);
  });
});

describe("amounts", () => {
  it("agrees the currency with the amount", () => {
    expect(spellEuros(0)).toBe("zéro euro");
    expect(spellEuros(1)).toBe("un euro");
    expect(spellEuros(96)).toBe("quatre-vingt-seize euros");
    expect(spellEuros(10_000)).toBe("dix mille euros");
  });

  it("spells the cents only when there are some", () => {
    expect(spellEuros(1_587.29)).toBe(
      "mille cinq cent quatre-vingt-sept euros et vingt-neuf centimes"
    );
    expect(spellEuros(12.01)).toBe("douze euros et un centime");
    expect(spellEuros(12.1)).toBe("douze euros et dix centimes");
    expect(spellEuros(12)).toBe("douze euros");
  });

  it("rounds to the cent rather than trailing binary drift", () => {
    expect(spellEuros(0.1 + 0.2)).toBe("zéro euro et trente centimes");
  });
});

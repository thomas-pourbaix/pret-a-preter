/**
 * Invariants of docs/SPEC-echeancier-pret.md §6.
 *
 * The solved rate is additionally cross-checked against two independent third-party
 * implementations of the spreadsheet RATE function (Formula.js and tvm-financejs).
 * They are dev dependencies only: nothing here ships to the browser. The point is that
 * our own solver is validated by code we did not write.
 */

import { describe, expect, it } from "vitest";
import { RATE } from "@formulajs/formulajs";
import Finance from "tvm-financejs";

import {
  addMonths,
  annualEquivalentRate,
  annualNominalRate,
  balanceAfterConstantInstalments,
  buildSchedule,
  periodicPayment,
  rateForExactInstalment,
  round2,
  solveLoan,
  solveRate,
  toIsoDate
} from "../src/core/finance.js";

const tvm = new Finance();
const START = new Date(2026, 8, 5); // 5 September 2026, local time

/** Convenience wrapper: solve from a known cost, the primary use case. */
const fromCost = (principal, periods, totalCost) =>
  solveLoan({ principal, periods, totalCost, startDate: START });

/** Convenience wrapper: solve from a known nominal annual rate. */
const fromAnnualRate = (principal, periods, annualRate) =>
  solveLoan({ principal, periods, periodicRate: annualRate / 12, startDate: START });

const sum = (rows, key) => round2(rows.reduce((total, row) => total + row[key], 0));

/* ------------------------------------------------------------------ invariants */

describe("INV-001 — the principal is repaid in full", () => {
  const cases = [
    [200_000, 240, 52_000],
    [5_000, 120, 800],
    [1_000, 1, 30],
    [350_000, 300, 0],
    [12_345.67, 37, 987.65]
  ];

  it.each(cases)("P=%s n=%s C=%s leaves a zero balance", (principal, periods, cost) => {
    const { schedule } = fromCost(principal, periods, cost);
    expect(schedule[schedule.length - 1].balance).toBe(0);
  });
});

describe("INV-002 — conservation", () => {
  it.each([
    [200_000, 240, 52_000],
    [5_000, 120, 800],
    [80_000, 84, 9_999.99]
  ])("P=%s n=%s C=%s conserves capital and instalments", (principal, periods, cost) => {
    const { schedule } = fromCost(principal, periods, cost);

    expect(sum(schedule, "capital")).toBeCloseTo(principal, 2);
    expect(sum(schedule, "instalment")).toBeCloseTo(
      principal + sum(schedule, "interest"),
      2
    );
  });
});

describe("INV-003 — the schedule has exactly n rows", () => {
  it.each([[1], [2], [12], [240], [1200]])("n=%s", (periods) => {
    expect(fromCost(200_000, periods, 52_000).schedule).toHaveLength(periods);
  });

  it("still has n rows when the cost is zero and the instalment rounds up", () => {
    // 200000 / 240 = 833.3333… rounds to 833.33, so the balance runs slightly behind
    // and the loan must not settle before the last period.
    expect(fromCost(200_000, 240, 0).schedule).toHaveLength(240);
  });
});

describe("INV-004 — faithfulness to the cost assumption", () => {
  // The five-cent bound stated in the specification holds on reference case A, which is
  // what it was written from, and we keep asserting it there.
  it("holds within five cents on reference case A", () => {
    const { effectiveCost } = fromCost(200_000, 240, 52_000);
    expect(Math.abs(effectiveCost - 52_000)).toBeLessThanOrEqual(0.05);
  });

  // But five cents is an observation, not a theorem. Rounding the interest to the cent
  // on every period can drift by up to half a cent per period, and the final instalment
  // absorbs the *capital* drift, not the interest drift. P=12 345,67 n=37 C=987,65
  // lands at six cents. This is the bound the conventions of §4.3 actually guarantee.
  const guaranteedBound = (periods) => 0.005 * periods + 0.01;

  it.each([
    [200_000, 240, 52_000],
    [12_345.67, 37, 987.65],
    [5_000, 120, 800],
    [80_000, 84, 9_999.99],
    [350_000, 300, 120_000],
    [1_000, 1, 30]
  ])("P=%s n=%s C=%s stays within the guaranteed bound", (principal, periods, cost) => {
    const { effectiveCost } = fromCost(principal, periods, cost);
    expect(Math.abs(effectiveCost - cost)).toBeLessThanOrEqual(guaranteedBound(periods));
  });
});

describe("INV-005 — round trip between the two modes", () => {
  it.each([
    [200_000, 240, 52_000],
    [5_000, 120, 800],
    [80_000, 84, 9_999.99]
  ])("P=%s n=%s C=%s reproduces the same schedule", (principal, periods, cost) => {
    const solved = fromCost(principal, periods, cost);
    const replayed = solveLoan({
      principal,
      periods,
      periodicRate: solved.rate,
      startDate: START
    });

    expect(replayed.payment).toBeCloseTo(solved.payment, 2);
    expect(replayed.schedule).toHaveLength(solved.schedule.length);
    replayed.schedule.forEach((row, index) => {
      expect(row.instalment).toBeCloseTo(solved.schedule[index].instalment, 2);
      expect(row.interest).toBeCloseTo(solved.schedule[index].interest, 2);
      expect(row.balance).toBeCloseTo(solved.schedule[index].balance, 2);
    });
  });
});

describe("INV-006 — monotonicity", () => {
  it("interest decreases and capital increases, last instalment excepted", () => {
    const { schedule } = fromCost(200_000, 240, 52_000);
    const body = schedule.slice(0, -1);

    for (let k = 1; k < body.length; k++) {
      expect(body[k].interest).toBeLessThan(body[k - 1].interest);
      expect(body[k].capital).toBeGreaterThan(body[k - 1].capital);
    }
  });
});

describe("INV-007 — degenerate case n = 1", () => {
  it("recovers the analytic solution i = C / P", () => {
    const { rate } = solveRate(1_000, 30, 1);
    expect(rate).toBeCloseTo(30 / 1_000, 9);
  });

  it.each([
    [200_000, 4_000],
    [750, 12.5],
    [1, 1]
  ])("P=%s C=%s", (principal, cost) => {
    expect(solveRate(principal, cost, 1).rate).toBeCloseTo(cost / principal, 9);
  });
});

/* ------------------------------------------------------------- reference cases */

describe("reference case A — cost known", () => {
  const solved = fromCost(200_000, 240, 52_000);

  it("solves the periodic rate", () => {
    expect(solved.rate).toBeCloseTo(0.001_999_230_3, 9);
  });

  it("reports both annual conventions", () => {
    expect(solved.annualNominalRate * 100).toBeCloseTo(2.399, 3);
    expect(solved.annualEquivalentRate * 100).toBeCloseTo(2.426, 3);
  });

  it("produces a 1 050,00 € instalment and an adjusted final one", () => {
    expect(solved.payment).toBe(1_050);
    const last = solved.schedule[solved.schedule.length - 1];
    expect(last.instalment).toBe(1_049.96);
    expect(last.adjusted).toBe(true);
  });

  it("accumulates 51 999,96 € of interest", () => {
    expect(solved.effectiveCost).toBe(51_999.96);
  });

  it("converges and reports its residual", () => {
    expect(solved.converged).toBe(true);
    expect(Math.abs(solved.residual)).toBeLessThan(1e-9);
  });
});

describe("reference case B — rate known", () => {
  const solved = fromAnnualRate(200_000, 240, 0.0245);

  it("produces a 1 054,94 € instalment", () => {
    expect(solved.payment).toBe(1_054.94);
  });

  it("costs 53 185,77 €", () => {
    expect(solved.effectiveCost).toBe(53_185.77);
  });

  it("settles the loan exactly", () => {
    expect(solved.schedule[solved.schedule.length - 1].balance).toBe(0);
  });
});

describe("reference case C — zero cost", () => {
  const solved = fromCost(200_000, 240, 0);

  it("solves to a zero rate", () => {
    expect(solved.rate).toBe(0);
  });

  it("splits the principal evenly, the last instalment absorbing the rounding", () => {
    expect(solved.payment).toBe(833.33);
    expect(solved.schedule[solved.schedule.length - 1].instalment).toBe(834.13);
  });

  it("charges no interest at all", () => {
    expect(solved.effectiveCost).toBe(0);
  });
});

/* ------------------------------------------- cross-check against third parties */

describe("the solved rate agrees with independent RATE implementations", () => {
  it.each([
    [200_000, 240, 52_000],
    [5_000, 120, 800],
    [80_000, 84, 9_999.99],
    [350_000, 300, 120_000]
  ])("P=%s n=%s C=%s", (principal, periods, cost) => {
    const ours = solveRate(principal, cost, periods).rate;
    const target = (principal + cost) / periods;

    expect(ours).toBeCloseTo(RATE(periods, -target, principal), 10);
    expect(ours).toBeCloseTo(tvm.RATE(periods, -target, principal), 10);
  });
});

describe("the instalment agrees with independent PMT implementations", () => {
  it.each([
    [0.001_999_230_331_669_3, 240, 200_000],
    [0.004, 120, 5_000],
    [0, 240, 200_000]
  ])("i=%s n=%s P=%s", (rate, periods, principal) => {
    const ours = periodicPayment(principal, rate, periods);
    expect(ours).toBeCloseTo(-tvm.PMT(rate, periods, principal), 8);
  });
});

/* -------------------------------------------------------------- boundary cases */

describe("boundary cases", () => {
  it("handles a single instalment", () => {
    const { schedule, payment } = fromCost(1_000, 1, 30);
    expect(schedule).toHaveLength(1);
    expect(payment).toBe(1_030);
    expect(schedule[0].interest).toBe(30);
    expect(schedule[0].balance).toBe(0);
  });

  it("handles the maximum term of 1200 instalments", () => {
    const { schedule, converged } = fromCost(200_000, 1_200, 300_000);
    expect(schedule).toHaveLength(1_200);
    expect(converged).toBe(true);
    expect(schedule[1_199].balance).toBe(0);
  });

  it("brackets a cost far larger than the principal", () => {
    const solved = solveRate(1_000, 100_000, 24);
    expect(solved.converged).toBe(true);
    expect(solved.rate).toBeGreaterThan(0.1);
    expect(Math.abs(solved.residual)).toBeLessThan(1e-6);
  });

  it("treats a negative cost as a zero rate rather than diverging", () => {
    expect(solveRate(1_000, -50, 12).rate).toBe(0);
  });
});

/* --------------------------------------------------- round-euro instalment mode */

describe("INV-008 — a round instalment never varies", () => {
  const loans = [
    [200_000, 240, 52_000],
    [200_000, 300, 70_000],
    [80_000, 180, 20_000],
    [30_000, 84, 4_200],
    [15_000, 36, 900],
    [10_000, 60, 1_500],
    [5_000, 120, 800],
    [1_000, 12, 60]
  ];

  const solveRound = (principal, periods, totalCost) =>
    solveLoan({ principal, periods, totalCost, startDate: START, roundPayment: true });

  it.each(loans)("P=%s n=%s C=%s finds a round instalment", (principal, periods, cost) => {
    expect(solveRound(principal, periods, cost).roundPayment.applied).toBe(true);
  });

  it.each(loans)("P=%s n=%s C=%s pays a whole number of euros", (principal, periods, cost) => {
    expect(Number.isInteger(solveRound(principal, periods, cost).payment)).toBe(true);
  });

  it.each(loans)("P=%s n=%s C=%s repeats the same amount n times", (principal, periods, cost) => {
    const { schedule, payment } = solveRound(principal, periods, cost);
    expect(schedule).toHaveLength(periods);
    expect(new Set(schedule.map((row) => row.instalment))).toEqual(new Set([payment]));
    expect(schedule.some((row) => row.adjusted)).toBe(false);
  });

  it.each(loans)("P=%s n=%s C=%s still settles exactly", (principal, periods, cost) => {
    const { schedule } = solveRound(principal, periods, cost);
    expect(schedule[schedule.length - 1].balance).toBe(0);
  });

  it.each(loans)("P=%s n=%s C=%s conserves capital", (principal, periods, cost) => {
    const { schedule, principal: p } = solveRound(principal, periods, cost);
    expect(sum(schedule, "capital")).toBeCloseTo(p, 2);
  });

  it.each(loans)("P=%s n=%s C=%s costs exactly n × M − P", (principal, periods, cost) => {
    const solved = solveRound(principal, periods, cost);
    expect(solved.effectiveCost).toBeCloseTo(solved.payment * periods - principal, 2);
  });

  it("stays close to the instalment the borrower asked for", () => {
    for (const [principal, periods, cost] of loans) {
      expect(solveRound(principal, periods, cost).roundPayment.offset).toBeLessThanOrEqual(3);
    }
  });
});

describe("the round-instalment rate is the one that settles the loan", () => {
  it("lands the balance on exactly zero, and its neighbours do not", () => {
    const rate = rateForExactInstalment(200_000, 240, 1_051);
    expect(rate).not.toBeNull();
    expect(balanceAfterConstantInstalments(200_000, 240, 1_051, rate)).toBe(0);
  });

  it("reports no rate when the instalment cannot repay the principal", () => {
    expect(rateForExactInstalment(200_000, 240, 100)).toBeNull();
  });

  it("returns a zero rate when the instalments add up to the principal exactly", () => {
    expect(rateForExactInstalment(120_000, 240, 500)).toBe(0);
  });

  // Regression: the closing balance used to keep charging interest after the debt was
  // gone. Interest on a credit is negative, so the balance fell as the rate rose and the
  // bisection was searching a function that ran the wrong way.
  it.each([
    [1_000, 24, 2_208],
    [200_000, 240, 1_051],
    [5_000, 120, 48],
    [10_000, 60, 192]
  ])("closing balance increases with the rate (P=%s n=%s M=%s)", (principal, periods, payment) => {
    let previous = -Infinity;
    for (let annual = 0.001; annual <= 5; annual *= 1.6) {
      const balance = balanceAfterConstantInstalments(principal, periods, payment, annual / 12);
      expect(balance).toBeGreaterThanOrEqual(previous);
      previous = balance;
    }
  });

  it("never reports zero when the instalment clears the debt before the term", () => {
    // 2 208 € a month wipes a 1 000 € loan on the first instalment, so no rate can make
    // it last 24 periods; the balance must stay strictly negative at every rate.
    for (let annual = 0.01; annual <= 5; annual *= 1.5) {
      expect(balanceAfterConstantInstalments(1_000, 24, 2_208, annual / 12)).toBeLessThan(0);
    }
    expect(rateForExactInstalment(1_000, 24, 2_208)).toBeNull();
  });

  it("gives up cleanly when no round instalment fits, instead of inventing one", () => {
    const solved = solveLoan({
      principal: 1_000,
      periods: 24,
      totalCost: 52_000,
      startDate: START,
      roundPayment: true
    });

    expect(solved.roundPayment.requested).toBe(true);
    expect(solved.roundPayment.applied).toBe(false);
    // Falling back means the banking convention, which must still be correct.
    expect(solved.schedule).toHaveLength(24);
    expect(solved.schedule[23].balance).toBe(0);
  });

  it("leaves the schedule untouched when the mode is off", () => {
    const plain = solveLoan({
      principal: 200_000,
      periods: 240,
      totalCost: 52_000,
      startDate: START
    });
    expect(plain.roundPayment.applied).toBe(false);
    expect(plain.payment).toBe(1_050);
    expect(plain.schedule[239].instalment).toBe(1_049.96);
  });
});

/* ------------------------------------------------------------------- utilities */

describe("rounding and dates", () => {
  it("rounds half away from zero at the cent", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1_050)).toBe(1_050);
  });

  it("clamps the day when the target month is shorter", () => {
    expect(toIsoDate(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(toIsoDate(addMonths(new Date(2024, 0, 31), 1))).toBe("2024-02-29");
  });

  it("builds ISO dates from local components, not UTC", () => {
    // A date late in the evening shifts to the next day under toISOString() in any
    // time zone east of UTC; toIsoDate must not.
    expect(toIsoDate(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });

  it("keeps the two annual conventions distinct", () => {
    const rate = 0.002;
    expect(annualNominalRate(rate)).toBeCloseTo(0.024, 10);
    expect(annualEquivalentRate(rate)).toBeGreaterThan(annualNominalRate(rate));
  });
});

describe("buildSchedule", () => {
  it("labels each instalment with consecutive months from the start date", () => {
    const rows = buildSchedule({
      principal: 1_200,
      rate: 0,
      periods: 3,
      payment: 400,
      startDate: new Date(2026, 10, 15)
    });

    expect(rows.map((row) => toIsoDate(row.date))).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15"
    ]);
  });
});

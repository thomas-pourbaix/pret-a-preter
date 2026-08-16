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
  deflator,
  PRINCIPAL_STEP,
  afterFlatTax,
  FLAT_TAX_RATE,
  nearestInterestFreePrincipal,
  periodicPayment,
  rateForExactInstalment,
  solveInterestFreeRoundPayment,
  realRate,
  round2,
  solveLoan,
  solveRate,
  solveWithinTolerances,
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
    // Against the amount actually lent, which is the only degree of freedom the search
    // has left once the instalment is a whole number of euros repeated n times.
    expect(solved.effectiveCost).toBeCloseTo(solved.payment * periods - solved.principal, 2);
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

  it("moves the amount rather than adjust a final instalment, however absurd the ask", () => {
    // 52 000 € of interest on a 1 000 € loan over two years: nothing sensible fits, and
    // the tool still has to hand back a schedule of 24 identical instalments (INV-015).
    const solved = solveLoan({
      principal: 1_000,
      periods: 24,
      totalCost: 52_000,
      startDate: START,
      roundPayment: true
    });

    expect(solved.roundPayment.requested).toBe(true);
    expect(solved.roundPayment.applied).toBe(true);
    expect(solved.roundPayment.withinMargins).toBe(false);
    expect(solved.schedule).toHaveLength(24);
    expect(new Set(solved.schedule.map((row) => row.instalment)).size).toBe(1);
    expect(solved.schedule.some((row) => row.adjusted)).toBe(false);
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

/* ------------------------------------------------- no adjusted instalment (INV-015) */

/**
 * The invariant added by the fifth round of feedback, and the strictest in the file:
 * « Aucun échéancier avec ajustement de fin n'est autorisé. »
 *
 * Two people who agree on 84 € a month set up a standing order for 84 € and forget about
 * it. A schedule whose last instalment is 83,73 € asks them to remember, ten years later,
 * to send a different figure once — and the deed would have to say so. So the amount lent
 * moves instead, to the euro, until the term falls exactly; how far it had to move is
 * shown, never hidden.
 */
describe("INV-015 — no schedule is ever settled by an adjusted final instalment", () => {
  const cases = [
    // Ordinary loans, in both modes.
    { principal: 10_000, periods: 120, periodicRate: 0.03 / 12, principalTolerance: 100 },
    { principal: 10_000, periods: 120, totalCost: 1_587, principalTolerance: 100 },
    { principal: 200_000, periods: 240, totalCost: 52_000, principalTolerance: 100 },
    { principal: 5_100, periods: 48, periodicRate: 0.03 / 12, principalTolerance: 10 },
    // Free of interest — the amount is the only lever there is (INV-014).
    { principal: 10_000, periods: 120, totalCost: 0, principalTolerance: 100 },
    { principal: 10_000, periods: 120, periodicRate: 0, principalTolerance: 10 },
    { principal: 7_349, periods: 37, totalCost: 0, principalTolerance: 0 },
    // No margin at all: the amount still moves, because the invariant outranks the margin.
    { principal: 10_000, periods: 120, totalCost: 0 },
    { principal: 12_345, periods: 37, totalCost: 987 },
    // Asks nothing sensible answers.
    { principal: 500, periods: 240, totalCost: 60 },
    { principal: 1_000, periods: 24, totalCost: 52_000 },
    { principal: 1_000, periods: 1, totalCost: 30 }
  ];

  it.each(cases)("%j settles with n identical whole-euro instalments", (params) => {
    const solved = solveLoan({ ...params, startDate: START, roundPayment: true });
    const last = solved.schedule[solved.schedule.length - 1];

    expect(solved.schedule).toHaveLength(params.periods);
    expect(Number.isInteger(solved.payment)).toBe(true);
    expect(new Set(solved.schedule.map((row) => row.instalment))).toEqual(
      new Set([solved.payment])
    );
    expect(solved.schedule.some((row) => row.adjusted)).toBe(false);
    expect(last.balance).toBe(0);
    expect(sum(solved.schedule, "capital")).toBe(solved.principal);
  });

  it("lends a whole number of euros, whatever it had to move by", () => {
    for (const params of cases) {
      const solved = solveLoan({ ...params, startDate: START, roundPayment: true });
      expect(Number.isInteger(solved.principal)).toBe(true);
      expect(solved.requestedPrincipal).toBe(params.principal);
    }
  });

  it("names the concession it made rather than making it silently", () => {
    const stretched = solveLoan({
      principal: 10_000,
      periods: 120,
      totalCost: 0,
      startDate: START,
      roundPayment: true
    });

    expect(stretched.roundPayment.withinMargins).toBe(false);
    expect(stretched.roundPayment.stage).toBe("somme");
    expect(stretched.principal).not.toBe(stretched.requestedPrincipal);
  });
});

/* ------------------------------------------------------ interest-free (INV-014) */

/**
 * A loan agreed free of interest stays free, whatever the round-instalment search would
 * rather do with it.
 *
 * The bug this locks down: 10 000 € over 120 months costs 83,33 € a month and nothing
 * else, but the search slid the instalment up to 84 € — the nearest whole euro some rate
 * settles exactly — and handed back a loan at 0,1583 % costing 80 €. Interest nobody had
 * agreed to, on the one figure the two parties are most likely to have discussed.
 */
describe("INV-014 — a loan asked for free of interest costs nothing", () => {
  const free = (params) =>
    solveLoan({ periods: 120, startDate: START, roundPayment: true, ...params });

  it.each([
    ["a zero cost", { principal: 10_000, totalCost: 0 }],
    ["a zero rate", { principal: 10_000, periodicRate: 0 }],
    ["a zero cost with a margin on the amount", { principal: 10_000, totalCost: 0, principalTolerance: 500 }],
    ["a zero cost with a margin on the cost", { principal: 10_000, totalCost: 0, objectiveTolerance: 200 }],
    ["a principal that divides evenly", { principal: 12_000, totalCost: 0 }],
    ["an amount that is not a round hundred", { principal: 7_349, totalCost: 0 }]
  ])("%s carries no interest", (_, params) => {
    const solved = free(params);

    expect(solved.interestFree).toBe(true);
    expect(solved.rate).toBe(0);
    expect(solved.annualNominalRate).toBe(0);
    expect(solved.effectiveCost).toBe(0);
    expect(solved.schedule.every((row) => row.interest === 0)).toBe(true);
    // Whatever else gives way, the debt is still settled to the cent.
    expect(solved.schedule[solved.schedule.length - 1].balance).toBe(0);
    expect(sum(solved.schedule, "capital")).toBe(solved.principal);
  });

  it("keeps whole-euro instalments when the principal divides by the term", () => {
    const solved = free({ principal: 12_000, totalCost: 0 });

    expect(solved.payment).toBe(100);
    expect(solved.roundPayment.applied).toBe(true);
    expect(solved.schedule.every((row) => row.instalment === 100)).toBe(true);
  });

  it("moves the amount inside the margin to make the instalment round", () => {
    const solved = free({ principal: 10_000, totalCost: 0, principalTolerance: 500 });

    expect(solved.principal).toBe(9_960);
    expect(solved.payment).toBe(83);
    expect(solved.schedule.every((row) => row.instalment === 83)).toBe(true);
  });

  /**
   * There is no falling back on cents any more (INV-015). 10 000 € over 120 months does
   * not divide into whole euros, so the amount moves until it does — 9 960 € is 83 € a
   * month, exactly, and still free — even though no margin was given on it, because a
   * schedule with an adjusted final instalment is not a thing this tool may produce.
   */
  it("stretches the amount rather than adjust the last instalment", () => {
    const solved = free({ principal: 10_000, totalCost: 0 });

    expect(solved.roundPayment.applied).toBe(true);
    expect(solved.roundPayment.stage).toBe("somme");
    expect(solved.principal).toBe(9_960);
    expect(solved.payment).toBe(83);
    expect(solved.schedule.every((row) => row.instalment === 83)).toBe(true);
    expect(solved.schedule[119].balance).toBe(0);
  });

  /**
   * The amounts a free loan can settle on are exactly the multiples of the term, since the
   * instalment is the capital divided by it and must come out in whole euros. They are
   * therefore spaced `n` euros apart, and the amount never has to move by more than half a
   * term to reach one — 60 € on a ten-year loan.
   */
  it("points at the nearest amount that would divide", () => {
    // 9 960 = 120 × 83, forty euros away; 10 080 = 120 × 84 is twice as far.
    expect(nearestInterestFreePrincipal(10_000, 120)).toEqual({ principal: 9_960, payment: 83 });
    expect(nearestInterestFreePrincipal(10_000, 7)).toEqual({ principal: 10_003, payment: 1_429 });
    // Even a term as awkward as 999 months has one, ten euros away.
    expect(nearestInterestFreePrincipal(10_000, 999)).toEqual({ principal: 9_990, payment: 10 });
  });

  it("finds nothing to round when the margin holds the amount still", () => {
    expect(
      solveInterestFreeRoundPayment({ principal: 10_000, periods: 120 })
    ).toBe(null);
  });

  it("still charges interest the moment any is asked for", () => {
    const solved = free({ principal: 10_000, totalCost: 1 });

    expect(solved.interestFree).toBe(false);
    expect(solved.effectiveCost).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------- taxation */

describe("the flat tax on interest", () => {
  it("is 30 %, and exactly that", () => {
    expect(FLAT_TAX_RATE).toBe(0.3);
  });

  it("leaves the lender seven tenths of what the borrower pays", () => {
    expect(afterFlatTax(1_520)).toBeCloseTo(1_064, 10);
    expect(afterFlatTax(0)).toBe(0);
  });
});

/* ------------------------------------------------- negotiating margins (INV-010) */

describe("INV-010 — a solution honours every margin it was given", () => {
  const rateObjective = (value, tolerance) => ({ kind: "rate", value, tolerance });
  const costObjective = (value, tolerance) => ({ kind: "cost", value, tolerance });

  const cases = [
    [5_100, 200, 48, rateObjective(0.03, 0.001)],
    [5_100, 200, 60, rateObjective(0.03, 0.001)],
    [5_100, 200, 24, rateObjective(0.03, 0.001)],
    [12_000, 500, 60, rateObjective(0.035, 0.002)],
    [20_000, 1_000, 84, rateObjective(0.025, 0.001)],
    [12_000, 500, 48, costObjective(900, 60)]
  ];

  it.each(cases)("P=%s ±%s n=%s stays inside both margins", (principal, tol, periods, objective) => {
    const found = solveWithinTolerances({
      principal,
      principalTolerance: tol,
      periods,
      objective
    });

    expect(found.found).toBe(true);
    expect(Math.abs(found.principalOffset)).toBeLessThanOrEqual(tol);
    expect(Math.abs(found.objectiveOffset)).toBeLessThanOrEqual(objective.tolerance + 1e-9);
  });

  it.each(cases)("P=%s ±%s n=%s lends a whole hundred", (principal, tol, periods, objective) => {
    const { principal: lent } = solveWithinTolerances({
      principal,
      principalTolerance: tol,
      periods,
      objective
    });
    expect(lent % PRINCIPAL_STEP).toBe(0);
  });

  it.each(cases)("P=%s ±%s n=%s settles with identical whole-euro instalments", (principal, tol, periods, objective) => {
    const found = solveWithinTolerances({
      principal,
      principalTolerance: tol,
      periods,
      objective
    });

    expect(Number.isInteger(found.payment)).toBe(true);
    expect(balanceAfterConstantInstalments(found.principal, periods, found.payment, found.rate)).toBe(0);

    const schedule = buildSchedule({
      principal: found.principal,
      rate: found.rate,
      periods,
      payment: found.payment,
      startDate: START,
      settleWithLastInstalment: false
    });
    expect(schedule).toHaveLength(periods);
    expect(new Set(schedule.map((row) => row.instalment))).toEqual(new Set([found.payment]));
    expect(schedule[periods - 1].balance).toBe(0);
  });

  it("keeps the amount exactly as typed when no margin is allowed on it", () => {
    const found = solveWithinTolerances({
      principal: 5_100,
      principalTolerance: 0,
      periods: 48,
      objective: rateObjective(0.03, 0.001)
    });
    expect(found.found).toBe(true);
    expect(found.principal).toBe(5_100);
  });
});

describe("the hints given when nothing fits actually work", () => {
  const tight = {
    principal: 5_100,
    principalTolerance: 0,
    periods: 60,
    objective: { kind: "rate", value: 0.03, tolerance: 0.00001 }
  };

  it("finds no solution on a deliberately impossible ask", () => {
    expect(solveWithinTolerances(tight).found).toBe(false);
  });

  // The real test of a hint is not that it renders, but that following it works.
  it("widening the objective by the amount suggested yields a solution", () => {
    const { hints } = solveWithinTolerances(tight);
    expect(hints.widenObjective).not.toBeNull();

    const widened = solveWithinTolerances({
      ...tight,
      objective: { ...tight.objective, tolerance: hints.widenObjective.needed + 1e-12 }
    });
    expect(widened.found).toBe(true);
  });

  it("widening the principal by the amount suggested yields a solution", () => {
    // A cost pinned to the euro: no amount within ten euros of 50 000 € reaches it over
    // fifteen years, but one forty euros out does.
    const spacious = {
      principal: 50_000,
      principalTolerance: 10,
      periods: 180,
      objective: { kind: "cost", value: 9_000, tolerance: 1 }
    };
    const { hints } = solveWithinTolerances(spacious);
    expect(hints.widenPrincipal).not.toBeNull();

    const widened = solveWithinTolerances({
      ...spacious,
      principalTolerance: hints.widenPrincipal.needed
    });
    expect(widened.found).toBe(true);
  });

  it("suggests a strictly larger margin than the one that already failed", () => {
    const { hints } = solveWithinTolerances(tight);
    expect(hints.widenObjective.needed).toBeGreaterThan(tight.objective.tolerance);
  });

  // Regression: the hint search used to call the public entry point, which builds hints
  // when it finds nothing, which searched again — folding back on itself exponentially.
  it("returns promptly instead of recursing into itself", () => {
    const started = Date.now();
    solveWithinTolerances(tight);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

/* ---------------------------------------------------------- purchasing power */

describe("INV-009 — constant euros", () => {
  const solve = (annualInflation) =>
    solveLoan({
      principal: 200_000,
      periods: 240,
      totalCost: 52_000,
      startDate: START,
      annualInflation
    });

  it("leaves every figure untouched at zero inflation", () => {
    const { schedule, constantCost, effectiveCost } = solve(0);

    expect(constantCost).toBeCloseTo(effectiveCost, 8);
    for (const row of schedule) {
      expect(row.constantInstalment).toBeCloseTo(row.instalment, 10);
      expect(row.constantBalance).toBeCloseTo(row.balance, 10);
      expect(row.constantCumulativeInterest).toBeCloseTo(row.cumulativeInterest, 8);
    }
  });

  it("erodes every instalment when prices rise, more so the later it falls", () => {
    const { schedule } = solve(0.02);
    let previousRatio = Infinity;

    for (const row of schedule) {
      expect(row.constantInstalment).toBeLessThan(row.instalment);
      const ratio = row.constantInstalment / row.instalment;
      expect(ratio).toBeLessThan(previousRatio);
      previousRatio = ratio;
    }
  });

  it("inflates every instalment under deflation", () => {
    for (const row of solve(-0.01).schedule) {
      expect(row.constantInstalment).toBeGreaterThan(row.instalment);
    }
  });

  // The mistake this guards against: deflating the final cumulative total instead of
  // each instalment at its own date, which prices twenty years of payments as if they
  // had all been made on the last day.
  it("deflates each instalment at its own date, not the total at the end", () => {
    const { schedule, constantCost } = solve(0.02);
    const last = schedule[schedule.length - 1];
    const naive = last.cumulativeInterest / deflator(0.02, last.number);

    expect(constantCost).toBeCloseTo(
      schedule.reduce((sum, row) => sum + row.interest / deflator(0.02, row.number), 0),
      6
    );
    expect(constantCost).toBeGreaterThan(naive);
  });

  it("uses the equivalent monthly deflator, never the annual rate over twelve", () => {
    expect(deflator(0.02, 12)).toBeCloseTo(1.02, 12);
    expect(deflator(0.02, 6)).toBeCloseTo(Math.sqrt(1.02), 12);
    expect(deflator(0.02, 1)).toBeLessThan(1 + 0.02 / 12);
    expect(deflator(0, 240)).toBe(1);
  });

  it("computes Fisher's real rate, which the subtraction only approximates", () => {
    expect(realRate(0.024094, 0.02)).toBeCloseTo(1.024094 / 1.02 - 1, 12);
    expect(realRate(0.03, 0)).toBeCloseTo(0.03, 12);

    const exact = realRate(0.024094, 0.02);
    const approximation = 0.024094 - 0.02;
    expect(approximation).toBeGreaterThan(exact);
    expect(approximation - exact).toBeCloseTo(0.02 * exact, 9);
  });

  it("turns the real rate negative once inflation outruns the loan", () => {
    expect(solve(0.05).realAnnualRate).toBeLessThan(0);
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

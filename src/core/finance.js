/**
 * Core finance engine for an amortizing loan with constant instalments.
 *
 * Everything here is pure arithmetic: no DOM, no formatting, no I/O. That is what
 * lets the invariants of docs/SPEC-echeancier-pret.md §6 be tested without a browser.
 *
 * Scope (§4.5): no borrower insurance, no early repayment, no deferred amortization,
 * no variable rate, no interest-only loan. The functions below take a single rate and
 * a single term on purpose — extending the scope means new functions, not new flags.
 */

/** Largest periodic rate the bracketing step will explore before giving up. */
const MAX_RATE = 1e9;

/** Bisection stops once the payment residual or the bracket width falls below these. */
const RESIDUAL_TOLERANCE = 1e-12;
const BRACKET_TOLERANCE = 1e-16;
const MAX_BISECTIONS = 200;

/** Rounds to the cent. Number.EPSILON absorbs the usual binary representation drift. */
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Constant instalment of an amortizing loan, before any rounding.
 *
 *   M = P · i / (1 − (1 + i)^(−n))
 *
 * @param {number} principal borrowed amount, P
 * @param {number} rate periodic (monthly) rate, i
 * @param {number} periods number of instalments, n
 * @returns {number} the exact instalment, unrounded
 */
export function periodicPayment(principal, rate, periods) {
  if (rate === 0) return principal / periods;
  return (principal * rate) / (1 - Math.pow(1 + rate, -periods));
}

/**
 * Inverse problem — the heart of this tool (§4.2).
 *
 * The borrower knows the principal, the term and the total cost of the credit, but not
 * the rate. The target instalment is therefore known exactly:
 *
 *   M_target = (P + C) / n
 *
 * and we solve f(i) = periodicPayment(P, i, n) − M_target = 0.
 *
 * f is strictly increasing in i, so bracketing followed by bisection converges
 * unconditionally. We deliberately do NOT use Newton-Raphson as the primary method:
 * the spreadsheet RATE implementations that do (Formula.js among them) return their
 * last iterate silently when they fail to converge, which is exactly the kind of
 * invisible failure this tool exists to avoid. Bisection cannot diverge, and the
 * iteration count and residual it reports are meaningful enough to display.
 *
 * @param {number} principal borrowed amount, P
 * @param {number} totalCost cumulative interest over the whole loan, C
 * @param {number} periods number of instalments, n
 * @returns {{rate: number, iterations: number, residual: number, converged: boolean}}
 */
export function solveRate(principal, totalCost, periods) {
  const target = (principal + totalCost) / periods;

  // A loan that costs nothing carries no interest. Exact answer, no iteration needed.
  if (totalCost <= 0) {
    return { rate: 0, iterations: 0, residual: 0, converged: true };
  }

  // Bracketing: grow the upper bound until it overshoots the target instalment.
  let lo = 0;
  let hi = 0.01;
  let iterations = 0;
  while (periodicPayment(principal, hi, periods) < target && hi < MAX_RATE) {
    lo = hi;
    hi *= 2;
    iterations++;
  }

  // The target sits above anything a sane rate can produce: report the failure rather
  // than returning the bound and letting it pass for a solution.
  if (periodicPayment(principal, hi, periods) < target) {
    return {
      rate: hi,
      iterations,
      residual: periodicPayment(principal, hi, periods) - target,
      converged: false
    };
  }

  // `mid` is the only point whose residual we have actually measured, so it — and not
  // the midpoint of the surviving bracket — is the answer. Returning (lo + hi) / 2
  // after an early break is wrong by half a bracket width, which is invisible when
  // convergence is slow and glaring when it is immediate: for n = 1 the very first
  // bisection lands on the exact rate while the bracket is still 0.01 wide.
  let mid = (lo + hi) / 2;
  let residual = periodicPayment(principal, mid, periods) - target;

  for (let k = 0; k < MAX_BISECTIONS; k++) {
    iterations++;
    mid = (lo + hi) / 2;
    residual = periodicPayment(principal, mid, periods) - target;
    if (Math.abs(residual) < RESIDUAL_TOLERANCE || hi - lo < BRACKET_TOLERANCE) break;
    if (residual > 0) hi = mid;
    else lo = mid;
  }

  return { rate: mid, iterations, residual, converged: true };
}

/**
 * Month-by-month repayment table, following the rounding conventions of §4.3 to the
 * letter — they are what makes a schedule add up:
 *
 *   1. the instalment is rounded to the cent once, up front;
 *   2. each period rounds interest to the cent on the outstanding balance, then
 *      derives the amortized capital from the rounded instalment;
 *   3. the last instalment absorbs the accumulated drift and settles the balance
 *      exactly, which is why it differs from the others by a few cents.
 *
 * The table always has exactly `periods` rows (INV-003). The mid-schedule clamp below
 * is defensive only: with a correctly rounded instalment the cumulative drift stays
 * under 0.005 × n, far below one instalment, so a loan cannot settle early.
 *
 * @param {object} params
 * @param {number} params.principal borrowed amount
 * @param {number} params.rate periodic rate
 * @param {number} params.periods number of instalments
 * @param {number} params.payment instalment, already rounded to the cent
 * @param {Date} params.startDate date of the first instalment
 * @returns {Array<object>} one row per instalment
 */
export function buildSchedule({
  principal,
  rate,
  periods,
  payment,
  startDate,
  settleWithLastInstalment = true
}) {
  const rows = [];
  let balance = principal;
  let cumulativeInterest = 0;
  let cumulativeCapital = 0;

  for (let k = 1; k <= periods; k++) {
    const interest = round2(balance * rate);
    let capital = round2(payment - interest);
    let instalment = payment;

    // The final instalment settles whatever is left, and takes the drift with it —
    // unless the caller has already picked a rate that lands on zero on its own, in
    // which case every instalment must stay strictly equal (see solveRoundPayment).
    if (settleWithLastInstalment && (k === periods || capital > balance)) {
      capital = round2(balance);
      instalment = round2(capital + interest);
    }

    balance = round2(balance - capital);
    cumulativeInterest = round2(cumulativeInterest + interest);
    cumulativeCapital = round2(cumulativeCapital + capital);

    rows.push({
      number: k,
      date: addMonths(startDate, k - 1),
      instalment,
      interest,
      capital,
      balance,
      cumulativeInterest,
      cumulativeCapital,
      adjusted: instalment !== payment
    });
  }

  return rows;
}

/**
 * Balance left after `periods` instalments of exactly `payment`, with no final
 * adjustment. Negative means the borrower has overpaid, positive that a debt remains.
 *
 * Used to hunt for the rates that settle a loan without ever varying the instalment.
 */
export function balanceAfterConstantInstalments(principal, periods, payment, rate) {
  let balance = principal;

  for (let k = 1; k <= periods; k++) {
    balance = round2(balance - round2(payment - round2(balance * rate)));

    if (balance <= 0) {
      // The debt is gone. Carrying on would charge interest on a credit, which makes the
      // balance *fall* as the rate rises and destroys the monotonicity the search relies
      // on. Settling on the last instalment is the goal; settling earlier means the
      // instalment is too large for the term, so we report the instalments that would
      // have been paid into the void — still monotonic, and never zero by accident.
      return k === periods ? balance : balance - payment * (periods - k);
    }
  }

  return balance;
}

/**
 * Finds a rate for which `periods` instalments of exactly `payment` settle the loan to
 * the cent — no adjusted final instalment, no residue.
 *
 * The rate is a continuous parameter while the closing balance only takes values in
 * whole cents, so the rates that land on zero form an interval rather than a point. The
 * balance increases with the rate, so bracketing then bisection finds the boundary; but
 * the balance moves in steps, and a step can jump over zero, so a boundary is accepted
 * only when it actually lands there. When it does not, no rate settles this instalment
 * and the caller should try another one.
 *
 * @returns {number|null} a settling rate, or null if this instalment admits none
 */
export function rateForExactInstalment(principal, periods, payment) {
  const totalPaid = payment * periods;

  // Instalments that never cover the principal cannot repay it at any rate.
  if (totalPaid < principal) return null;
  // Paying back exactly the principal is the interest-free case.
  if (totalPaid === principal) return 0;

  let hi = 1e-6;
  while (balanceAfterConstantInstalments(principal, periods, payment, hi) < 0 && hi < 1) {
    hi *= 2;
  }
  if (balanceAfterConstantInstalments(principal, periods, payment, hi) < 0) return null;

  let lo = 0;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (balanceAfterConstantInstalments(principal, periods, payment, mid) < 0) lo = mid;
    else hi = mid;
  }

  for (const candidate of [hi, (lo + hi) / 2, lo]) {
    if (balanceAfterConstantInstalments(principal, periods, payment, candidate) === 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Picks the whole-euro instalment nearest to `targetPayment` that some rate settles
 * exactly, so that every single instalment of the loan is the same round amount.
 *
 * Not every whole-euro instalment admits such a rate, so the search walks outwards one
 * euro at a time. On a tie the lower instalment wins, which is the cheaper of the two
 * for the borrower.
 *
 * @returns {{payment: number, rate: number, offset: number}|null}
 */
export function solveRoundPayment({ principal, periods, targetPayment, maxOffset = 24 }) {
  const start = Math.max(1, Math.round(targetPayment));

  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidates = offset === 0 ? [start] : [start - offset, start + offset];
    for (const payment of candidates) {
      if (payment <= 0) continue;
      const rate = rateForExactInstalment(principal, periods, payment);
      if (rate !== null) return { payment, rate, offset };
    }
  }
  return null;
}

/**
 * A loan between individuals is negotiated in round hundreds: one lends 5 100 €, never
 * 5 137,42 €. This is a property of the problem, not a setting — what the lender adjusts
 * is how far from the intended amount they are willing to move.
 */
export const PRINCIPAL_STEP = 100;

/** How far the hint search will stretch the principal before giving up, in euros. */
const MAX_HINT_PRINCIPAL_OFFSET = 5_000;

/** Half-width of the instalment sweep used to answer "how much would you have to give?". */
const HINT_RATE_SPAN = 0.05;
const HINT_COST_SPAN_PER_PERIOD = 60;

/**
 * Whole-hundred principals within tolerance, nearest intent first.
 *
 * With a zero tolerance the lender means the amount they typed, whether or not it is a
 * round hundred, so the granularity does not get to overrule them.
 */
function candidatePrincipals(target, tolerance) {
  if (!(tolerance > 0)) return [target];

  const low = Math.ceil((target - tolerance) / PRINCIPAL_STEP) * PRINCIPAL_STEP;
  const high = Math.floor((target + tolerance) / PRINCIPAL_STEP) * PRINCIPAL_STEP;

  const candidates = [];
  for (let value = low; value <= high; value += PRINCIPAL_STEP) {
    if (value > 0) candidates.push(value);
  }
  if (!candidates.length) return [target];

  return candidates.sort(
    (a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b
  );
}

/** What the caller is aiming at, and how far it may be missed. */
function measure(objective, principal, payment, periods, rate) {
  return objective.kind === "rate" ? rate * 12 : payment * periods - principal;
}

/**
 * The whole-euro instalments worth trying for this principal: those whose settling rate,
 * or resulting cost, could land inside the band. The instalment grows with the rate, so
 * the band pins the range down to a handful of integers.
 */
function instalmentRange(objective, principal, periods, span) {
  const { kind, value, tolerance } = objective;
  const width = span === undefined ? tolerance : span;

  if (kind === "rate") {
    const low = periodicPayment(principal, Math.max(0, value - width) / 12, periods);
    const high = periodicPayment(principal, (value + width) / 12, periods);
    return [Math.max(1, Math.floor(low)), Math.ceil(high)];
  }

  return [
    Math.max(1, Math.floor((principal + value - width) / periods)),
    Math.ceil((principal + value + width) / periods)
  ];
}

/**
 * Finds a loan that is round in every way the lender cares about: a principal in whole
 * hundreds, an instalment in whole euros, identical on all `n` dates, settling the debt
 * to the cent — while staying inside the tolerances given for the principal and for the
 * rate (or the cost).
 *
 * Three degrees of freedom instead of one. Where solveRoundPayment could only slide the
 * instalment and let the rate land wherever it fell, here the principal moves too and
 * the rate is held to account, which is both more useful and far more often solvable.
 *
 * @param {object} params
 * @param {number} params.principal intended amount
 * @param {number} params.principalTolerance how far the amount may move, in euros
 * @param {number} params.periods number of instalments
 * @param {{kind: "rate"|"cost", value: number, tolerance: number}} params.objective
 *        `rate` values are annual nominal rates (0.03 for 3 %), `cost` values are euros
 * @returns {object} either a solution, or the two ways of widening that would yield one
 */
export function solveWithinTolerances({ principal, principalTolerance, periods, objective }) {
  const solutions = searchSolutions({ principal, principalTolerance, periods, objective });

  if (solutions.length) {
    return { found: true, ...solutions[0], alternatives: solutions.length };
  }

  return { found: false, hints: buildHints({ principal, principalTolerance, periods, objective }) };
}

/**
 * The search itself, without the hint machinery. Kept separate because the hints widen
 * the tolerances and search again: were they to call the public function, each miss
 * would build its own hints, which would search again, and the whole thing would fold
 * back on itself exponentially.
 *
 * @returns {Array<object>} admissible combinations, best first
 */
function searchSolutions({ principal, principalTolerance, periods, objective }) {
  const principals = candidatePrincipals(principal, principalTolerance);
  const solutions = [];

  for (const candidate of principals) {
    const [low, high] = instalmentRange(objective, candidate, periods);

    for (let payment = low; payment <= high; payment++) {
      const rate = rateForExactInstalment(candidate, periods, payment);
      if (rate === null) continue;

      const achieved = measure(objective, candidate, payment, periods, rate);
      if (Math.abs(achieved - objective.value) > objective.tolerance + 1e-9) continue;

      solutions.push({
        principal: candidate,
        payment,
        rate,
        achieved,
        cost: payment * periods - candidate,
        principalOffset: candidate - principal,
        objectiveOffset: achieved - objective.value
      });
    }
  }

  // Nearest intended amount first, then nearest intended rate or cost: moving the
  // principal is a negotiation with the other party, moving the rate is not.
  return solutions.sort(
    (a, b) =>
      Math.abs(a.principalOffset) - Math.abs(b.principalOffset) ||
      Math.abs(a.objectiveOffset) - Math.abs(b.objectiveOffset)
  );
}

/**
 * When nothing fits, saying so is not enough — the lender is mid-negotiation and needs to
 * know which way to give. Both directions are costed separately, because conceding on the
 * amount and conceding on the rate are different conversations.
 */
function buildHints({ principal, principalTolerance, periods, objective }) {
  return {
    widenObjective: minimumObjectiveWidening({
      principal,
      principalTolerance,
      periods,
      objective
    }),
    widenPrincipal: minimumPrincipalWidening({
      principal,
      principalTolerance,
      periods,
      objective
    })
  };
}

/** Keeping the principal tolerance: how much rate, or cost, would have to be conceded. */
function minimumObjectiveWidening({ principal, principalTolerance, periods, objective }) {
  const span =
    objective.kind === "rate" ? HINT_RATE_SPAN : HINT_COST_SPAN_PER_PERIOD * periods;

  let best = null;

  for (const candidate of candidatePrincipals(principal, principalTolerance)) {
    const [low, high] = instalmentRange(objective, candidate, periods, span);

    for (let payment = low; payment <= high; payment++) {
      const rate = rateForExactInstalment(candidate, periods, payment);
      if (rate === null) continue;

      const achieved = measure(objective, candidate, payment, periods, rate);
      const distance = Math.abs(achieved - objective.value);
      if (best === null || distance < best.needed) {
        best = { needed: distance, principal: candidate, payment, rate, achieved };
      }
    }
  }

  return best;
}

/** Keeping the rate or cost tolerance: how far the amount would have to move. */
function minimumPrincipalWidening({ principal, principalTolerance, periods, objective }) {
  for (
    let tolerance = Math.max(principalTolerance, 0) + PRINCIPAL_STEP;
    tolerance <= MAX_HINT_PRINCIPAL_OFFSET;
    tolerance += PRINCIPAL_STEP
  ) {
    const [best] = searchSolutions({
      principal,
      principalTolerance: tolerance,
      periods,
      objective
    });
    if (best) {
      return {
        needed: Math.abs(best.principalOffset),
        principal: best.principal,
        payment: best.payment,
        rate: best.rate,
        achieved: best.achieved
      };
    }
  }
  return null;
}

/**
 * Solves the loan from whichever quantity the user knows, and unrolls the schedule.
 * Single entry point so that the UI and the tests exercise the same path.
 *
 * @param {object} params
 * @param {number} params.principal borrowed amount
 * @param {number} params.periods number of instalments
 * @param {Date} params.startDate date of the first instalment
 * @param {number} [params.totalCost] cumulative interest, when the rate is unknown
 * @param {number} [params.periodicRate] periodic rate, when the cost is unknown
 * @returns {object} rate, payment, schedule and solver diagnostics
 */
export function solveLoan({
  principal,
  periods,
  startDate,
  totalCost,
  periodicRate,
  roundPayment = false,
  annualInflation = 0,
  principalTolerance = 0,
  objectiveTolerance = 0
}) {
  const rateIsKnown = periodicRate !== undefined;

  let rate;
  let exactPayment;
  let targetCost;
  let iterations = 0;
  let residual = 0;
  let converged = true;

  if (rateIsKnown) {
    rate = periodicRate;
    exactPayment = periodicPayment(principal, rate, periods);
    targetCost = exactPayment * periods - principal;
  } else {
    targetCost = totalCost;
    exactPayment = (principal + totalCost) / periods;
    const solved = solveRate(principal, totalCost, periods);
    ({ rate, iterations, residual, converged } = solved);
  }

  let payment = round2(exactPayment);
  let settleWithLastInstalment = true;
  let rounded = null;
  let lentPrincipal = principal;
  let tolerances = null;

  const tolerancesGiven = principalTolerance > 0 || objectiveTolerance > 0;

  if (roundPayment && tolerancesGiven) {
    // With a margin to play with, the principal becomes a third unknown and the rate is
    // held to the band the lender asked for, instead of landing wherever it fell.
    const objective = rateIsKnown
      ? { kind: "rate", value: periodicRate * 12, tolerance: objectiveTolerance }
      : { kind: "cost", value: totalCost, tolerance: objectiveTolerance };

    tolerances = solveWithinTolerances({
      principal,
      principalTolerance,
      periods,
      objective
    });

    if (tolerances.found) {
      lentPrincipal = tolerances.principal;
      rate = tolerances.rate;
      payment = tolerances.payment;
      settleWithLastInstalment = false;
      residual = 0;
      converged = true;
      rounded = { payment, rate, offset: 0 };
    }
  }

  // No tolerances, or none of them helped: fall back to sliding the instalment alone.
  if (roundPayment && !rounded) {
    rounded = solveRoundPayment({ principal, periods, targetPayment: exactPayment });
    if (rounded) {
      // The rate is no longer the one that matches the requested cost: it is the one
      // that makes this round instalment come out even. The cost follows from it.
      rate = rounded.rate;
      payment = rounded.payment;
      settleWithLastInstalment = false;
      residual = 0;
      converged = true;
    }
  }

  const schedule = inConstantEuros(
    buildSchedule({
      principal: lentPrincipal,
      rate,
      periods,
      payment,
      startDate,
      settleWithLastInstalment
    }),
    annualInflation
  );
  const lastRow = schedule.length ? schedule[schedule.length - 1] : null;
  const effectiveCost = lastRow ? lastRow.cumulativeInterest : 0;

  return {
    // The amount actually lent, which the tolerance search may have moved off the
    // amount asked for; `requestedPrincipal` keeps the intention for comparison.
    principal: lentPrincipal,
    requestedPrincipal: principal,
    periods,
    rate,
    annualNominalRate: annualNominalRate(rate),
    annualEquivalentRate: annualEquivalentRate(rate),
    payment,
    exactPayment,
    targetCost,
    effectiveCost,
    costDrift: round2(effectiveCost - targetCost),
    schedule,
    iterations,
    residual,
    converged,
    rateIsKnown,
    // Purchasing power. Nominal figures stay the headline — they are what leaves the
    // account — and these restate them in euros of the day the loan starts.
    annualInflation,
    realAnnualRate: realRate(annualNominalRate(rate), annualInflation),
    constantCost: lastRow ? lastRow.constantCumulativeInterest : 0,
    constantTotalPaid: lastRow
      ? lastRow.constantCumulativeInterest + lastRow.constantCumulativeCapital
      : 0,
    // Tolerance search: null when no margin was given, otherwise the solution found or
    // the two hints saying which way to give ground.
    tolerances,
    // Round-instalment mode: applied tells the UI whether the constraint could be met,
    // offset how many euros away from the ideal instalment we had to go to meet it.
    roundPayment: {
      requested: roundPayment,
      applied: Boolean(rounded),
      offset: rounded ? rounded.offset : null,
      idealPayment: round2(exactPayment)
    }
  };
}

/**
 * Purchasing-power deflator for the instalment of rank `k`, in euros of the day the loan
 * starts. Instalment 1 falls one month after the loan begins — it already carries a
 * month of interest — so rank and elapsed months coincide.
 *
 * The exponent is k/12 of the ANNUAL rate: inflation compounds, so the monthly deflator
 * is the equivalent (actuarial) one, never the annual rate divided by twelve. Same
 * distinction as §4.4 makes for the interest rate, and for the same reason.
 *
 * @param {number} annualInflation e.g. 0.02 for 2 % a year; may be negative
 * @param {number} monthIndex rank of the instalment, 1-based
 */
export function deflator(annualInflation, monthIndex) {
  return Math.pow(1 + annualInflation, monthIndex / 12);
}

/**
 * Fisher's real rate: what the lender actually earns once inflation has eaten its share.
 *
 *   (1 + nominal) / (1 + inflation) − 1
 *
 * Not `nominal − inflation`, which is only its first-order approximation; the two differ
 * by `inflation × real`, small at these rates but not zero, and this tool does not round
 * away the things it can state exactly.
 */
export function realRate(annualNominal, annualInflation) {
  return (1 + annualNominal) / (1 + annualInflation) - 1;
}

/**
 * Restates a schedule in euros of the loan's start date.
 *
 * Every instalment is deflated at ITS OWN date before being summed — deflating the final
 * cumulative total instead would price twenty years of payments as if they had all been
 * made on the last day, and overstates the erosion enormously.
 *
 * Returns new rows; the nominal figures are left untouched, because they are what is
 * actually transferred each month.
 *
 * @param {Array<object>} schedule rows from buildSchedule()
 * @param {number} annualInflation
 */
export function inConstantEuros(schedule, annualInflation) {
  let cumulativeInterest = 0;
  let cumulativeCapital = 0;

  return schedule.map((row) => {
    const factor = deflator(annualInflation, row.number);
    const interest = row.interest / factor;
    const capital = row.capital / factor;

    cumulativeInterest += interest;
    cumulativeCapital += capital;

    return {
      ...row,
      constantInstalment: row.instalment / factor,
      constantInterest: interest,
      constantCapital: capital,
      constantBalance: row.balance / factor,
      constantCumulativeInterest: cumulativeInterest,
      constantCumulativeCapital: cumulativeCapital
    };
  });
}

/** Proportional annual rate — the convention French loan offers quote (§4.4). */
export function annualNominalRate(periodicRate) {
  return periodicRate * 12;
}

/** Actuarial annual rate. Never to be confused with the nominal one (§4.4). */
export function annualEquivalentRate(periodicRate) {
  return Math.pow(1 + periodicRate, 12) - 1;
}

/**
 * Same calendar day in a later month, clamped to the end of short months so that
 * a 31st never silently rolls into the next month.
 */
export function addMonths(date, months) {
  const shifted = new Date(date.getTime());
  const day = shifted.getDate();
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDayOfMonth = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDayOfMonth));
  return shifted;
}

/**
 * ISO date built from local calendar components. Deliberately not toISOString(),
 * which converts to UTC first and shifts the date by a day depending on the time zone.
 */
export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

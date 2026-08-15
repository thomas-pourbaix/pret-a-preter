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
  for (let k = 0; k < periods; k++) {
    balance = round2(balance - round2(payment - round2(balance * rate)));
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
  roundPayment = false
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

  if (roundPayment) {
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

  const schedule = buildSchedule({
    principal,
    rate,
    periods,
    payment,
    startDate,
    settleWithLastInstalment
  });
  const effectiveCost = schedule.length
    ? schedule[schedule.length - 1].cumulativeInterest
    : 0;

  return {
    principal,
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

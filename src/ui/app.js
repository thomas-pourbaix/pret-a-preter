/**
 * Wiring: reads the form, solves the loan, renders the three views, drives the exports.
 * All the arithmetic lives in src/core; this file only moves values around.
 */

import {
  FLAT_TAX_RATE,
  addMonths,
  afterFlatTax,
  nearestInterestFreePrincipal,
  realRate,
  solveLoan,
  toIsoDate
} from "../core/finance.js";
import {
  formatEuro,
  formatEuroRounded,
  formatMonth,
  formatNumber,
  formatPercent,
  formatSteppedPercent,
  parseFrenchNumber,
  roundToRateStep
} from "../core/format.js";
import { VERSION } from "../core/version.js";
import { exportCsv } from "../export/csv.js";
import { exportDeedPdf } from "../export/pdf/deed.js";
import { exportXlsx } from "../export/xlsx.js";
import { renderBalanceChart, renderInstalmentChart } from "./chart.js";
import { renderTable } from "./table.js";

const MAX_PERIODS = 1200;

const el = (id) => document.getElementById(id);

const state = { solved: null, inputs: null, view: "monthly", constantEuros: true };

/* ------------------------------------------------------------------------ steps */

/**
 * The fields that move in steps rather than freely.
 *
 * `step` is a quantum the value is held to: a loan between individuals is lent in whole
 * hundreds and negotiated by the twentieth of a point, so an amount typed between two
 * steps is not a finer intention, it is a slip. Those fields snap to the nearest step.
 *
 * `buttons` are the increments offered next to the field. They exist for speed — a
 * hand-typed amount runs the solver once per keystroke, on values nobody meant — and are
 * the reason the coarse increment is offered beside the fine one.
 */
const STEPPED = {
  principal: { step: 100, buttons: [1000, 100], decimals: 0, floor: 100, unit: "€" },
  "principal-tolerance": { step: 100, buttons: [1000, 100], decimals: 0, floor: 0, unit: "€" },
  // The cost is a target, not a sum anyone transfers: 1 587 € is a perfectly meant
  // figure — it is what 3 % comes to — so it gets the buttons without the quantum.
  cost: { buttons: [1000, 100], decimals: 0, floor: 0, unit: "€" },
  "cost-tolerance": { buttons: [1000, 100], decimals: 0, floor: 0, unit: "€" },
  rate: { step: 0.05, buttons: [0.5, 0.05], decimals: 2, floor: 0, unit: "point" },
  "rate-tolerance": { step: 0.05, buttons: [0.5, 0.05], decimals: 2, floor: 0, unit: "point" }
};

/** Nearest multiple of `step`, without the binary drift that turns 0,15 into 0,150000002. */
const snap = (value, step) => Number((Math.round(value / step) * step).toFixed(6));

/** What a stepped field is worth once its quantum and its floor have been applied. */
function fieldValue(id) {
  const spec = STEPPED[id];
  const raw = parseFrenchNumber(el(id).value);
  if (!spec || !Number.isFinite(raw)) return raw;

  return Math.max(spec.floor, spec.step ? snap(raw, spec.step) : raw);
}

/** Writes a stepped field back in its own terms — this is where a slip becomes visible. */
function normalise(id) {
  const value = fieldValue(id);
  if (Number.isFinite(value)) el(id).value = formatNumber(value, STEPPED[id].decimals);
}

/* ------------------------------------------------------------------------ inputs */

function readInputs() {
  const principal = fieldValue("principal");
  const term = parseFrenchNumber(el("term").value);
  const periods = el("term-unit").value === "years" ? Math.round(term * 12) : Math.round(term);
  const rateIsKnown = el("known-rate").checked;
  const totalCost = fieldValue("cost");
  const annualRate = fieldValue("rate") / 100;
  const startDate = el("start").value
    ? new Date(`${el("start").value}T12:00:00`)
    : new Date();
  const annualInflation = parseFrenchNumber(el("inflation").value) / 100;

  // The margin applies to whichever quantity is being aimed at, so it comes from the
  // field that is currently on screen.
  const principalTolerance = Math.abs(fieldValue("principal-tolerance")) || 0;
  const objectiveTolerance = rateIsKnown
    ? Math.abs(fieldValue("rate-tolerance") / 100) || 0
    : Math.abs(fieldValue("cost-tolerance")) || 0;

  return {
    principal,
    periods,
    rateIsKnown,
    totalCost,
    annualRate,
    startDate,
    annualInflation,
    principalTolerance,
    objectiveTolerance
  };
}

/** Returns a message to show, or null when the inputs are usable. */
function validate(inputs) {
  if (!Number.isFinite(inputs.principal) || inputs.principal <= 0) {
    return "Indiquez une somme empruntée supérieure à zéro.";
  }
  if (!Number.isFinite(inputs.periods) || inputs.periods < 1) {
    return "La durée doit valoir au moins une mensualité.";
  }
  if (inputs.periods > MAX_PERIODS) {
    return "La durée dépasse 100 ans : vérifiez l'unité choisie.";
  }
  if (inputs.rateIsKnown) {
    if (!Number.isFinite(inputs.annualRate) || inputs.annualRate < 0) {
      return "Indiquez un taux annuel positif ou nul.";
    }
    if (inputs.annualRate > 1) {
      return "Le taux annuel saisi dépasse 100 % : vérifiez la valeur.";
    }
  } else if (!Number.isFinite(inputs.totalCost) || inputs.totalCost < 0) {
    return "Indiquez un coût total positif ou nul.";
  }
  if (!Number.isFinite(inputs.annualInflation)) {
    return "Indiquez un taux d'inflation, même nul.";
  }
  // Below −100 % the deflator turns negative and every constant-euro figure with it.
  if (inputs.annualInflation <= -1) {
    return "Le taux d'inflation doit rester supérieur à −100 %.";
  }
  return null;
}

/* ------------------------------------------------------------------------ compute */

function compute() {
  const inputs = readInputs();
  state.inputs = inputs;

  el("term-hint").textContent = Number.isFinite(inputs.periods)
    ? `${inputs.periods} mensualités`
    : "—";

  const problem = validate(inputs);
  const errorBox = el("error");

  if (problem) {
    errorBox.hidden = false;
    errorBox.textContent = problem;
    state.solved = null;
    setExportsEnabled(false);
    // Notes describe a result; with no result they would describe the previous one.
    for (const id of [
      "round-note",
      "rate-warning",
      "convergence-warning",
      "inflation-effect",
      "tolerance-note"
    ]) {
      el(id).hidden = true;
    }
    el("balance-body").replaceChildren();
    el("balance-caption").textContent = "";
    renderTable({ tbody: el("tbody"), schedule: [], view: state.view });
    renderCharts([], 0, 0);
    return;
  }

  errorBox.hidden = true;

  state.solved = solveLoan({
    principal: inputs.principal,
    periods: inputs.periods,
    startDate: inputs.startDate,
    // Round instalments are the whole point of the tool, not an option: a loan between
    // individuals is repaid by standing order, and a standing order is a whole number of
    // euros. What the engine adjusts to honour it is the rate.
    roundPayment: true,
    annualInflation: inputs.annualInflation,
    principalTolerance: inputs.principalTolerance,
    objectiveTolerance: inputs.objectiveTolerance,
    ...(inputs.rateIsKnown
      ? { periodicRate: inputs.annualRate / 12 }
      : { totalCost: inputs.totalCost })
  });

  setExportsEnabled(true);
  renderReadout();
  renderTable({ tbody: el("tbody"), schedule: state.solved.schedule, view: state.view });
  renderCharts(state.solved.schedule, state.solved.principal, state.solved.annualInflation);
}

function renderCharts(schedule, principal, annualInflation) {
  renderInstalmentChart({ svg: el("chart"), probe: el("probe"), schedule });
  renderBalanceChart({
    svg: el("chart-balance"),
    probe: el("probe-balance"),
    schedule,
    principal,
    annualInflation,
    constantEuros: state.constantEuros
  });
}

/* ------------------------------------------------------------------------ readout */

function renderReadout() {
  const solved = state.solved;
  const round = solved.roundPayment;

  // "mensualité ronde impossible" read as a setting that had failed, when nothing was ever
  // switched on: whole-euro instalments are what this tool computes. What the tag names
  // when they are unreachable is the convention the calculation fell back to.
  el("mode-tag").textContent = solved.interestFree
    ? "sans intérêt"
    : round.applied
      ? solved.rateIsKnown
        ? "taux fixé"
        : "coût fixé"
      : "repli bancaire";

  renderRateWarning(solved);
  renderToleranceNote(solved);
  renderRoundWarning(solved);
  renderInflationEffect(solved);
  renderBalanceSheet(solved);

  // The solver's own diagnostics — iteration count, residual, "no adjusted instalment",
  // "final balance 0,00 €" — used to be printed under the balance sheet on every run.
  // They are invariants, not findings: the schedule always settles at zero and no
  // instalment is ever adjusted, so a line saying so told the reader nothing they could
  // act on. Only a failure is worth their attention, and each failure has its own note.
  el("convergence-warning").hidden = solved.converged;
}

/**
 * The balance sheet: the wishes typed into the form on one side, the loan that will
 * actually be signed on the other.
 *
 * Both columns are needed, because the round instalment moves the loan. The rate is the
 * quantity that gives way so that whole-euro instalments settle the debt to the cent,
 * and the cost follows the rate. Printing only the outcome would quietly rewrite what
 * was asked for; printing only the wish would describe a loan nobody is going to sign.
 * This is the summary a debt acknowledgement is drawn from, so every line is a term of
 * the contract — not a solver diagnostic, those stay in the line underneath.
 */
function renderBalanceSheet(solved) {
  const inputs = state.inputs;
  const round = solved.roundPayment;
  const rateIsKnown = solved.rateIsKnown;
  const first = solved.schedule[0];
  const last = solved.schedule[solved.schedule.length - 1];

  const wishedTotal = solved.requestedPrincipal + solved.targetCost;
  const finalTotal = solved.principal + solved.effectiveCost;

  const rows = [
    {
      term: "Somme prêtée",
      wish: formatEuroRounded(solved.requestedPrincipal),
      wishSub: margin(inputs.principalTolerance, formatEuroRounded),
      final: formatEuroRounded(solved.principal),
      gap: solved.principal - solved.requestedPrincipal,
      gapFormat: formatEuroRounded
    },
    {
      term: "Durée",
      wish: `${solved.periods} mois`,
      final: `${solved.periods} mois`,
      finalSub: `${formatMonth(first.date)} → ${formatMonth(last.date)}`
    },
    {
      term: "Mensualité",
      hero: true,
      wish: formatEuro(round.idealPayment),
      wishSub: rateIsKnown ? "déduite du taux" : "déduite du coût",
      final: round.applied ? formatEuroRounded(solved.payment) : formatEuro(solved.payment),
      finalSub: round.applied ? null : "dernière échéance ajustée",
      gap: solved.payment - round.idealPayment,
      gapFormat: formatEuro
    },
    {
      term: "Taux annuel nominal",
      // Read on the grid it is negotiated on, with the figure the schedule was actually
      // computed from stated underneath: the rate is what gives way so that whole-euro
      // instalments settle the debt, so it lands on values nobody chose — and printing
      // 2,9116 % as the headline invites a comparison at a precision that means nothing.
      wish: rateIsKnown ? formatSteppedPercent(inputs.annualRate) : "—",
      wishSub: rateIsKnown
        ? margin(inputs.objectiveTolerance, formatSteppedPercent)
        : "l'inconnue",
      final: formatSteppedPercent(solved.annualNominalRate),
      finalSub: exactRate(solved.annualNominalRate),
      gap: rateIsKnown
        ? roundToRateStep(solved.annualNominalRate) - roundToRateStep(inputs.annualRate)
        : NaN,
      gapFormat: (value) => `${formatNumber(value * 100, 2)} pt`
    },
    {
      term: "Coût total des intérêts",
      wish: formatEuroRounded(solved.targetCost),
      wishSub: rateIsKnown
        ? "déduit du taux"
        : margin(inputs.objectiveTolerance, formatEuroRounded),
      final: formatEuroRounded(solved.effectiveCost),
      gap: solved.costDrift,
      gapFormat: formatEuroRounded
    },
    {
      term: "Total remboursé",
      wish: formatEuroRounded(wishedTotal),
      final: formatEuroRounded(finalTotal),
      gap: finalTotal - wishedTotal,
      gapFormat: formatEuroRounded
    }
  ];

  el("balance-body").replaceChildren(...rows.map(balanceRow));

  el("balance-caption").textContent = solved.interestFree
    ? `Prêt sans intérêt : les ${solved.periods} échéances ne remboursent que le capital, et ` +
      "le taux n'a rien à ajuster."
    : round.applied
      ? `Le taux est ce qui s'ajuste : il est choisi pour que ${solved.periods} virements ` +
        `de ${formatEuroRounded(solved.payment)}, tous identiques, soldent le prêt au centime.`
      : "Aucune mensualité ronde ne convenait ; la colonne de droite suit donc la convention" +
        " bancaire.";
}

function balanceRow(row) {
  const tr = document.createElement("tr");
  if (row.hero) tr.className = "hero";

  const term = document.createElement("th");
  term.scope = "row";
  term.className = "term";
  term.textContent = row.term;

  tr.append(
    term,
    cell("wish", row.wish, row.wishSub),
    cell("final", row.final, row.finalSub, describeGap(row))
  );
  return tr;
}

function cell(className, value, sub, gap) {
  const td = document.createElement("td");
  td.className = className;
  td.append(text(value));
  if (sub) td.append(subLine(sub));
  if (gap) td.append(subLine(gap, "gap"));
  return td;
}

function subLine(value, extra) {
  const span = document.createElement("span");
  span.className = extra ? `sub ${extra}` : "sub";
  span.textContent = value;
  return span;
}

/**
 * A gap worth stating is one the reader can see. Both columns are already rounded for
 * display, so a difference that prints as zero — four cents on a cumulative total, a
 * millionth of a point on a rate — would contradict the two figures it sits under.
 * Anything that does print is stated, signed, and never softened.
 */
function describeGap({ wish, final, gap, gapFormat }) {
  if (!Number.isFinite(gap) || wish === final) return null;
  if (gapFormat(Math.abs(gap)) === gapFormat(0)) return null;
  return `${gap > 0 ? "+" : ""}${gapFormat(gap)}`;
}

/**
 * The rate the schedule was computed from, when reading it on the negotiation grid has
 * rounded it away. Silent when the two coincide, so an exactly negotiated rate is not
 * repeated to itself.
 */
function exactRate(value) {
  const shown = roundToRateStep(value);
  return Math.abs(shown - value) < 5e-7 ? null : `(${formatPercent(value, 4)} retenus)`;
}

/** A negotiating margin, restated under the figure it qualifies. */
const margin = (tolerance, format) => (tolerance > 0 ? `marge ± ${format(tolerance)}` : null);

/**
 * The negotiating margins, and what came of them.
 *
 * When a combination fits, it says which amount and which rate were actually retained,
 * because both may differ from what was typed. When none fits, refusing in silence would
 * leave the lender stuck mid-negotiation, so it says how far each concession would have
 * to go — separately, since giving on the amount and giving on the rate are two
 * different conversations to have with the borrower.
 */
function renderToleranceNote(solved) {
  const note = el("tolerance-note");
  const result = solved.tolerances;

  if (!result) {
    note.hidden = true;
    return;
  }

  note.hidden = false;
  const rateMode = solved.rateIsKnown;

  // The figures themselves are in the balance sheet above; what the note adds is how much
  // room the margins actually left, which no column can show.
  if (result.found) {
    note.classList.add("info");
    note.replaceChildren(
      strong("Trouvé dans vos marges."),
      text(
        result.alternatives > 1
          ? ` ${result.alternatives} combinaisons convenaient ; le bilan retient la plus` +
            " proche de vos intentions."
          : " C'était la seule combinaison possible."
      )
    );
    return;
  }

  note.classList.remove("info");
  const { widenObjective, widenPrincipal } = result.hints;
  const objectiveUnit = (value) =>
    rateMode ? formatPercent(value, 4) : formatEuro(value);

  const parts = [
    strong("Aucune combinaison ne tient dans vos marges."),
    text(" Pour en trouver une, il faudrait élargir ")
  ];

  if (widenObjective) {
    parts.push(
      text(rateMode ? "la marge de taux à ±" : "la marge de coût à ±"),
      strong(objectiveUnit(widenObjective.needed)),
      text(
        ` (${formatEuroRounded(widenObjective.principal)} prêtés, ` +
          `${solved.periods} × ${formatEuroRounded(widenObjective.payment)})`
      )
    );
  }

  if (widenObjective && widenPrincipal) parts.push(text(", ou bien "));

  if (widenPrincipal) {
    parts.push(
      text("la marge sur la somme prêtée à ±"),
      strong(formatEuroRounded(widenPrincipal.needed)),
      text(
        ` — ${formatEuroRounded(widenPrincipal.principal)} conviendrait, ` +
          `${solved.periods} × ${formatEuroRounded(widenPrincipal.payment)} à ` +
          `${formatPercent(widenPrincipal.rate * 12, 4)}`
      )
    );
  }

  if (!widenObjective && !widenPrincipal) {
    parts.push(text("nettement les deux marges : rien n'a été trouvé à portée raisonnable."));
  } else {
    parts.push(text("."));
  }

  // Something is still displayed below, and it is not what was asked for. Say which.
  parts.push(
    text(
      solved.roundPayment.applied
        ? " En attendant, le calcul ci-dessous garde la mensualité ronde et laisse le" +
          " taux sortir de votre marge."
        : " En attendant, le calcul ci-dessous revient à la convention bancaire," +
          " dernière échéance ajustée."
    )
  );

  note.replaceChildren(...parts);
}

/**
 * Purchasing power and tax: the two things that stand between the interest a lender is
 * promised and what they are actually left with.
 *
 * A section of its own since the fourth round of feedback. Folded under the balance sheet
 * it read as a footnote to the contract, when it answers a different question: the balance
 * sheet says what will be signed, this says what it comes to. The nominal figures stay the
 * headline — they are what leaves the account, and what a standing order is set up for.
 *
 * Hidden entirely at zero inflation, where the constant-euro reading coincides with the
 * nominal one; the tax line rides with it, being the same kind of second reading.
 */
function renderInflationEffect(solved) {
  const section = el("inflation-effect");
  const active = state.constantEuros && Math.abs(solved.annualInflation) > 1e-9;

  section.hidden = !active;
  if (!active) return;

  const basis = formatMonth(solved.schedule[0].date);
  const netRate = realRate(solved.annualNominalRate * (1 - FLAT_TAX_RATE), solved.annualInflation);

  el("inflation-tag").textContent = `${formatPercent(solved.annualInflation, 2)} l'an`;
  el("inflation-lead").textContent =
    `Les montants du bilan sont nominaux : c'est ce qui quitte le compte, et ce que dit ` +
    `le contrat. Rapportés aux euros de ${basis}, une inflation de ` +
    `${formatPercent(solved.annualInflation, 2)} l'an les allège d'autant — chaque échéance ` +
    "étant déflatée à sa propre date, jamais le total à la dernière.";

  el("constant-basis").textContent = `de ${basis}`;
  el("out-constant-cost").textContent = formatEuroRounded(solved.constantCost);
  el("out-constant-total").textContent = formatEuroRounded(solved.constantTotalPaid);
  el("out-real-rate").textContent = formatPercent(solved.realAnnualRate, 3);

  el("out-net-cost").textContent = formatEuroRounded(afterFlatTax(solved.effectiveCost));
  el("out-net-constant-cost").textContent = formatEuroRounded(afterFlatTax(solved.constantCost));
  el("out-net-real-rate").textContent = formatPercent(netRate, 3);
}

/** Above this nominal annual rate, the inputs are almost certainly a slip, not a loan. */
const IMPLAUSIBLE_ANNUAL_RATE = 1;

/**
 * A cost typed into the wrong field produces a rate of several hundred percent, and the
 * engine will compute it without complaining. Say it out loud: the input mode already
 * refuses a rate above 100 %, so the cost mode should not accept its equivalent in
 * silence.
 */
function renderRateWarning(solved) {
  const warning = el("rate-warning");
  const implausible =
    !solved.rateIsKnown && solved.annualNominalRate > IMPLAUSIBLE_ANNUAL_RATE;

  warning.hidden = !implausible;
  if (!implausible) return;

  warning.textContent =
    `Le coût saisi implique un taux annuel de ${formatPercent(solved.annualNominalRate, 1)}. ` +
    "Vérifiez le capital, la durée et le coût : un tel taux ne correspond pas à un prêt. " +
    "Le calcul ci-dessous reste exact, mais il décrit autre chose que ce que vous vouliez.";
}

/**
 * The round instalment is not an option any more, so its success needs no commentary —
 * the balance sheet shows what it cost, line by line. Only its failure does: falling back
 * on the banking convention changes what the borrower signs, and that is the sort of
 * thing this tool refuses to do silently.
 */
function renderRoundWarning(solved) {
  const note = el("round-note");
  const applied = solved.roundPayment.applied;

  note.hidden = applied;
  if (applied) return;

  // Two different failures wore the same sentence. On an interest-free loan nothing was
  // slid by 24 €: the instalment is the principal divided by the term, full stop, and if
  // that is not a whole number of euros no search was ever going to make it one — the only
  // thing that could have is a different principal. Blaming a search that never ran left
  // the lender with nothing to do about it.
  if (solved.interestFree) {
    const suggestion = nearestInterestFreePrincipal(solved.principal, solved.periods);

    note.classList.add("info");
    note.replaceChildren(
      strong("Prêt sans intérêt."),
      text(
        ` La mensualité est le capital divisé par la durée, soit ${formatEuro(solved.payment)}, ` +
          "qui n'est pas un nombre entier d'euros : la dernière échéance absorbe donc les " +
          "centimes. Aucun intérêt n'est ajouté pour arrondir."
      ),
      ...(suggestion
        ? [
            text(
              ` Une somme de ${formatEuroRounded(suggestion.principal)} tomberait juste — ` +
                `${solved.periods} × ${formatEuroRounded(suggestion.payment)}.`
            )
          ]
        : [])
    );
    return;
  }

  note.classList.remove("info");
  note.textContent =
    "Aucune mensualité en euros ronds ne solde exactement ce prêt, même en s'écartant " +
    "de 24 €. La dernière échéance est donc ajustée de quelques centimes, comme le ferait " +
    "une banque.";
}

const text = (value) => document.createTextNode(value);

function strong(value) {
  const node = document.createElement("b");
  node.textContent = value;
  return node;
}

/* ------------------------------------------------------------------------ actions */

function setView(view) {
  state.view = view;
  el("view-monthly").setAttribute("aria-pressed", String(view === "monthly"));
  el("view-yearly").setAttribute("aria-pressed", String(view === "yearly"));
  renderTable({
    tbody: el("tbody"),
    schedule: state.solved ? state.solved.schedule : [],
    view
  });
}

function setExportsEnabled(enabled) {
  el("export-csv").disabled = !enabled;
  el("export-xlsx").disabled = !enabled;
  el("export-pdf").disabled = !enabled;
}

/** Exports carry the same columns as the screen, inflation view included or not. */
const exportOptions = () => ({ constantEuros: state.constantEuros });

async function downloadXlsx() {
  const button = el("export-xlsx");
  const label = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "Génération…";
    await exportXlsx(state.solved, "echeancier-pret.xlsx", exportOptions());
  } catch (error) {
    const box = el("error");
    box.hidden = false;
    box.textContent = `L'export tableur a échoué : ${error.message}`;
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

/**
 * The deed carries the contract, not the reading of it: the constant-euro columns stay
 * out of it whatever the inflation switch says on screen, so the export takes no options.
 */
function downloadDeed() {
  try {
    exportDeedPdf(state.solved, "reconnaissance-de-dette.pdf");
  } catch (error) {
    const box = el("error");
    box.hidden = false;
    box.textContent = `L'export de la reconnaissance de dette a échoué : ${error.message}`;
  }
}

/* -------------------------------------------------------------------- scheduling */

/**
 * The solver is not cheap: with a margin set it walks every whole-hundred principal in
 * the band and, for each, every whole-euro instalment that could land inside it, running
 * a bisection per candidate. Running that on each keystroke made the page stutter while a
 * three-digit margin was being typed — and every run but the last was on a number nobody
 * meant. Typing now waits for a pause; committing a field, or stepping it, does not.
 */
const TYPING_PAUSE = 280;

let pending = null;

function computeNow() {
  clearTimeout(pending);
  pending = null;
  el("readout").removeAttribute("data-pending");
  compute();
}

function scheduleCompute() {
  clearTimeout(pending);
  // Says the keystroke was seen while its consequences are still being worked out, so a
  // pause of a quarter of a second does not read as the page having ignored it.
  el("readout").setAttribute("data-pending", "");
  pending = setTimeout(computeNow, TYPING_PAUSE);
}

/* ------------------------------------------------------------------------ startup */

/** Builds the − / + row under a stepped field, coarse increment outermost. */
function attachStepper(id, spec) {
  const input = el(id);
  const row = document.createElement("div");
  row.className = "stepper";

  const deltas = [
    ...spec.buttons.map((value) => -value),
    ...[...spec.buttons].reverse()
  ];

  for (const delta of deltas) {
    const button = document.createElement("button");
    const sign = delta < 0 ? "−" : "+";
    const size = formatNumber(Math.abs(delta), spec.decimals);

    button.type = "button";
    button.textContent = `${sign}${size}`;
    button.setAttribute(
      "aria-label",
      `${delta < 0 ? "Diminuer" : "Augmenter"} de ${size} ${spec.unit}`
    );
    button.addEventListener("click", () => {
      const current = fieldValue(id);
      const next = Number.isFinite(current) ? current + delta : delta;
      input.value = formatNumber(Math.max(spec.floor, next), spec.decimals);
      computeNow();
    });

    row.appendChild(button);
  }

  input.closest(".control, .tolerance").after(row);
}

function init() {
  // Which build is on screen. The page is served with a ten-minute cache on GitHub Pages,
  // long enough to look at a stale script and draw the wrong conclusion from it.
  el("app-version").textContent = `version ${VERSION}`;

  const firstDueDate = addMonths(new Date(), 1);
  firstDueDate.setDate(5);
  el("start").value = toIsoDate(firstDueDate);

  for (const [id, spec] of Object.entries(STEPPED)) attachStepper(id, spec);

  const form = el("form");

  form.addEventListener("input", (event) => {
    if (event.target.name === "known") {
      toggleMode();
      computeNow();
      return;
    }
    if (event.target.id === "inflation-on") {
      toggleInflation();
      computeNow();
      return;
    }
    scheduleCompute();
  });

  // `change` fires when a field is left after an edit: the moment to hold a slipped
  // amount to its step, and to show the reader the value the calculation actually used.
  form.addEventListener("change", (event) => {
    if (STEPPED[event.target.id]) normalise(event.target.id);
    computeNow();
  });

  form.addEventListener("submit", (event) => event.preventDefault());

  el("view-monthly").addEventListener("click", () => setView("monthly"));
  el("view-yearly").addEventListener("click", () => setView("yearly"));
  el("export-csv").addEventListener("click", () =>
    exportCsv(state.solved, "echeancier-pret.csv", exportOptions())
  );
  el("export-xlsx").addEventListener("click", downloadXlsx);
  el("export-pdf").addEventListener("click", downloadDeed);

  toggleMode();
  toggleInflation();
  compute();
}

function toggleMode() {
  const rateIsKnown = el("known-rate").checked;
  el("field-cost").hidden = rateIsKnown;
  el("field-rate").hidden = !rateIsKnown;
}

/**
 * The constant-euro reading, on or off as a whole: the block under the balance sheet, the
 * dashed pair on the second chart and the two export columns are one and the same answer
 * to one and the same question, so they are switched together rather than one by one.
 */
function toggleInflation() {
  state.constantEuros = el("inflation-on").checked;
  el("inflation-controls").hidden = !state.constantEuros;
  el("legend-constant").hidden = !state.constantEuros;
}

init();

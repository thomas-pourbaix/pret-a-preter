/**
 * Wiring: reads the form, solves the loan, renders the three views, drives the exports.
 * All the arithmetic lives in src/core; this file only moves values around.
 */

import {
  FLAT_TAX_INCOME_RATE,
  FLAT_TAX_RATE,
  FLAT_TAX_SOCIAL_RATE,
  addMonths,
  afterFlatTax,
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
import { GENERATED_BY } from "../core/version.js";
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
  principal: { step: 10, buttons: [1000, 100, 10], decimals: 0, floor: 100, unit: "€" },
  // A margin on the amount is not optional any more, and its floor says so. It is what the
  // exact schedule leans on: the solver moves the amount to the euro until the n
  // instalments fall juste (INV-015), and a margin of zero would have it announce, on
  // one loan in seven, that it went outside a margin the lender never meant to set.
  // Measured over a grid of realistic loans: ±10 € settles 86 % of them inside the margin,
  // ±100 € settles 99 %.
  "principal-tolerance": { step: 10, buttons: [1000, 100, 10], decimals: 0, floor: 10, unit: "€" },
  // The cost is a target, not a sum anyone transfers: 1 587 € is a perfectly meant
  // figure — it is what 3 % comes to — so it gets the buttons without the quantum.
  cost: { buttons: [1000, 100], decimals: 0, floor: 0, unit: "€" },
  "cost-tolerance": { buttons: [1000, 100], decimals: 0, floor: 100, unit: "€" },
  rate: { step: 0.05, buttons: [0.5, 0.05], decimals: 2, floor: 0, unit: "point" },
  // One negotiating step is the smallest margin that means anything: below it the band is
  // narrower than the grid the rate is read on.
  "rate-tolerance": { step: 0.05, buttons: [0.5, 0.05], decimals: 2, floor: 0.05, unit: "point" }
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
      "rate-warning",
      "convergence-warning",
      "inflation-effect",
      "tax-effect",
      "tolerance-note"
    ]) {
      el(id).hidden = true;
    }
    el("balance-body").replaceChildren();
    el("balance-caption").textContent = "";
    renderTable({
      thead: el("thead"),
      tbody: el("tbody"),
      schedule: [],
      view: state.view,
      constantEuros: state.constantEuros
    });
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
  renderTable({
    thead: el("thead"),
    tbody: el("tbody"),
    schedule: state.solved.schedule,
    view: state.view,
    constantEuros: state.constantEuros
  });
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

  el("mode-tag").textContent = solved.interestFree
    ? "sans intérêt"
    : solved.rateIsKnown
      ? "taux fixé"
      : "coût fixé";

  renderRateWarning(solved);
  renderToleranceNote(solved);
  renderInflationEffect(solved);
  renderTaxEffect(solved);
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
  const exact = solved.roundPayment;
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
      wish: formatEuro(exact.idealPayment),
      wishSub: rateIsKnown ? "déduite du taux" : "déduite du coût",
      final: formatEuroRounded(solved.payment),
      finalSub: `× ${solved.periods}, sans exception`,
      gap: solved.payment - exact.idealPayment,
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
      finalSub: retainedRate(solved.annualNominalRate),
      gap: rateIsKnown
        ? roundToRateStep(solved.annualNominalRate) - roundToRateStep(inputs.annualRate)
        : NaN,
      gapFormat: (value) => `${formatNumber(value * 100, 2)} pt`
    },
    {
      term: "Coût total des intérêts",
      wish: formatEuroRounded(solved.targetCost),
      // No margin is offered on a cost of zero: « 0 € marge ± 100 € » would read as an
      // offer to charge a hundred euros of interest on a loan agreed free of it, which is
      // exactly what INV-014 forbids the search from doing.
      wishSub: rateIsKnown
        ? "déduit du taux"
        : solved.interestFree
          ? "sans intérêt, sans marge"
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

  const moved = solved.principal !== solved.requestedPrincipal;

  el("balance-caption").textContent = solved.interestFree
    ? `Prêt sans intérêt : les ${solved.periods} échéances ne remboursent que le capital. ` +
      (moved
        ? `Seule la somme prêtée pouvait bouger, et elle l'a fait — ` +
          `${formatEuroRounded(solved.principal)} font ${solved.periods} × ` +
          `${formatEuroRounded(solved.payment)}, tout rond.`
        : "Le capital divisé par la durée tombait déjà juste.")
    : `${solved.periods} virements de ${formatEuroRounded(solved.payment)}, tous identiques, ` +
      `soldent le prêt au centime. Ce qui s'ajuste pour cela, c'est ` +
      (moved
        ? `la somme prêtée — ${formatEuroRounded(solved.principal)} au lieu de ` +
          `${formatEuroRounded(solved.requestedPrincipal)} — et le taux avec elle.`
        : "le taux, la somme prêtée étant tombée juste telle quelle.");
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
 *
 * « (2,8785 % retenus) » left the reader to guess what it had been retained for — and it
 * is worth saying, because that is the whole relation between the two figures: the one
 * above is how the rate reads at the table, this one is what actually unrolled the
 * schedule, and the schedule is what the parties sign.
 */
function retainedRate(value) {
  const shown = roundToRateStep(value);
  return Math.abs(shown - value) < 5e-7
    ? null
    : `(${formatPercent(value, 4)} retenus pour le calcul de l'échéancier)`;
}

/** A negotiating margin, restated under the figure it qualifies. */
const margin = (tolerance, format) => (tolerance > 0 ? `marge ± ${format(tolerance)}` : null);

/**
 * The negotiating margins, and what came of them.
 *
 * The schedule always falls exactly now (INV-015), so this note no longer reports a
 * failure: it reports a **concession**. Something had to give for `n` identical whole-euro
 * instalments to settle the debt, and when what gave went beyond what the lender agreed to,
 * that is worth a sentence of its own — the balance sheet shows the figures, only prose can
 * say which of them was moved without permission, and by how much.
 */
function renderToleranceNote(solved) {
  const note = el("tolerance-note");
  const exact = solved.roundPayment;

  if (!exact.applied) {
    note.hidden = true;
    return;
  }

  note.hidden = false;

  const overshoot = Math.abs(solved.principal - solved.requestedPrincipal);
  const lent = `${formatEuroRounded(solved.principal)} prêtés, ${solved.periods} × ` +
    `${formatEuroRounded(solved.payment)}`;

  if (exact.withinMargins) {
    note.classList.add("info");
    // An interest-free loan runs its own search and counts nothing: the amounts that
    // divide are what they are, and « la seule combinaison possible » would be a claim
    // this branch has not checked.
    const alternatives = solved.tolerances && solved.tolerances.alternatives;
    note.replaceChildren(
      strong("Trouvé dans vos marges."),
      text(
        !alternatives
          ? " Rien n'est sorti de ce que vous aviez accepté de bouger."
          : alternatives > 1
            ? ` ${alternatives} combinaisons convenaient ; le bilan retient la plus proche` +
              " de vos intentions."
            : " C'était la seule combinaison possible."
      )
    );
    return;
  }

  note.classList.remove("info");

  const reason = {
    somme:
      `La somme prêtée est sortie de votre marge de ${formatEuroRounded(overshoot)} — ` +
      `${lent}. Le taux, lui, est resté dans la sienne.`,
    objectif:
      `Aucune somme dans votre marge ne tenait le ${solved.rateIsKnown ? "taux" : "coût"} ` +
      `demandé : c'est donc lui qui a cédé — ${lent}.`,
    approché:
      `Ni la somme ni le ${solved.rateIsKnown ? "taux" : "coût"} n'ont pu rester dans ` +
      `leur marge ; voici la combinaison exacte la plus proche de vos intentions — ${lent}.`,
    repli:
      "Rien ne tombait juste en portant intérêt : le calcul ci-dessous est le prêt exact " +
      `le plus proche, et il ne coûte rien — ${lent}.`
  }[exact.stage];

  note.replaceChildren(
    strong("Vos marges n'ont pas suffi. "),
    text(reason),
    text(
      " L'échéancier tombe juste malgré tout : les mensualités sont toutes identiques et" +
      " la dernière solde le prêt au centime, ce qui n'est jamais négociable."
    )
  );
}

/**
 * Purchasing power: what the interest a lender is promised is worth by the time it arrives.
 *
 * A section of its own since the fourth round of feedback. Folded under the balance sheet
 * it read as a footnote to the contract, when it answers a different question: the balance
 * sheet says what will be signed, this says what it comes to. The nominal figures stay the
 * headline — they are what leaves the account, and what a standing order is set up for.
 *
 * Hidden at zero inflation, where the constant-euro reading coincides with the nominal one.
 * Taxation no longer rides with it: see renderTaxEffect.
 */
function renderInflationEffect(solved) {
  const section = el("inflation-effect");
  const active = state.constantEuros && Math.abs(solved.annualInflation) > 1e-9;

  section.hidden = !active;
  if (!active) return;

  const basis = formatMonth(solved.schedule[0].date);

  el("inflation-tag").textContent = `${formatPercent(solved.annualInflation, 2)} l'an`;
  el("inflation-lead").textContent =
    `Les montants du bilan sont nominaux : c'est ce qui quitte le compte, et ce que dit ` +
    `le contrat. Rapportés aux euros de ${basis} — ceux du jour où le prêt commence — une ` +
    `inflation de ${formatPercent(solved.annualInflation, 2)} l'an les allège d'autant, ` +
    "chaque échéance étant déflatée à sa propre date, jamais le total à la dernière. " +
    "Aucun prélèvement n'est déduit ici : la fiscalité fait l'objet de la section suivante.";

  el("constant-basis").textContent = `de ${basis}`;
  el("out-constant-cost").textContent = formatEuroRounded(solved.constantCost);
  el("out-constant-total").textContent = formatEuroRounded(solved.constantTotalPaid);
  el("out-real-rate").textContent = formatPercent(solved.realAnnualRate, 3);
}

/**
 * Taxation: what the state takes of the interest before the lender sees any of it.
 *
 * Its own section, and always shown — « Je veux que ce soit deux sections indépendantes et
 * voir les effets de la fiscalité même si pas d'inflation. » It used to live inside the
 * inflation block and vanish with it, which was wrong twice over: the prélèvement
 * forfaitaire unique has nothing to do with what prices do, and its two halves are not
 * both « impôt » — 12,8 % is income tax, 17,2 % is social contributions, and CSG is not a
 * tax. Every label here therefore says « prélèvements », and names both halves.
 *
 * The block that needs the two readings at once — net of tax *and* in constant euros —
 * follows the inflation switch, since without it it would only repeat the first.
 */
function renderTaxEffect(solved) {
  const section = el("tax-effect");
  const withInflation = state.constantEuros && Math.abs(solved.annualInflation) > 1e-9;

  section.hidden = false;
  el("tax-tag").textContent = `${formatPercent(FLAT_TAX_RATE, 0)} de prélèvements`;
  el("tax-lead").textContent =
    "Les intérêts du bilan sont bruts : c'est ce que l'emprunteur verse. Le prêteur, lui, " +
    `en garde ${formatPercent(1 - FLAT_TAX_RATE, 0)} une fois le prélèvement forfaitaire ` +
    `unique acquitté — ${formatPercent(FLAT_TAX_INCOME_RATE, 1)} d'impôt sur le revenu et ` +
    `${formatPercent(FLAT_TAX_SOCIAL_RATE, 1)} de prélèvements sociaux, qui ne sont pas un ` +
    "impôt. Rien n'est déflaté dans les deux figures ci-dessous : elles sont en euros " +
    "courants, la fiscalité ne dépendant pas de l'inflation.";

  el("out-net-cost").textContent = formatEuroRounded(afterFlatTax(solved.effectiveCost));
  el("out-net-rate").textContent = formatPercent(
    solved.annualNominalRate * (1 - FLAT_TAX_RATE),
    3
  );

  el("tax-and-inflation").hidden = !withInflation;
  if (!withInflation) return;

  el("net-constant-basis").textContent = `de ${formatMonth(solved.schedule[0].date)}`;
  el("out-net-constant-cost").textContent = formatEuroRounded(afterFlatTax(solved.constantCost));
  el("out-net-real-rate").textContent = formatPercent(
    realRate(solved.annualNominalRate * (1 - FLAT_TAX_RATE), solved.annualInflation),
    3
  );
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
    thead: el("thead"),
    tbody: el("tbody"),
    schedule: state.solved ? state.solved.schedule : [],
    view,
    constantEuros: state.constantEuros
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
  // Which application, and which build. The page is served with a ten-minute cache on
  // GitHub Pages, long enough to look at a stale script and draw the wrong conclusion from
  // it; and the same string goes on every document exported, so a figure questioned months
  // later leads back to what produced it.
  el("app-version").textContent = GENERATED_BY;

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

/**
 * Wiring: reads the form, solves the loan, renders the three views, drives the exports.
 * All the arithmetic lives in src/core; this file only moves values around.
 */

import { addMonths, solveLoan, toIsoDate } from "../core/finance.js";
import {
  formatEuro,
  formatEuroRounded,
  formatMonth,
  formatNumber,
  formatPercent,
  parseFrenchNumber
} from "../core/format.js";
import { exportCsv } from "../export/csv.js";
import { exportXlsx } from "../export/xlsx.js";
import { renderBalanceChart, renderInstalmentChart } from "./chart.js";
import { renderTable } from "./table.js";

const MAX_PERIODS = 1200;

const el = (id) => document.getElementById(id);

const state = { solved: null, view: "monthly" };

/* ------------------------------------------------------------------------ inputs */

function readInputs() {
  const principal = parseFrenchNumber(el("principal").value);
  const term = parseFrenchNumber(el("term").value);
  const periods = el("term-unit").value === "years" ? Math.round(term * 12) : Math.round(term);
  const rateIsKnown = el("known-rate").checked;
  const totalCost = parseFrenchNumber(el("cost").value);
  const annualRate = parseFrenchNumber(el("rate").value) / 100;
  const startDate = el("start").value
    ? new Date(`${el("start").value}T12:00:00`)
    : new Date();
  const roundPayment = el("round-payment").checked;
  const annualInflation = parseFrenchNumber(el("inflation").value) / 100;

  // The margin applies to whichever quantity is being aimed at, so it comes from the
  // field that is currently on screen.
  const principalTolerance = Math.abs(parseFrenchNumber(el("principal-tolerance").value)) || 0;
  const objectiveTolerance = rateIsKnown
    ? Math.abs(parseFrenchNumber(el("rate-tolerance").value) / 100) || 0
    : Math.abs(parseFrenchNumber(el("cost-tolerance").value)) || 0;

  return {
    principal,
    periods,
    rateIsKnown,
    totalCost,
    annualRate,
    startDate,
    roundPayment,
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
      "constant-euros",
      "tolerance-note"
    ]) {
      el(id).hidden = true;
    }
    renderTable({ tbody: el("tbody"), schedule: [], view: state.view });
    renderCharts([], 0, 0);
    return;
  }

  errorBox.hidden = true;

  state.solved = solveLoan({
    principal: inputs.principal,
    periods: inputs.periods,
    startDate: inputs.startDate,
    roundPayment: inputs.roundPayment,
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
    annualInflation
  });
}

/* ------------------------------------------------------------------------ readout */

function renderReadout() {
  const solved = state.solved;
  const { principal, periods, rate, payment, rateIsKnown } = solved;
  const round = solved.roundPayment;

  el("mode-tag").textContent = round.applied
    ? "mensualité ronde"
    : round.requested
      ? "euros ronds impossible"
      : rateIsKnown
        ? "coût déduit"
        : "taux résolu";

  renderRateWarning(solved);
  renderToleranceNote(solved);
  renderRoundNote(solved);
  renderConstantEuros(solved);

  // A round instalment is shown without its two zero cents: the point is that it is round.
  const showPayment = round.applied ? formatEuroRounded : formatEuro;
  el("out-payment").textContent = showPayment(payment);
  el("out-payment-sub").textContent = round.applied
    ? `${periods} × ${showPayment(payment)}, sans exception`
    : `${periods} × ${formatEuro(payment)} = ${formatEuroRounded(payment * periods)}`;

  el("out-rate").textContent = formatPercent(solved.annualNominalRate, 3);
  el("out-rate-sub").textContent = `mensuel ${formatPercent(rate, 5)}`;

  el("out-cost").textContent = formatEuroRounded(solved.effectiveCost);
  el("out-cost-sub").textContent = round.applied
    ? describeDrift(solved.costDrift, "mensualité ronde")
    : rateIsKnown
      ? `${formatNumber((solved.effectiveCost / principal) * 100, 1)} % du capital emprunté`
      : describeDrift(solved.costDrift, "arrondis au centime");

  el("convergence").replaceChildren(
    ...(round.applied
      ? [
          chip("Taux choisi pour que la mensualité ronde solde exactement"),
          chip("aucune échéance ajustée"),
          chip("solde final 0,00 €")
        ]
      : rateIsKnown
        ? [chip("Taux donné, coût déduit"), chip("arrondi au centime sur chaque échéance")]
        : [
            chip("Résolu par encadrement puis dichotomie"),
            chip(`${solved.iterations} itérations`),
            chip(`écart résiduel ${Math.abs(solved.residual).toExponential(1)} €`)
          ])
  );

  const warning = el("convergence-warning");
  warning.hidden = solved.converged;
}

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

  if (result.found) {
    note.classList.add("info");
    const movedPrincipal = solved.principal !== solved.requestedPrincipal;
    note.replaceChildren(
      text("Dans vos marges : "),
      strong(`${formatEuroRounded(solved.principal)} prêtés`),
      text(
        movedPrincipal
          ? ` (au lieu de ${formatEuroRounded(solved.requestedPrincipal)}), `
          : " comme demandé, "
      ),
      strong(`${solved.periods} × ${formatEuroRounded(solved.payment)}`),
      text(", taux "),
      strong(formatPercent(solved.annualNominalRate, 4)),
      text(`, coût ${formatEuroRounded(solved.effectiveCost)}. `),
      text(
        result.alternatives > 1
          ? `${result.alternatives} combinaisons convenaient ; voici la plus proche de vos intentions.`
          : "C'était la seule combinaison possible."
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
 * Purchasing power, shown underneath the nominal figures and never in place of them:
 * what leaves the account each month is the nominal instalment, and that is the number
 * someone setting up a standing order needs. Constant euros answer a different question.
 *
 * Hidden entirely at zero inflation, where the two readings coincide and the block would
 * only repeat the line above it.
 */
function renderConstantEuros(solved) {
  const block = el("constant-euros");
  const active = Math.abs(solved.annualInflation) > 1e-9;

  block.hidden = !active;
  if (!active) return;

  el("constant-basis").textContent = `de ${formatMonth(solved.schedule[0].date)}`;
  el("out-constant-cost").textContent = formatEuroRounded(solved.constantCost);
  el("out-constant-total").textContent = formatEuroRounded(solved.constantTotalPaid);
  el("out-real-rate").textContent = formatPercent(solved.realAnnualRate, 3);
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
 * Says what the round-instalment constraint cost, in plain words. Snapping the
 * instalment to the euro moves the rate and therefore the total cost, and that is
 * precisely the sort of thing this tool refuses to do silently.
 */
function renderRoundNote(solved) {
  const note = el("round-note");
  const round = solved.roundPayment;

  if (!round.requested) {
    note.hidden = true;
    return;
  }

  note.hidden = false;

  if (!round.applied) {
    note.classList.remove("info");
    note.textContent =
      "Aucune mensualité en euros ronds ne solde exactement ce prêt, même en s'écartant " +
      "de 24 €. La dernière échéance est donc ajustée, comme le ferait une banque.";
    return;
  }

  note.classList.add("info");
  note.replaceChildren(
    text("Mensualité arrondie de "),
    strong(formatEuro(round.idealPayment)),
    text(" à "),
    strong(formatEuroRounded(solved.payment)),
    text(`, et taux porté à ${formatPercent(solved.annualNominalRate, 4)} pour que les `),
    strong(`${solved.periods} échéances identiques`),
    text(" soldent le prêt au centime. "),
    text(
      round.offset === 0
        ? "L'arrondi tombait juste : le coût est celui que vous aviez demandé."
        : `Le coût passe de ${formatEuroRounded(solved.targetCost)} à ` +
          `${formatEuroRounded(solved.effectiveCost)}, soit ` +
          `${solved.costDrift > 0 ? "+" : ""}${formatEuroRounded(solved.costDrift)}.`
    )
  );
}

/**
 * Cumulative amounts are displayed to the euro, so a drift of a few cents describes a gap
 * the reader cannot even see on the figure above — it reads as noise, not as information.
 * Below half a euro the rounded figure is the one that was asked for, and the drift is
 * reported as conform; anything larger is still stated, never hidden.
 */
const describeDrift = (drift, cause) =>
  Math.abs(drift) < 0.5
    ? "conforme à l'hypothèse saisie"
    : `${drift > 0 ? "+" : ""}${formatEuroRounded(drift)} vs hypothèse (${cause})`;

const text = (value) => document.createTextNode(value);

function strong(value) {
  const node = document.createElement("b");
  node.textContent = value;
  return node;
}

function chip(value) {
  const node = document.createElement("span");
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
}

async function downloadXlsx() {
  const button = el("export-xlsx");
  const label = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "Génération…";
    await exportXlsx(state.solved, "echeancier-pret.xlsx");
  } catch (error) {
    const box = el("error");
    box.hidden = false;
    box.textContent = `L'export tableur a échoué : ${error.message}`;
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------------ startup */

function init() {
  const firstDueDate = addMonths(new Date(), 1);
  firstDueDate.setDate(5);
  el("start").value = toIsoDate(firstDueDate);

  const form = el("form");

  form.addEventListener("input", (event) => {
    if (event.target.name === "known") toggleMode();
    compute();
  });
  form.addEventListener("change", compute);
  form.addEventListener("submit", (event) => event.preventDefault());

  el("view-monthly").addEventListener("click", () => setView("monthly"));
  el("view-yearly").addEventListener("click", () => setView("yearly"));
  el("export-csv").addEventListener("click", () => exportCsv(state.solved));
  el("export-xlsx").addEventListener("click", downloadXlsx);

  toggleMode();
  compute();
}

function toggleMode() {
  const rateIsKnown = el("known-rate").checked;
  el("field-cost").hidden = rateIsKnown;
  el("field-rate").hidden = !rateIsKnown;
}

init();

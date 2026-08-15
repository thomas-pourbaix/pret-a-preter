/**
 * Wiring: reads the form, solves the loan, renders the three views, drives the exports.
 * All the arithmetic lives in src/core; this file only moves values around.
 */

import { addMonths, solveLoan, toIsoDate } from "../core/finance.js";
import {
  formatEuro,
  formatEuroRounded,
  formatNumber,
  formatPercent,
  parseFrenchNumber
} from "../core/format.js";
import { exportCsv } from "../export/csv.js";
import { exportXlsx } from "../export/xlsx.js";
import { renderChart } from "./chart.js";
import { renderTable } from "./table.js";

const MAX_PERIODS = 1200;

/**
 * The masthead states what the page is doing, so it has to follow the mode: in rate mode
 * it is the cost that is deduced, not the rate. Both variants share the same sentence
 * shape so switching does not reflow the layout.
 */
const MASTHEAD = {
  cost: {
    lead: "Trois hypothèses connues,",
    tail: "un taux ",
    accent: "résolu",
    statement:
      "Le capital, la durée et le coût total sont donnés. Le taux, lui, se déduit : " +
      "on l'extrait par dichotomie, puis on déroule chaque échéance ligne à ligne. " +
      "Rien n'est masqué, tout s'exporte."
  },
  rate: {
    lead: "Trois hypothèses connues,",
    tail: "un coût ",
    accent: "déduit",
    statement:
      "Le capital, la durée et le taux sont donnés. Le coût, lui, se déduit : " +
      "on en tire la mensualité, puis on déroule chaque échéance ligne à ligne. " +
      "Rien n'est masqué, tout s'exporte."
  }
};

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

  return { principal, periods, rateIsKnown, totalCost, annualRate, startDate };
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
    renderTable({ tbody: el("tbody"), schedule: [], view: state.view });
    renderChart({ svg: el("chart"), probe: el("probe"), schedule: [], principal: 0 });
    return;
  }

  errorBox.hidden = true;

  state.solved = solveLoan({
    principal: inputs.principal,
    periods: inputs.periods,
    startDate: inputs.startDate,
    ...(inputs.rateIsKnown
      ? { periodicRate: inputs.annualRate / 12 }
      : { totalCost: inputs.totalCost })
  });

  setExportsEnabled(true);
  renderReadout();
  renderTable({ tbody: el("tbody"), schedule: state.solved.schedule, view: state.view });
  renderChart({
    svg: el("chart"),
    probe: el("probe"),
    schedule: state.solved.schedule,
    principal: state.solved.principal
  });
}

/* ------------------------------------------------------------------------ readout */

function renderReadout() {
  const solved = state.solved;
  const { principal, periods, rate, payment, rateIsKnown } = solved;

  el("mode-tag").textContent = rateIsKnown ? "coût déduit" : "taux résolu";

  el("substituted").replaceChildren(
    strong(formatNumber(payment)),
    text(` = ${formatNumber(principal, 0)} × `),
    strong(formatNumber(rate, 7)),
    text(` ⁄ ( 1 − ${formatNumber(1 + rate, 7)} ^ −${periods} )`)
  );

  el("out-payment").textContent = formatEuro(payment);
  el("out-payment-sub").textContent =
    `${periods} × ${formatEuro(payment)} = ${formatEuroRounded(payment * periods)}`;

  el("out-rate").textContent = formatPercent(solved.annualNominalRate, 3);
  el("out-rate-sub").textContent =
    `mensuel ${formatPercent(rate, 5)} · équivalent ${formatPercent(solved.annualEquivalentRate, 3)}`;

  el("out-cost").textContent = formatEuro(solved.effectiveCost);
  el("out-cost-sub").textContent = rateIsKnown
    ? `${formatNumber((solved.effectiveCost / principal) * 100, 1)} % du capital emprunté`
    : describeDrift(solved.costDrift);

  el("convergence").replaceChildren(
    ...(rateIsKnown
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

const describeDrift = (drift) =>
  Math.abs(drift) < 0.005
    ? "conforme à l'hypothèse saisie"
    : `${drift > 0 ? "+" : ""}${formatNumber(drift)} € vs hypothèse (arrondis au centime)`;

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
  renderMasthead(rateIsKnown ? MASTHEAD.rate : MASTHEAD.cost);
}

function renderMasthead({ lead, tail, accent, statement }) {
  const emphasis = document.createElement("em");
  emphasis.textContent = accent;

  el("headline").replaceChildren(
    text(lead),
    document.createElement("br"),
    text(tail),
    emphasis,
    text(".")
  );

  el("statement").textContent = statement;
}

init();

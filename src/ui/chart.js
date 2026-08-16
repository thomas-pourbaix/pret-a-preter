/**
 * Two views of the same schedule, both drawn as staircases so that every instalment is
 * a visible step rather than a point on a smoothed curve:
 *
 *   renderInstalmentChart — one bar per instalment, split interest / capital amorti.
 *   renderBalanceChart    — outstanding capital falling, cumulative interest rising.
 *
 * Deliberately not a charting library: the two together come to about two hundred lines,
 * where the lightest chart library would outweigh the rest of the page, and every
 * coordinate here can be read and checked.
 */

import { formatEuro, formatEuroRounded, formatMonth } from "../core/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 960;
const HEIGHT = 260;
const PADDING = { top: 14, right: 84, bottom: 24, left: 14 };

const COLOUR_CAPITAL = "#1F6F78";
const COLOUR_INTEREST = "#6A4CA8";

const PROBE_IDLE = "Survolez le graphique, ou parcourez-le au clavier, pour lire une échéance.";

/* ------------------------------------------------------------------------ plumbing */

function painter(svg) {
  return (tag, attributes, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    if (text != null) node.textContent = text;
    svg.appendChild(node);
    return node;
  };
}

/** Four gridlines and the value axis down the right-hand side. */
function drawScale(add, maxValue) {
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  for (let step = 0; step <= 4; step++) {
    const y = PADDING.top + (step / 4) * plotHeight;
    add("line", { x1: PADDING.left, x2: WIDTH - PADDING.right, y1: y, y2: y, class: "gridline" });
    add(
      "text",
      { x: WIDTH - PADDING.right + 8, y: y + 3, class: "axis" },
      formatEuroRounded(maxValue * (1 - step / 4))
    );
  }
}

function drawDateAxis(add, schedule) {
  add("text", { x: PADDING.left, y: HEIGHT - 8, class: "axis" }, formatMonth(schedule[0].date));
  add(
    "text",
    { x: WIDTH - PADDING.right, y: HEIGHT - 8, class: "axis", "text-anchor": "end" },
    formatMonth(schedule[schedule.length - 1].date)
  );
}

/**
 * Pointer and keyboard reading, identical on both charts: the caller says how to move
 * the marker and what to write in the probe line.
 */
function attachReading({ svg, probe, schedule, slot, show, hide }) {
  let index = 0;

  const showAt = (next) => {
    index = Math.max(0, Math.min(schedule.length - 1, next));
    show(index, schedule[index]);
  };

  const clear = () => {
    hide();
    probe.textContent = PROBE_IDLE;
  };

  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    showAt(Math.floor((x - PADDING.left) / slot));
  });

  svg.addEventListener("pointerleave", clear);
  svg.addEventListener("blur", clear);

  // Readable without a pointer (§8).
  svg.addEventListener("keydown", (event) => {
    const jump = event.shiftKey ? 12 : 1;
    const moves = {
      ArrowRight: () => showAt(index + jump),
      ArrowLeft: () => showAt(index - jump),
      Home: () => showAt(0),
      End: () => showAt(schedule.length - 1)
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  });

  probe.textContent = PROBE_IDLE;
}

/* --------------------------------------------------------- chart 1: instalments */

/**
 * One bar per instalment, interest at the bottom and capital above, bars touching.
 *
 * Drawn as two staircase areas rather than as one rectangle per instalment: adjacent
 * rectangles of the same fill leave hairline seams where their anti-aliased edges meet,
 * and a 240-instalment loan turns those seams into a moiré. A single closed outline has
 * no interior edges to seam, and is one path node instead of 240.
 *
 * @param {object} params
 * @param {SVGElement} params.svg target element, cleared on each render
 * @param {HTMLElement} params.probe text line updated on hover and on keyboard focus
 * @param {Array<object>} params.schedule rows from buildSchedule()
 */
export function renderInstalmentChart({ svg, probe, schedule }) {
  svg.replaceChildren();
  if (!schedule.length) {
    probe.textContent = PROBE_IDLE;
    return;
  }

  const add = painter(svg);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = HEIGHT - PADDING.bottom;

  // The tallest instalment sets the scale: under the banking convention the adjusted
  // final one differs, and it must not overflow the plot.
  const maxInstalment = Math.max(...schedule.map((row) => row.instalment));
  const slot = plotWidth / schedule.length;

  const yAt = (value) => baseline - (value / maxInstalment) * plotHeight;
  const xAt = (index) => PADDING.left + index * slot;

  drawScale(add, maxInstalment);

  // Forward along the top staircase, back along the bottom one, then close.
  const stepArea = (top, bottom) => {
    const forward = [];
    const backward = [];

    schedule.forEach((row, index) => {
      const left = xAt(index).toFixed(2);
      const right = xAt(index + 1).toFixed(2);
      forward.push(`${index ? "L" : "M"}${left} ${yAt(top(row)).toFixed(2)}`, `L${right} ${yAt(top(row)).toFixed(2)}`);
      backward.unshift(`L${left} ${yAt(bottom(row)).toFixed(2)}`);
      backward.unshift(`L${right} ${yAt(bottom(row)).toFixed(2)}`);
    });

    return [...forward, ...backward, "Z"].join("");
  };

  add("path", { d: stepArea((row) => row.interest, () => 0), fill: COLOUR_INTEREST });
  add("path", {
    d: stepArea((row) => row.interest + row.capital, (row) => row.interest),
    fill: COLOUR_CAPITAL
  });

  drawDateAxis(add, schedule);

  const marker = add("rect", {
    x: 0,
    y: PADDING.top,
    width: Math.max(slot, 2),
    height: plotHeight,
    fill: "#17262B",
    opacity: 0
  });

  attachReading({
    svg,
    probe,
    schedule,
    slot,
    hide: () => marker.setAttribute("opacity", "0"),
    show: (index, row) => {
      marker.setAttribute("x", xAt(index));
      marker.setAttribute("opacity", "0.14");

      const share = (row.interest / row.instalment) * 100;
      probe.textContent =
        `Échéance ${row.number} (${formatMonth(row.date)}) · ` +
        `mensualité ${formatEuro(row.instalment)} = ` +
        `intérêts ${formatEuro(row.interest)} (${share.toFixed(0)} %) + ` +
        `capital ${formatEuro(row.capital)}`;
    }
  });
}

/* ------------------------------------------------------------- chart 2: balances */

/**
 * Outstanding capital falling against cumulative interest rising, both as staircases:
 * the level holds for the whole month and drops, or climbs, on the instalment date.
 * A smoothed line would suggest the balance changes continuously, which it does not.
 *
 * @param {object} params
 * @param {SVGElement} params.svg target element, cleared on each render
 * @param {HTMLElement} params.probe text line updated on hover and on keyboard focus
 * @param {Array<object>} params.schedule rows from buildSchedule()
 * @param {number} params.principal borrowed amount, the starting level of the staircase
 * @param {number} [params.annualInflation] rate the constant-euro pair is deflated at
 * @param {boolean} [params.constantEuros] whether that pair is drawn at all
 */
export function renderBalanceChart({
  svg,
  probe,
  schedule,
  principal,
  annualInflation = 0,
  constantEuros = true
}) {
  svg.replaceChildren();
  if (!schedule.length) {
    probe.textContent = PROBE_IDLE;
    return;
  }

  const add = painter(svg);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = HEIGHT - PADDING.bottom;

  const lastRow = schedule[schedule.length - 1];
  const showConstant = constantEuros && Math.abs(annualInflation) > 1e-9;

  // Deflation pushes the constant-euro curves *above* the nominal ones, so the scale has
  // to consider them too rather than assume they always sit underneath.
  const maxValue =
    Math.max(
      principal,
      lastRow.cumulativeInterest,
      ...(showConstant ? [lastRow.constantCumulativeInterest] : []),
      ...(showConstant ? schedule.map((row) => row.constantBalance) : [])
    ) || 1;
  const slot = plotWidth / schedule.length;

  const yAt = (value) => baseline - (value / maxValue) * plotHeight;
  const xAt = (index) => PADDING.left + index * slot;

  drawScale(add, maxValue);

  // The level holds across the month, then steps on the payment: horizontal, vertical,
  // horizontal. `start` is the level before the first instalment.
  const staircase = (start, valueOf) => {
    const parts = [`M${xAt(0).toFixed(2)} ${yAt(start).toFixed(2)}`];
    let level = start;

    schedule.forEach((row, index) => {
      const right = xAt(index + 1).toFixed(2);
      parts.push(`L${right} ${yAt(level).toFixed(2)}`);
      level = valueOf(row);
      parts.push(`L${right} ${yAt(level).toFixed(2)}`);
    });

    return parts.join("");
  };

  const line = (d, colour, dashed) =>
    add("path", {
      d,
      fill: "none",
      stroke: colour,
      "stroke-width": dashed ? 1.5 : 2,
      "stroke-linejoin": "miter",
      "vector-effect": "non-scaling-stroke",
      ...(dashed ? { "stroke-dasharray": "5 4", opacity: 0.75 } : {})
    });

  line(staircase(principal, (row) => row.balance), COLOUR_CAPITAL);
  line(staircase(0, (row) => row.cumulativeInterest), COLOUR_INTEREST);

  // Same two quantities restated in euros of the start date: dashed, thinner and slightly
  // faded, so they read as a commentary on the solid pair rather than as rivals to it.
  if (showConstant) {
    line(staircase(principal, (row) => row.constantBalance), COLOUR_CAPITAL, true);
    line(staircase(0, (row) => row.constantCumulativeInterest), COLOUR_INTEREST, true);
  }

  drawDateAxis(add, schedule);

  const cursor = add("line", {
    x1: 0,
    x2: 0,
    y1: PADDING.top,
    y2: baseline,
    stroke: "#93A6AB",
    "stroke-width": 1,
    "stroke-dasharray": "3 3",
    opacity: 0
  });

  attachReading({
    svg,
    probe,
    schedule,
    slot,
    hide: () => cursor.setAttribute("opacity", "0"),
    show: (index, row) => {
      const x = xAt(index + 1);
      cursor.setAttribute("x1", x);
      cursor.setAttribute("x2", x);
      cursor.setAttribute("opacity", "1");

      probe.textContent =
        `Échéance ${row.number} (${formatMonth(row.date)}) · ` +
        `reste dû ${formatEuro(row.balance)} · ` +
        `intérêts cumulés ${formatEuro(row.cumulativeInterest)} · ` +
        `capital remboursé ${formatEuro(row.cumulativeCapital)}` +
        (showConstant
          ? ` — en euros constants : reste dû ${formatEuro(row.constantBalance)}, ` +
            `intérêts ${formatEuro(row.constantCumulativeInterest)}`
          : "");
    }
  });
}

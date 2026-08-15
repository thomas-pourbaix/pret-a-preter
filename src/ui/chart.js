/**
 * Outstanding balance against cumulative interest, drawn by hand in SVG.
 *
 * Deliberately not a charting library: two polylines, four gridlines and a probe come to
 * about a hundred lines, where the lightest chart library would outweigh the rest of the
 * page. It also keeps the drawing auditable, which is the whole point of this tool.
 */

import { formatEuro, formatEuroRounded, formatMonth } from "../core/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 960;
const HEIGHT = 260;
const PADDING = { top: 14, right: 84, bottom: 24, left: 14 };

const COLOUR_BALANCE = "#1F6F78";
const COLOUR_INTEREST = "#6A4CA8";

const PROBE_IDLE = "Survolez la courbe, ou parcourez-la au clavier, pour lire une échéance.";

/**
 * @param {object} params
 * @param {SVGElement} params.svg target element, cleared on each render
 * @param {HTMLElement} params.probe text line updated on hover and on keyboard focus
 * @param {Array<object>} params.schedule rows from buildSchedule()
 * @param {number} params.principal borrowed amount, sets the vertical scale
 */
export function renderChart({ svg, probe, schedule, principal }) {
  svg.replaceChildren();

  if (!schedule.length) {
    probe.textContent = PROBE_IDLE;
    return;
  }

  const lastRow = schedule[schedule.length - 1];
  const maxValue = Math.max(principal, lastRow.cumulativeInterest) || 1;

  const xAt = (index) =>
    PADDING.left +
    (index / (schedule.length - 1 || 1)) * (WIDTH - PADDING.left - PADDING.right);
  const yAt = (value) =>
    HEIGHT - PADDING.bottom - (value / maxValue) * (HEIGHT - PADDING.top - PADDING.bottom);

  const add = (tag, attributes, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    if (text != null) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  for (let step = 0; step <= 4; step++) {
    const y = PADDING.top + (step / 4) * (HEIGHT - PADDING.top - PADDING.bottom);
    add("line", { x1: PADDING.left, x2: WIDTH - PADDING.right, y1: y, y2: y, class: "gridline" });
    add(
      "text",
      { x: WIDTH - PADDING.right + 8, y: y + 3, class: "axis" },
      formatEuroRounded(maxValue * (1 - step / 4))
    );
  }

  const drawLine = (pick, colour) => {
    const d = schedule
      .map((row, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(pick(row)).toFixed(1)}`)
      .join(" ");
    add("path", {
      d,
      fill: "none",
      stroke: colour,
      "stroke-width": 2,
      "vector-effect": "non-scaling-stroke"
    });
  };

  drawLine((row) => row.balance, COLOUR_BALANCE);
  drawLine((row) => row.cumulativeInterest, COLOUR_INTEREST);

  add("text", { x: PADDING.left, y: HEIGHT - 8, class: "axis" }, formatMonth(schedule[0].date));
  add(
    "text",
    { x: WIDTH - PADDING.right, y: HEIGHT - 8, class: "axis", "text-anchor": "end" },
    formatMonth(lastRow.date)
  );

  const cursor = add("line", {
    x1: 0,
    x2: 0,
    y1: PADDING.top,
    y2: HEIGHT - PADDING.bottom,
    stroke: "#93A6AB",
    "stroke-width": 1,
    "stroke-dasharray": "3 3",
    opacity: 0
  });

  let index = 0;

  const showAt = (next) => {
    index = Math.max(0, Math.min(schedule.length - 1, next));
    const row = schedule[index];
    cursor.setAttribute("opacity", "1");
    cursor.setAttribute("x1", xAt(index));
    cursor.setAttribute("x2", xAt(index));
    probe.textContent =
      `Échéance ${row.number} (${formatMonth(row.date)}) · ` +
      `intérêts ${formatEuro(row.interest)} · ` +
      `capital ${formatEuro(row.capital)} · ` +
      `reste dû ${formatEuro(row.balance)}`;
  };

  const hide = () => {
    cursor.setAttribute("opacity", "0");
    probe.textContent = PROBE_IDLE;
  };

  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const ratio = (x - PADDING.left) / (WIDTH - PADDING.left - PADDING.right);
    showAt(Math.round(ratio * (schedule.length - 1)));
  });

  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);

  // The curve is reachable and readable without a pointer (§8).
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

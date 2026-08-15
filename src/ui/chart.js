/**
 * One bar per instalment, split into what goes to interest and what actually repays the
 * loan. The bar height is the instalment itself, so a constant-instalment loan draws a
 * flat top — and the round-euro mode draws a perfectly flat one, which is the whole
 * point of that mode made visible.
 *
 * Deliberately not a charting library: bars, four gridlines and a probe come to about a
 * hundred and fifty lines, where the lightest chart library would outweigh the rest of
 * the page. Each series is drawn as a single path made of rectangle subpaths rather than
 * one node per bar, so a 1200-instalment loan stays two DOM nodes instead of 2400.
 */

import { formatEuro, formatEuroRounded, formatMonth } from "../core/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 960;
const HEIGHT = 260;
const PADDING = { top: 14, right: 84, bottom: 24, left: 14 };

const COLOUR_CAPITAL = "#1F6F78";
const COLOUR_INTEREST = "#6A4CA8";

const PROBE_IDLE = "Survolez un bâton, ou parcourez-les au clavier, pour lire une échéance.";

/**
 * @param {object} params
 * @param {SVGElement} params.svg target element, cleared on each render
 * @param {HTMLElement} params.probe text line updated on hover and on keyboard focus
 * @param {Array<object>} params.schedule rows from buildSchedule()
 */
export function renderChart({ svg, probe, schedule }) {
  svg.replaceChildren();

  if (!schedule.length) {
    probe.textContent = PROBE_IDLE;
    return;
  }

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = HEIGHT - PADDING.bottom;

  // The tallest instalment sets the scale: in the banking convention the adjusted last
  // one can differ, and it should not overflow the plot.
  const maxInstalment = Math.max(...schedule.map((row) => row.instalment));
  // The bars keep their gap even when they get thin, so that a long loan still reads as
  // one bar per instalment rather than as an area. Sub-pixel gaps would turn into a
  // moiré under anti-aliasing, hence the crispEdges below, which snaps every bar to the
  // pixel grid. Under about two pixels a slot there is no room left for a gap at all.
  const slot = plotWidth / schedule.length;
  const gap = slot < 2 ? 0 : Math.min(slot * 0.18, 6);
  const barWidth = slot - gap;

  const yAt = (value) => baseline - (value / maxInstalment) * plotHeight;
  const xAt = (index) => PADDING.left + index * slot + (slot - barWidth) / 2;

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
    const y = PADDING.top + (step / 4) * plotHeight;
    add("line", { x1: PADDING.left, x2: WIDTH - PADDING.right, y1: y, y2: y, class: "gridline" });
    add(
      "text",
      { x: WIDTH - PADDING.right + 8, y: y + 3, class: "axis" },
      formatEuroRounded(maxInstalment * (1 - step / 4))
    );
  }

  // Each series is one path: "move to the corner, across, down, back, close" per bar.
  const barsPath = (top, bottom) =>
    schedule
      .map((row, index) => {
        const x = xAt(index);
        const yTop = yAt(top(row));
        const height = Math.max(0.4, yAt(bottom(row)) - yTop);
        return `M${x.toFixed(2)} ${yTop.toFixed(2)}h${barWidth.toFixed(2)}v${height.toFixed(2)}h${(-barWidth).toFixed(2)}z`;
      })
      .join("");

  add("path", {
    d: barsPath((row) => row.interest, () => 0),
    fill: COLOUR_INTEREST,
    "shape-rendering": "crispEdges"
  });
  add("path", {
    d: barsPath((row) => row.interest + row.capital, (row) => row.interest),
    fill: COLOUR_CAPITAL,
    "shape-rendering": "crispEdges"
  });

  add("text", { x: PADDING.left, y: HEIGHT - 8, class: "axis" }, formatMonth(schedule[0].date));
  add(
    "text",
    {
      x: WIDTH - PADDING.right,
      y: HEIGHT - 8,
      class: "axis",
      "text-anchor": "end"
    },
    formatMonth(schedule[schedule.length - 1].date)
  );

  const highlight = add("rect", {
    x: 0,
    y: PADDING.top,
    width: Math.max(barWidth, 2),
    height: plotHeight,
    fill: "#17262B",
    opacity: 0
  });

  let index = 0;

  const showAt = (next) => {
    index = Math.max(0, Math.min(schedule.length - 1, next));
    const row = schedule[index];

    highlight.setAttribute("x", xAt(index) - (Math.max(barWidth, 2) - barWidth) / 2);
    highlight.setAttribute("opacity", "0.09");

    const interestShare = (row.interest / row.instalment) * 100;
    probe.textContent =
      `Échéance ${row.number} (${formatMonth(row.date)}) · ` +
      `mensualité ${formatEuro(row.instalment)} = ` +
      `intérêts ${formatEuro(row.interest)} (${interestShare.toFixed(0)} %) + ` +
      `capital ${formatEuro(row.capital)} · ` +
      `reste dû ${formatEuro(row.balance)}`;
  };

  const hide = () => {
    highlight.setAttribute("opacity", "0");
    probe.textContent = PROBE_IDLE;
  };

  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    showAt(Math.floor((x - PADDING.left) / slot));
  });

  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);

  // The bars are reachable and readable without a pointer (§8).
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

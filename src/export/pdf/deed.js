/**
 * The debt acknowledgement, with the repayment schedule annexed — a PDF meant to be
 * printed, filled in by hand and signed.
 *
 * Two kinds of content share the page, and the whole layout follows from telling them
 * apart:
 *
 *   - **What the tool computed** is printed: the amount, the term, the instalment, the
 *     rate, the cost. These are the terms of the contract, they come from the balance
 *     sheet on screen, and no one should be copying them out by hand.
 *   - **What only the two people know** is left blank, on ruled lines with room for real
 *     handwriting — names, dates of birth, addresses, the bank account, the handwritten
 *     mention and the signatures.
 *
 * The structure follows the model published by the Institut national de la consommation
 * (inc-conso.fr, « Prêt d'argent à un proche : comment établir une reconnaissance de
 * dettes ») : identities, sum, date and means of payment, interest, repayment terms,
 * account, handwritten mention and signature. What this deed adds is the schedule, since
 * that is what the tool exists to compute.
 *
 * Nothing here decides anything legal: it lays out on paper what the two parties agreed
 * on screen, and says so on the document itself.
 */

import {
  formatDate,
  formatEuro,
  formatEuroRounded,
  formatLongMonth,
  formatNumber,
  formatSteppedPercent
} from "../../core/format.js";
import { spellEuros } from "../../core/words.js";
import { APP_NAME, APP_TAGLINE, VERSION } from "../../core/version.js";
import { scheduleGroups } from "../../core/schedule-columns.js";
import { A4, createDocument } from "./document.js";

/* -------------------------------------------------------------------------- palette */

/* The page's own ink, on paper: petrol for text, violet for the one accent, greys for
   everything the reader does not have to read. */
const INK = [0.09, 0.149, 0.169];
const SOFT = [0.373, 0.459, 0.486];
const FAINT = [0.576, 0.651, 0.671];
const ACCENT = [0.416, 0.298, 0.659];
const HAIRLINE = [0.796, 0.843, 0.835];
/** Fill-in rules are darker than a hairline: they are an instruction, not a decoration. */
const FILL_RULE = [0.639, 0.71, 0.702];
const TINT = [0.957, 0.969, 0.965];

/* ------------------------------------------------------------------------- geometry */

const MARGIN = { top: 50, right: 54, bottom: 56, left: 54 };
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right;
const RIGHT = MARGIN.left + CONTENT_WIDTH;
const PAGE_BOTTOM = A4.height - MARGIN.bottom;

/** A fill-in field: label, then this much clear height, then the rule to write on. */
const WRITING_HEIGHT = 25;
/** Distance between two rules of the same field — a second address line, say. */
const WRITING_LEAD = 26;
const LABEL_SIZE = 7;
const BODY_SIZE = 9.6;
const BODY_LEAD = 13.4;

/* --------------------------------------------------------------------------- values */

/** Whole euros print without cents; anything else keeps them, because it is contractual. */
const euros = (value) =>
  Number.isInteger(Math.round(value * 100) / 100) ? formatEuroRounded(value) : formatEuro(value);

/**
 * The same amount with the currency spelled out — « 10 000 euros ».
 *
 * Not a stylistic preference: macOS draws the euro sign of a non-embedded Helvetica far
 * wider than the advance the font declares, so anything printed after it on the same line
 * is partly covered by the glyph — « 1 520 €, » loses its comma. Declaring the widths in
 * the file, which this writer does, changes nothing, the glyph itself being the problem.
 * The symbol is therefore used only where it ends a run — figures in the table, the boxed
 * amount — and prose spells the word out, which is how a deed reads anyway.
 */
const eurosInWords = (value) =>
  `${formatNumber(value, Number.isInteger(Math.round(value * 100) / 100) ? 0 : 2)} euros`;

/**
 * Everything the deed says about the loan, read once from the solver result so the
 * layout below never has to reach into it twice.
 */
function terms(solved) {
  const schedule = solved.schedule;
  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  return {
    principal: solved.principal,
    periods: solved.periods,
    payment: solved.payment,
    rate: solved.annualNominalRate,
    cost: solved.effectiveCost,
    total: solved.principal + solved.effectiveCost,
    firstDate: first.date,
    lastDate: last.date,
    dayOfMonth: first.date.getDate(),
    schedule
  };
}

/* ------------------------------------------------------------------------- the flow */

/**
 * A cursor down the page, with the page breaks it implies.
 *
 * Every block asks for the room it needs before drawing anything (`needs`), which is
 * what keeps a section title from being orphaned at the foot of a page and a signature
 * box from being cut in half.
 */
function createFlow(doc) {
  let y = MARGIN.top;

  const flow = {
    get y() {
      return y;
    },
    set y(value) {
      y = value;
    },
    down(height) {
      y += height;
    },
    page() {
      doc.addPage();
      y = MARGIN.top;
    },
    needs(height) {
      if (y + height > PAGE_BOTTOM) flow.page();
    }
  };

  flow.page();
  return flow;
}

/* ------------------------------------------------------------------------ primitives */

/** A run of body text, wrapped to the content width. */
function prose(doc, flow, value, { size = BODY_SIZE, color = INK, font = "regular", x = MARGIN.left, width = CONTENT_WIDTH, after = 6 } = {}) {
  const lines = doc.wrap(value, { font, size, width });
  flow.needs(lines.length * BODY_LEAD + after);

  const height = doc.paragraph(value, {
    x,
    y: flow.y + size,
    width,
    font,
    size,
    color,
    leading: BODY_LEAD
  });

  flow.down(height + after);
}

/** A numbered section heading, with the rule that separates it from what came before. */
function section(doc, flow, number, label) {
  // A heading needs its first field with it, or it lands alone at the foot of a page.
  flow.needs(96);
  flow.down(6);
  doc.line(MARGIN.left, flow.y, RIGHT, flow.y, { color: HAIRLINE, width: 0.8 });
  flow.down(15);

  doc.text(`${number}`, { x: MARGIN.left, y: flow.y, font: "bold", size: 10, color: ACCENT });
  doc.text(label.toUpperCase(), {
    x: MARGIN.left + 16,
    y: flow.y,
    font: "bold",
    size: 10,
    color: INK,
    charSpacing: 0.7
  });

  flow.down(14);
}

/**
 * One fill-in field: a small label, clear air, and a rule long enough to write on.
 *
 * The rule is drawn at the full width given, and the writing space above it is what the
 * whole document is arranged around — a deed that has to be filled in with a pen is
 * useless if the pen has nowhere to go.
 */
function field(doc, flow, { x = MARGIN.left, width = CONTENT_WIDTH, label, lines = 1, y = null }) {
  const height = LABEL_SIZE + WRITING_HEIGHT + (lines - 1) * WRITING_LEAD + 10;

  // A field given its own `y` belongs to a row that has already claimed the room and
  // fixed the top of every field in it; one without asks for the room itself.
  if (y === null) flow.needs(height);
  const top = y === null ? flow.y : y;

  doc.text(label.toUpperCase(), {
    x,
    y: top + LABEL_SIZE,
    font: "regular",
    size: LABEL_SIZE,
    color: FAINT,
    charSpacing: 0.6
  });

  for (let index = 0; index < lines; index++) {
    const ruleY = top + LABEL_SIZE + WRITING_HEIGHT + index * WRITING_LEAD;
    doc.line(x, ruleY, x + width, ruleY, { color: FILL_RULE, width: 0.7 });
  }

  if (y === null) flow.down(height);
  return top + height;
}

/** Two or three fields side by side, sharing the content width. */
function fieldRow(doc, flow, fields) {
  const gap = 18;
  const flexible = fields.filter((entry) => !entry.width);
  const fixed = fields.reduce((sum, entry) => sum + (entry.width || 0), 0);
  const share = (CONTENT_WIDTH - fixed - gap * (fields.length - 1)) / (flexible.length || 1);

  const tallest = Math.max(...fields.map((entry) => entry.lines || 1));
  flow.needs(LABEL_SIZE + WRITING_HEIGHT + (tallest - 1) * WRITING_LEAD + 10);

  const top = flow.y;
  let x = MARGIN.left;

  for (const entry of fields) {
    const width = entry.width || share;
    field(doc, flow, { ...entry, x, width, y: top });
    x += width + gap;
  }

  flow.y = top + LABEL_SIZE + WRITING_HEIGHT + (tallest - 1) * WRITING_LEAD + 10;
}

/** A tick box and its label, for the things that are chosen rather than written. */
function checkbox(doc, x, y, label) {
  const box = 9;
  doc.rect(x, y - box + 1, box, box, { stroke: FILL_RULE, width: 0.7 });
  doc.text(label, { x: x + box + 6, y, size: 8.6, color: INK });
  return box + 6 + doc.measure(label, { size: 8.6 }) + 18;
}

/**
 * The contractual terms, printed: label on the left, figure on the right, one rule
 * between rows. This is the balance sheet's "contractualisé" column, on paper.
 */
function termsTable(doc, flow, rows) {
  const rowHeight = 19;
  const labelWidth = 190;

  flow.needs(rows.length * rowHeight + 8);
  doc.rect(MARGIN.left, flow.y, CONTENT_WIDTH, rows.length * rowHeight, { fill: TINT });

  rows.forEach(([label, value, note], index) => {
    const top = flow.y + index * rowHeight;

    if (index) {
      doc.line(MARGIN.left + 10, top, RIGHT - 10, top, { color: HAIRLINE, width: 0.5 });
    }

    doc.text(label, { x: MARGIN.left + 10, y: top + 13, size: 8.8, color: SOFT });
    doc.text(value, {
      x: MARGIN.left + labelWidth,
      y: top + 13,
      font: "bold",
      size: 9.6,
      color: INK
    });

    if (note) {
      doc.text(note, {
        x: MARGIN.left + labelWidth + doc.measure(value, { font: "bold", size: 9.6 }) + 8,
        y: top + 13,
        size: 8.2,
        color: FAINT
      });
    }
  });

  flow.down(rows.length * rowHeight + 12);
}

/* ---------------------------------------------------------------------- the sections */

function header(doc, flow, loan) {
  doc.text("PRÊT ENTRE PARTICULIERS", {
    x: MARGIN.left,
    y: flow.y + 8,
    size: 7.6,
    color: FAINT,
    charSpacing: 1.6
  });
  doc.text(`${loan.periods} mensualités · ${euros(loan.principal)}`, {
    x: MARGIN.left,
    y: flow.y + 8,
    width: CONTENT_WIDTH,
    align: "right",
    size: 7.6,
    color: FAINT,
    charSpacing: 1.2
  });
  flow.down(30);

  doc.text("Reconnaissance de dette", {
    x: MARGIN.left,
    y: flow.y,
    font: "bold",
    size: 21,
    color: INK
  });
  flow.down(14);

  doc.text("Acte sous signature privée — article 1376 du code civil", {
    x: MARGIN.left,
    y: flow.y,
    size: 9.4,
    color: SOFT
  });
  flow.down(12);

  doc.line(MARGIN.left, flow.y, RIGHT, flow.y, { color: INK, width: 1.1 });
  flow.down(16);
}

/** How to use the sheet, said once, at the top, where it is still worth reading. */
function instructions(doc, flow) {
  const text =
    "Les montants de ce document sont ceux du prêt calculé : ils sont déjà imprimés et " +
    "n'ont pas à être recopiés. Tout ce qui suit une ligne à remplir est laissé libre, à " +
    "compléter à la main. La somme en toutes lettres, la mention finale et la signature " +
    "doivent être écrites par l'emprunteur lui-même : c'est ce qui donne à l'acte sa " +
    "valeur de preuve.";

  const lines = doc.wrap(text, { size: 8.8, width: CONTENT_WIDTH - 24 });
  const height = lines.length * 12.4 + 18;

  flow.needs(height + 10);
  doc.rect(MARGIN.left, flow.y, CONTENT_WIDTH, height, { fill: TINT });
  doc.rect(MARGIN.left, flow.y, 2.4, height, { fill: ACCENT });

  doc.paragraph(text, {
    x: MARGIN.left + 14,
    y: flow.y + 18,
    width: CONTENT_WIDTH - 24,
    size: 8.8,
    leading: 12.4,
    color: SOFT
  });

  flow.down(height + 14);
}

/** Identity block, used twice: the borrower first, the lender second. */
function party(doc, flow, number, title, role) {
  section(doc, flow, number, title);
  prose(doc, flow, role, { size: 8.8, color: SOFT, after: 10 });

  field(doc, flow, { label: "Nom et prénoms" });
  fieldRow(doc, flow, [
    { label: "Né(e) le", width: 150 },
    { label: "à" }
  ]);
  field(doc, flow, { label: "Demeurant à", lines: 2 });
  fieldRow(doc, flow, [
    { label: "Téléphone", width: 190 },
    { label: "Courriel" }
  ]);
}

function sum(doc, flow, loan) {
  section(doc, flow, "3", "La somme prêtée");

  prose(
    doc,
    flow,
    "Je soussigné(e), l'emprunteur désigné au paragraphe 1, reconnais avoir reçu du " +
      "prêteur désigné au paragraphe 2, à titre de prêt, la somme de :",
    { after: 10 }
  );

  const boxHeight = 52;
  flow.needs(boxHeight + 14);
  doc.rect(MARGIN.left, flow.y, CONTENT_WIDTH, boxHeight, { fill: TINT, stroke: HAIRLINE });

  doc.text("EN CHIFFRES", {
    x: MARGIN.left + 14,
    y: flow.y + 16,
    size: 7,
    color: FAINT,
    charSpacing: 0.8
  });
  doc.text(euros(loan.principal), {
    x: MARGIN.left + 14,
    y: flow.y + 41,
    font: "bold",
    size: 20,
    color: INK
  });

  doc.text("EN TOUTES LETTRES", {
    x: MARGIN.left + 190,
    y: flow.y + 16,
    size: 7,
    color: FAINT,
    charSpacing: 0.8
  });
  doc.paragraph(spellEuros(loan.principal), {
    x: MARGIN.left + 190,
    y: flow.y + 34,
    width: CONTENT_WIDTH - 204,
    font: "italic",
    size: 11,
    leading: 13,
    color: INK
  });

  flow.down(boxHeight + 16);

  fieldRow(doc, flow, [
    { label: "Date de la remise des fonds", width: 190 },
    { label: "Lieu de la remise" }
  ]);

  flow.needs(46);
  doc.text("MODE DE VERSEMENT", {
    x: MARGIN.left,
    y: flow.y + LABEL_SIZE,
    size: LABEL_SIZE,
    color: FAINT,
    charSpacing: 0.6
  });
  flow.down(20);

  let x = MARGIN.left;
  for (const label of ["espèces", "chèque", "virement"]) {
    x += checkbox(doc, x, flow.y, label);
  }
  flow.down(12);

  field(doc, flow, {
    label: "Référence : numéro du chèque, date du virement, banque émettrice"
  });
}

function repayment(doc, flow, loan) {
  section(doc, flow, "4", "Les conditions de remboursement");

  prose(
    doc,
    flow,
    "L'emprunteur s'engage à rembourser cette somme au prêteur selon les conditions " +
      "suivantes, arrêtées d'un commun accord :",
    { after: 10 }
  );

  termsTable(doc, flow, [
    ["Somme prêtée", euros(loan.principal)],
    [
      "Durée du prêt",
      `${loan.periods} mensualités`,
      `de ${formatLongMonth(loan.firstDate)} à ${formatLongMonth(loan.lastDate)}`
    ],
    ["Mensualité", euros(loan.payment), "identique de la première à la dernière échéance"],
    // Read on the grid a rate is negotiated on, and said to be indicative: it is not what
    // the parties owe each other. What they owe is the schedule annexed below, instalment
    // by instalment, and the rate is the parameter that produced it.
    [
      "Taux annuel nominal",
      formatSteppedPercent(loan.rate),
      "valeur indicative : l'échéancier annexé fait foi"
    ],
    ["Coût total des intérêts", euros(loan.cost), "sur toute la durée du prêt"],
    ["Total remboursé", euros(loan.total), "capital et intérêts"],
    ["Première échéance", formatDate(loan.firstDate)],
    ["Dernière échéance", formatDate(loan.lastDate)]
  ]);

  const dayRule =
    loan.dayOfMonth > 28
      ? ` — ou le dernier jour du mois lorsque celui-ci est plus court`
      : "";

  prose(
    doc,
    flow,
    `Chaque mensualité est payable le ${loan.dayOfMonth} de chaque mois${dayRule}. ` +
      `L'échéancier complet des ${loan.periods} mensualités est annexé au présent acte, ` +
      "dont il fait partie intégrante ; il détaille pour chaque échéance la part " +
      "d'intérêts, la part de capital amorti et le capital restant dû.",
    { after: 12 }
  );

  field(doc, flow, { label: "IBAN du compte du prêteur, sur lequel les mensualités sont versées" });
  fieldRow(doc, flow, [
    { label: "Titulaire du compte" },
    { label: "BIC", width: 150 }
  ]);
}

function interest(doc, flow, loan) {
  section(doc, flow, "5", "Les intérêts");

  if (loan.cost <= 0) {
    prose(
      doc,
      flow,
      "Le prêt est consenti sans intérêt : l'emprunteur ne rembourse que le capital reçu.",
      { after: 4 }
    );
    return;
  }

  prose(
    doc,
    flow,
    `Le prêt porte intérêt au taux annuel nominal de ${formatSteppedPercent(loan.rate)}, ` +
      "appliqué chaque mois au capital restant dû à raison d'un douzième. Ce taux est une " +
      "valeur indicative : ce qui fait foi entre les parties est l'échéancier annexé, " +
      "échéance par échéance. Les intérêts sont compris dans les mensualités ci-dessus et " +
      `n'ont pas à être versés séparément ; leur montant total s'élève à ` +
      `${eurosInWords(loan.cost)} sur toute la durée du prêt.`,
    { after: 8 }
  );

  prose(
    doc,
    flow,
    "Les intérêts perçus constituent un revenu imposable pour le prêteur, qu'il lui " +
      "appartient de déclarer.",
    { size: 8.8, color: SOFT, after: 4 }
  );
}

function specialTerms(doc, flow) {
  section(doc, flow, "6", "Stipulations particulières");
  prose(
    doc,
    flow,
    "À compléter si les parties en conviennent : remboursement anticipé, garantie, " +
      "pénalités de retard, exigibilité immédiate en cas de défaut, sort de la dette en " +
      "cas de décès. Laisser en blanc, ou barrer, s'il n'y en a aucune.",
    { size: 8.8, color: SOFT, after: 10 }
  );

  field(doc, flow, { label: "À compléter à la main", lines: 3 });
}

function signatures(doc, flow, loan) {
  section(doc, flow, "7", "Mention manuscrite et signatures");

  prose(
    doc,
    flow,
    "L'emprunteur recopie ci-dessous, de sa propre main, la mention suivante, puis date " +
      "et signe. En cas de différence entre les deux, la somme écrite en toutes lettres " +
      "l'emporte sur celle écrite en chiffres.",
    { after: 10 }
  );

  // Figures first, then the same amount in words: article 1376 asks for both, and this is
  // the order a French deed writes them in.
  const model =
    `« Bon pour la somme de ${eurosInWords(loan.principal)} ` +
    `(${spellEuros(loan.principal)}), que je m'engage à rembourser en ` +
    `${loan.periods} mensualités de ${eurosInWords(loan.payment)} ` +
    `(${spellEuros(loan.payment)}). »`;

  const lines = doc.wrap(model, { font: "italic", size: 9.4, width: CONTENT_WIDTH - 28 });
  const height = lines.length * 13 + 20;

  flow.needs(height + 10);
  doc.rect(MARGIN.left, flow.y, CONTENT_WIDTH, height, { fill: TINT, stroke: HAIRLINE });
  doc.paragraph(model, {
    x: MARGIN.left + 14,
    y: flow.y + 20,
    width: CONTENT_WIDTH - 28,
    font: "italic",
    size: 9.4,
    leading: 13,
    color: INK
  });
  flow.down(height + 14);

  field(doc, flow, { label: "Mention recopiée de la main de l'emprunteur", lines: 3 });

  fieldRow(doc, flow, [
    { label: "Fait à", width: 230 },
    { label: "Le" }
  ]);

  prose(
    doc,
    flow,
    "Le présent acte est établi en un original, remis au prêteur ; l'emprunteur en " +
      "conserve une copie.",
    { size: 8.8, color: SOFT, after: 12 }
  );

  const boxWidth = (CONTENT_WIDTH - 24) / 2;
  const boxHeight = 88;
  flow.needs(boxHeight + 34);

  const captions = [
    "Signature de l'emprunteur, précédée de « lu et approuvé »",
    "Signature du prêteur, pour acceptation"
  ];

  captions.forEach((caption, index) => {
    const x = MARGIN.left + index * (boxWidth + 24);
    doc.paragraph(caption, {
      x,
      y: flow.y + LABEL_SIZE,
      width: boxWidth,
      size: LABEL_SIZE,
      leading: 9,
      color: FAINT,
      charSpacing: 0.6
    });
    doc.rect(x, flow.y + 14, boxWidth, boxHeight, { stroke: FILL_RULE, width: 0.7 });
  });

  flow.down(boxHeight + 26);
}

/** The small print: what the law asks of this document, and what this tool is not. */
function notes(doc, flow) {
  const items = [
    "Au-delà de 1 500 euros, la preuve d'un prêt suppose un écrit (article 1359 du code " +
      "civil). En deçà, cet acte reste vivement conseillé.",
    "L'acte n'a valeur de preuve que s'il porte la signature de l'emprunteur et la " +
      "mention, écrite de sa main, de la somme en toutes lettres et en chiffres " +
      "(article 1376 du code civil).",
    "Un prêt de plus de 5 000 euros doit être déclaré à l'administration fiscale par chacune " +
      "des parties, au moyen du formulaire n° 2062, joint à la déclaration de revenus.",
    "L'action en remboursement se prescrit par cinq ans à compter de l'échéance impayée " +
      "(article 2224 du code civil).",
    "Structure inspirée de la fiche pratique de l'Institut national de la consommation " +
      "(inc-conso.fr). Ce document est un modèle : il ne vaut pas conseil juridique."
  ];

  // Asked for as one block: split across a page break, the tail of the small print lands
  // alone on a sheet of its own, which is how a document ends up with an empty last page.
  const measured = items.map(
    (item) => doc.wrap(item, { size: 8, width: CONTENT_WIDTH - 14 }).length * 10.8 + 4
  );
  flow.needs(33 + measured.reduce((total, height) => total + height, 0));

  flow.down(6);
  doc.line(MARGIN.left, flow.y, RIGHT, flow.y, { color: HAIRLINE, width: 0.8 });
  flow.down(15);

  doc.text("À SAVOIR", {
    x: MARGIN.left,
    y: flow.y,
    font: "bold",
    size: 8,
    color: SOFT,
    charSpacing: 1.1
  });
  flow.down(12);

  items.forEach((item, index) => {
    doc.text("—", { x: MARGIN.left, y: flow.y + 8, size: 8, color: FAINT });
    doc.paragraph(item, {
      x: MARGIN.left + 14,
      y: flow.y + 8,
      width: CONTENT_WIDTH - 14,
      size: 8,
      leading: 10.8,
      color: SOFT
    });

    flow.down(measured[index]);
  });
}

/* ---------------------------------------------------------------------- the schedule */

/**
 * Columns of the annexed schedule, and the two families they fall into.
 *
 * The constant-euro family the spreadsheet and the screen carry is deliberately absent, and
 * that is an invariant (INV-016): purchasing power is a reading of the loan, this annex is
 * one of its terms. A borrower asked to initial every page of a contract must not be
 * initialling a hypothesis about inflation.
 */
const GROUPS = scheduleGroups({ constantEuros: false });

/** Family tones, the same three the page and the workbook use, as PDF colour triples. */
const GROUP_FILL = {
  identity: { head: INK, wash: null },
  instalment: { head: [0.294, 0.227, 0.478], wash: [0.961, 0.949, 0.984] },
  loan: { head: [0.122, 0.435, 0.471], wash: [0.933, 0.961, 0.961] }
};

const COLUMNS = [
  { key: "number", title: "N°", group: "identity", width: 26, align: "center" },
  { key: "date", title: "Échéance", group: "identity", width: 52, align: "left" },
  { key: "instalment", title: "Mensualité", group: "instalment", width: 68, align: "right" },
  { key: "interest", title: "Intérêts", group: "instalment", width: 66, align: "right" },
  { key: "capital", title: "Capital amorti", group: "instalment", width: 70, align: "right" },
  { key: "balance", title: "Capital restant dû", group: "loan", width: 72, align: "right" },
  { key: "cumulativeInterest", title: "Intérêts cumulés", group: "loan", width: 68, align: "right" },
  { key: "cumulativeCapital", title: "Capital remboursé", group: "loan", width: 64, align: "right" }
];

const ROW_HEIGHT = 13.2;
const GROUP_HEIGHT = 14;
const HEADER_HEIGHT = 26;

function columnBox(index) {
  let x = MARGIN.left;
  for (let k = 0; k < index; k++) x += COLUMNS[k].width;
  return { x, width: COLUMNS[index].width };
}

/** Where a family starts and how wide it runs, in points. */
function groupBox(key) {
  const first = COLUMNS.findIndex((column) => column.group === key);
  const width = COLUMNS.filter((column) => column.group === key).reduce(
    (total, column) => total + column.width,
    0
  );
  return { x: columnBox(first).x, width };
}

/**
 * The header of the annex: the families on a band of their own, then the columns beneath
 * on the family's darker tone. Repeated on every page the schedule runs to.
 */
function scheduleHeader(doc, flow) {
  for (const group of GROUPS) {
    const { x, width } = groupBox(group.key);
    const fill = GROUP_FILL[group.key];

    doc.rect(x, flow.y, width, GROUP_HEIGHT, { fill: fill.head });
    if (group.label) {
      doc.text(group.label.toUpperCase(), {
        x,
        y: flow.y + 9.6,
        width,
        align: "center",
        font: "bold",
        size: 6.4,
        color: [1, 1, 1],
        charSpacing: 0.9
      });
    }

    doc.rect(x, flow.y + GROUP_HEIGHT, width, HEADER_HEIGHT, { fill: fill.head });
  }

  COLUMNS.forEach((column, index) => {
    const { x, width } = columnBox(index);
    const lines = doc.wrap(column.title, { font: "bold", size: 7.2, width: width - 8 });
    const top = flow.y + GROUP_HEIGHT + (HEADER_HEIGHT - lines.length * 9) / 2 + 7;

    doc.paragraph(column.title, {
      x: x + 4,
      y: top,
      width: width - 8,
      font: "bold",
      size: 7.2,
      leading: 9,
      color: [1, 1, 1],
      align: column.align
    });
  });

  flow.down(GROUP_HEIGHT + HEADER_HEIGHT);
}

/** The family washes behind one row of figures. */
function rowGrounds(doc, y) {
  for (const group of GROUPS) {
    const wash = GROUP_FILL[group.key].wash;
    if (!wash) continue;
    const { x, width } = groupBox(group.key);
    doc.rect(x, y, width, ROW_HEIGHT, { fill: wash });
  }
}

/**
 * The schedule itself, over as many pages as it takes, its header repeated on each —
 * a column of figures with no heading is unreadable, and this one is an annex to a
 * contract, so every page of it must stand on its own.
 */
function annex(doc, flow, loan) {
  flow.page();

  doc.text("ANNEXE À LA RECONNAISSANCE DE DETTE", {
    x: MARGIN.left,
    y: flow.y + 8,
    size: 7.6,
    color: FAINT,
    charSpacing: 1.6
  });
  flow.down(28);

  doc.text("Échéancier de remboursement", {
    x: MARGIN.left,
    y: flow.y,
    font: "bold",
    size: 17,
    color: INK
  });
  flow.down(13);

  doc.text(
    `Prêt de ${eurosInWords(loan.principal)} · ${loan.periods} mensualités de ` +
      `${eurosInWords(loan.payment)} · taux annuel nominal ${formatSteppedPercent(loan.rate)} · ` +
      `première échéance le ${formatDate(loan.firstDate)}`,
    { x: MARGIN.left, y: flow.y, size: 9, color: SOFT }
  );
  flow.down(10);

  doc.line(MARGIN.left, flow.y, RIGHT, flow.y, { color: INK, width: 1.1 });
  flow.down(14);

  prose(
    doc,
    flow,
    "Les intérêts de chaque échéance sont calculés sur le capital restant dû, au douzième " +
      "du taux annuel nominal, et arrondis au centime. Le capital amorti est le reste de " +
      "la mensualité.",
    { size: 8.4, color: SOFT, after: 10 }
  );

  scheduleHeader(doc, flow);

  loan.schedule.forEach((row) => {
    if (flow.y + ROW_HEIGHT > PAGE_BOTTOM) {
      flow.page();
      scheduleHeader(doc, flow);
    }

    rowGrounds(doc, flow.y);

    COLUMNS.forEach((column, index) => {
      const { x, width } = columnBox(index);
      const value =
        column.key === "number"
          ? String(row.number)
          : column.key === "date"
            ? formatDate(row.date)
            : formatEuro(row[column.key]);

      doc.text(value, {
        x: x + 4,
        y: flow.y + 9.2,
        width: width - 8,
        size: 7.4,
        color: column.group === "identity" ? SOFT : INK,
        align: column.align
      });
    });

    flow.down(ROW_HEIGHT);
  });

  // Totals: the three sums a reader would otherwise add up by hand to check the deed.
  if (flow.y + ROW_HEIGHT + 4 > PAGE_BOTTOM) {
    flow.page();
    scheduleHeader(doc, flow);
  }

  doc.line(MARGIN.left, flow.y, RIGHT, flow.y, { color: INK, width: 0.9 });

  const totals = [
    "",
    `${loan.periods} éch.`,
    formatEuro(loan.total),
    formatEuro(loan.cost),
    formatEuro(loan.principal),
    formatEuro(0),
    formatEuro(loan.cost),
    formatEuro(loan.principal)
  ];

  totals.forEach((value, column) => {
    if (!value) return;
    const { x, width } = columnBox(column);
    doc.text(value, {
      x: x + 4,
      y: flow.y + 11,
      width: width - 8,
      font: "bold",
      size: 7.4,
      color: INK,
      align: COLUMNS[column].align
    });
  });

  flow.down(ROW_HEIGHT + 8);

  prose(
    doc,
    flow,
    "Cet échéancier est annexé à la reconnaissance de dette et en fait partie intégrante. " +
      "Il est paraphé par les deux parties.",
    { size: 8.4, color: SOFT, after: 8 }
  );

  fieldRow(doc, flow, [
    { label: "Paraphe de l'emprunteur" },
    { label: "Paraphe du prêteur" }
  ]);
}

/* ------------------------------------------------------------------------- assembly */

/** Foot of every page: what this document is, and where the reader is inside it. */
function footers(doc, loan) {
  doc.eachPage((index, count) => {
    const y = A4.height - MARGIN.bottom + 22;

    doc.line(MARGIN.left, y - 12, RIGHT, y - 12, { color: HAIRLINE, width: 0.5 });
    doc.text(
      `Reconnaissance de dette — ${eurosInWords(loan.principal)}, ` +
        `${loan.periods} mensualités de ${euros(loan.payment)}`,
      { x: MARGIN.left, y, size: 7.2, color: FAINT }
    );
    // What wrote the page, and which build of it. A deed is printed, filed and questioned
    // months later, by someone who was not the one who exported it: « la mensualité est
    // fausse » is only answerable if the page names the tool as well as the version.
    doc.text(`${APP_NAME} · v${VERSION} · page ${index + 1} / ${count}`, {
      x: MARGIN.left,
      y,
      width: CONTENT_WIDTH,
      align: "right",
      size: 7.2,
      color: FAINT
    });
  });
}

/**
 * Lays the whole document out and hands back the document object — bytes, page count and
 * the drawing trace the tests read.
 *
 * @param {object} solved result of solveLoan()
 * @param {{now?: Date}} [options] creation date, injectable so a test can pin the bytes
 */
export function renderDeed(solved, { now } = {}) {
  if (!solved || !solved.schedule.length) {
    throw new Error("renderDeed: nothing to write, the loan has no schedule");
  }

  const loan = terms(solved);
  const doc = createDocument({
    title: `Reconnaissance de dette — ${euros(loan.principal)}`,
    subject: `Prêt de ${euros(loan.principal)} remboursable en ${loan.periods} mensualités`,
    producer: `${APP_NAME} v${VERSION} — ${APP_TAGLINE}`,
    now
  });
  const flow = createFlow(doc);

  header(doc, flow, loan);
  instructions(doc, flow);
  party(doc, flow, "1", "L'emprunteur", "Celui qui reçoit les fonds et s'engage à les rembourser — le débiteur.");
  party(doc, flow, "2", "Le prêteur", "Celui qui remet les fonds — le créancier.");
  sum(doc, flow, loan);
  repayment(doc, flow, loan);
  interest(doc, flow, loan);
  specialTerms(doc, flow);
  signatures(doc, flow, loan);
  notes(doc, flow);
  annex(doc, flow, loan);
  footers(doc, loan);

  return doc;
}

/**
 * The deed as PDF bytes.
 *
 * @param {object} solved result of solveLoan()
 * @param {{now?: Date}} [options]
 * @returns {Uint8Array}
 */
export function buildDeed(solved, options) {
  return renderDeed(solved, options).toBytes();
}

/**
 * Hands the deed to the browser as a download.
 *
 * @param {object} solved result of solveLoan()
 * @param {string} filename
 * @param {{now?: Date}} [options]
 */
export function exportDeedPdf(solved, filename = "pret-a-preter-reconnaissance-de-dette.pdf", options) {
  if (!solved || !solved.schedule.length) return;

  const blob = new Blob([buildDeed(solved, options)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

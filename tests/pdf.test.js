/**
 * The PDF layer: the writer, and the deed it draws.
 *
 * There is no PDF parser here, and none is needed: the writer records every drawing call
 * in `trace`, so the layout can be asserted directly — nothing outside the margins,
 * one row per instalment, a header on every page of the annex. What the bytes themselves
 * must satisfy is the structure a viewer seeks through: header, objects, cross-reference
 * offsets that actually point at their object, trailer.
 */

import { describe, expect, it } from "vitest";

import { solveLoan } from "../src/core/finance.js";
import { A4, createDocument } from "../src/export/pdf/document.js";
import { encodeWinAnsi, fontWidths, measure, wrapText } from "../src/export/pdf/metrics.js";
import { buildDeed, renderDeed } from "../src/export/pdf/deed.js";
import { VERSION } from "../src/core/version.js";

/** The reference loan of the interface: 10 000 € over ten years, cost 1 587 €. */
const solved = solveLoan({
  principal: 10_000,
  periods: 120,
  totalCost: 1_587,
  roundPayment: true,
  annualInflation: 0.02,
  startDate: new Date(2026, 8, 5)
});

/** Fixed date so two runs of the same loan produce the same bytes. */
const now = new Date(2026, 7, 16, 10, 0, 0);

const decode = (bytes) => String.fromCharCode(...bytes);

/**
 * fr-FR separates thousands with a narrow no-break space and puts one before the euro
 * sign. Those are invisible in a test file, so every comparison here is made on text
 * whose spaces have all been flattened to the ordinary one.
 */
const flatten = (text) => String(text ?? "").replace(/[\s\u00A0\u202F\u2009]/g, " ");

describe("metrics", () => {
  it("measures a string from the Adobe advance widths", () => {
    // "A" is 667/1000 of the size in Helvetica, 722 in Helvetica-Bold.
    expect(measure("A", { size: 10 })).toBeCloseTo(6.67, 5);
    expect(measure("A", { font: "bold", size: 10 })).toBeCloseTo(7.22, 5);
    expect(measure("", { size: 10 })).toBe(0);
  });

  it("gives an accented letter the width of the letter it is built on", () => {
    expect(measure("é", { size: 10 })).toBe(measure("e", { size: 10 }));
    expect(measure("ç", { size: 10 })).toBe(measure("c", { size: 10 }));
    // The dotted i is the exception: its accented forms are wider than the bare one.
    expect(measure("î", { size: 10 })).toBeGreaterThan(measure("i", { size: 10 }));
  });

  it("measures the narrow space fr-FR puts inside amounts", () => {
    // 10 000 € — Intl separates with U+202F, which becomes a no-break space.
    expect(measure("10 000 €", { size: 10 })).toBeCloseTo(
      measure("10 000 €", { size: 10 }),
      5
    );
  });

  it("wraps without ever exceeding the width it was given", () => {
    const text =
      "L'emprunteur s'engage à rembourser cette somme au prêteur selon les conditions " +
      "suivantes, arrêtées d'un commun accord entre les parties.";

    for (const line of wrapText(text, { size: 9.6, width: 200 })) {
      expect(measure(line, { size: 9.6 })).toBeLessThanOrEqual(200);
    }
  });

  it("cuts a word too long for its column rather than letting it run out", () => {
    const lines = wrapText("prenom.nom.tres.long@exemple-de-domaine.fr", {
      size: 9,
      width: 60
    });

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, { size: 9 })).toBeLessThanOrEqual(60);
  });

  it("keeps explicit line breaks", () => {
    expect(wrapText("un\ndeux", { size: 10, width: 500 })).toEqual(["un", "deux"]);
  });

  it("encodes French, the euro sign included, one byte per character", () => {
    expect(encodeWinAnsi("é")).toBe("\xE9");
    expect(encodeWinAnsi("€")).toBe("\x80");
    expect(encodeWinAnsi("’")).toBe("\x92");
    expect(encodeWinAnsi("—")).toBe("\x97");
    // The narrow no-break space of fr-FR has no WinAnsi code; it becomes a plain one.
    expect(encodeWinAnsi("10 000")).toBe("10\xA0000");
    // Anything unrepresentable is marked, never dropped in silence.
    expect(encodeWinAnsi("日")).toBe("?");
  });

  it("publishes the same widths it measures with", () => {
    const widths = fontWidths("regular");
    expect(widths).toHaveLength(224); // codes 32 to 255
    expect(widths[0]).toBe(278); // space
    expect(widths[65 - 32]).toBe(667); // A
    expect(widths[0x80 - 32]).toBe(556); // euro
    expect(widths[0x81 - 32]).toBe(0); // unused WinAnsi slot
  });
});

describe("the writer", () => {
  it("writes a file a viewer can seek through", () => {
    const doc = createDocument({ title: "essai", now });
    doc.addPage();
    doc.text("Bonjour", { x: 50, y: 50, size: 12 });

    const file = decode(doc.toBytes());

    expect(file.startsWith("%PDF-1.4\n")).toBe(true);
    expect(file.endsWith("%%EOF\n")).toBe(true);

    // Every cross-reference offset must land exactly on its own object header.
    const size = Number(file.match(/\/Size (\d+)/)[1]);
    const offsets = [...file.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
      Number(match[1])
    );

    expect(offsets).toHaveLength(size - 1);
    offsets.forEach((offset, index) => {
      expect(file.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
        `${index + 1} 0 obj`
      );
    });

    // startxref must point at the table itself.
    const startxref = Number(file.match(/startxref\n(\d+)/)[1]);
    expect(file.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("declares the length of each content stream in bytes, accents included", () => {
    const doc = createDocument({ now });
    doc.addPage();
    doc.text("coût déjà réglé — 10 000 €", { x: 50, y: 50, size: 12 });

    const file = decode(doc.toBytes());
    const [, length, content] = file.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);

    expect(content).toHaveLength(Number(length));
  });

  it("titles the document in UTF-16, which is the only encoding a viewer will not misread", () => {
    const file = decode(createDocument({ title: "Prêt", now }).toBytes());
    expect(file).toContain("/Title (\xFE\xFF\x00P\x00r\x00\xEA\x00t)");
  });

  it("flips top-left coordinates onto the PDF page", () => {
    const doc = createDocument({ now });
    doc.addPage();
    doc.text("x", { x: 10, y: 100, size: 10 });

    expect(decode(doc.toBytes())).toContain(`10 ${A4.height - 100} Td`);
  });

  it("counts its pages and refuses to draw before there is one", () => {
    const doc = createDocument({ now });
    expect(() => doc.text("x", { x: 0, y: 0, size: 10 })).toThrow(/does not exist/);
    doc.addPage();
    doc.addPage();
    expect(doc.pageCount).toBe(2);
  });

  it("lets a late pass draw on pages that did not exist yet", () => {
    const doc = createDocument({ now });
    doc.addPage();
    doc.addPage();
    doc.eachPage((index, count) => doc.text(`page ${index + 1} / ${count}`, { x: 0, y: 0, size: 8 }));

    const numbered = doc.trace.filter((item) => item.kind === "text");
    expect(numbered.map((item) => item.text)).toEqual(["page 1 / 2", "page 2 / 2"]);
    expect(numbered.map((item) => item.page)).toEqual([0, 1]);
  });
});

describe("the deed", () => {
  const doc = renderDeed(solved, { now });
  const texts = doc.trace.filter((item) => item.kind === "text");
  const said = texts.map((item) => flatten(item.text));
  // Prose is drawn one wrapped line at a time, so a sentence is looked for in the whole
  // document rather than in any single line of it.
  const running = said.join(" ");
  const somewhere = (fragment) => running.includes(fragment);

  it("holds the deed and its annex", () => {
    // Three pages of deed for this loan, plus the pages the schedule needs.
    expect(doc.pageCount).toBeGreaterThanOrEqual(4);
  });

  /**
   * The one thing a form cannot survive: text running past the paper. Measured from the
   * trace rather than eyeballed, on a box slightly wider than the real margins so the
   * assertion catches overflow without pinning the design.
   */
  it("keeps every line inside the page", () => {
    for (const item of texts) {
      expect(item.x).toBeGreaterThanOrEqual(40);
      expect(item.right).toBeLessThanOrEqual(A4.width - 40);
      expect(item.y).toBeGreaterThan(0);
      expect(item.y).toBeLessThan(A4.height);
    }
  });

  it("prints the terms of the contract, and does not ask anyone to copy them", () => {
    expect(somewhere("10 000 €")).toBe(true); // the amount lent
    expect(somewhere("96 €")).toBe(true); // the instalment
    expect(somewhere("2,8785 %")).toBe(true); // the rate the round instalment implies
    expect(somewhere("1 520 €")).toBe(true); // the cost that follows from it
    expect(somewhere("11 520 €")).toBe(true); // the total repaid
    expect(somewhere("120 mensualités")).toBe(true);
    expect(somewhere("05/09/2026")).toBe(true); // first instalment
    expect(somewhere("05/08/2036")).toBe(true); // last instalment
  });

  it("spells the sum out, since the words are what prevail over the figures", () => {
    expect(somewhere("dix mille euros")).toBe(true);
    expect(somewhere("Bon pour la somme de")).toBe(true);
    expect(somewhere("quatre-vingt-seize euros")).toBe(true);
  });

  it("leaves the personal fields blank, with a rule to write on", () => {
    for (const label of [
      "NOM ET PRÉNOMS",
      "NÉ(E) LE",
      "DEMEURANT À",
      "IBAN DU COMPTE DU PRÊTEUR, SUR LEQUEL LES MENSUALITÉS SONT VERSÉES",
      "FAIT À",
      "MENTION RECOPIÉE DE LA MAIN DE L'EMPRUNTEUR"
    ]) {
      expect(said).toContain(label);
    }

    // Both parties get the same fields: the borrower's block and the lender's block.
    expect(said.filter((text) => text === "NOM ET PRÉNOMS")).toHaveLength(2);

    // Fill-in rules, not decoration: there are dozens of them, all inside the page.
    const rules = doc.trace.filter((item) => item.kind === "line");
    expect(rules.length).toBeGreaterThan(20);
  });

  it("says what it is not", () => {
    expect(somewhere("ne vaut pas conseil juridique")).toBe(true);
    expect(somewhere("article 1376 du code civil")).toBe(true);
    expect(somewhere("formulaire n° 2062")).toBe(true);
  });

  it("annexes one row per instalment, and adds them up", () => {
    const instalments = said.filter((text) => text === "96,00 €");
    expect(instalments).toHaveLength(120);

    // The totals row: everything paid, all the interest, all the capital, nothing left.
    expect(somewhere("11 520,00 €")).toBe(true);
    expect(somewhere("1 520,00 €")).toBe(true);
    expect(somewhere("10 000,00 €")).toBe(true);
    expect(said.filter((text) => text === "0,00 €").length).toBeGreaterThanOrEqual(2);
  });

  it("repeats the column headings on every page of the annex", () => {
    const headings = texts.filter((item) => item.text === "Capital restant dû");
    const annexPages = new Set(headings.map((item) => item.page));

    expect(headings).toHaveLength(annexPages.size);
    expect(annexPages.size).toBeGreaterThanOrEqual(2);
    // The heading belongs to the annex only, never to the deed's first page.
    expect(annexPages.has(0)).toBe(false);
  });

  it("numbers every page, and stamps the version on each, once the total is known", () => {
    const numbers = said.filter((text) => text.includes("page "));
    expect(numbers).toHaveLength(doc.pageCount);
    expect(numbers[0]).toBe(`v${VERSION} · page 1 / ${doc.pageCount}`);
    expect(numbers[doc.pageCount - 1]).toBe(
      `v${VERSION} · page ${doc.pageCount} / ${doc.pageCount}`
    );
  });

  it("writes a real PDF, the same one twice for the same loan", () => {
    const bytes = buildDeed(solved, { now });
    const again = buildDeed(solved, { now });

    expect(decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(Array.from(again)).toEqual(Array.from(bytes));
  });

  it("refuses to write a deed for a loan that has no schedule", () => {
    expect(() => renderDeed({ schedule: [] })).toThrow(/no schedule/);
    expect(() => renderDeed(null)).toThrow(/no schedule/);
  });
});

/**
 * The two loans the deed has to word differently: one with no interest at all, and one
 * where no whole-euro instalment settles the debt, so the last one is adjusted.
 */
describe("the deed, on the loans that read differently", () => {
  it("says a free loan is free", () => {
    const free = solveLoan({
      principal: 6_000,
      periods: 24,
      totalCost: 0,
      roundPayment: true,
      startDate: new Date(2026, 0, 5)
    });
    const said = renderDeed(free, { now }).trace.map((item) => flatten(item.text));

    expect(said.some((text) => text && text.includes("sans intérêt"))).toBe(true);
    expect(said.some((text) => text && text.includes("revenu imposable"))).toBe(false);
  });

  it("announces the adjusted final instalment when no round one settles the loan", () => {
    // 500 € over 240 months: the measured case where whole euros are too coarse a grid.
    const awkward = solveLoan({
      principal: 500,
      periods: 240,
      totalCost: 60,
      roundPayment: true,
      startDate: new Date(2026, 0, 5)
    });
    expect(awkward.roundPayment.applied).toBe(false);

    const said = renderDeed(awkward, { now }).trace.map((item) => flatten(item.text));
    expect(said.some((text) => text && text.startsWith("sauf la dernière, ajustée à"))).toBe(true);
  });
});

/**
 * A very small PDF writer — enough for a printed deed, and nothing more.
 *
 * Why write one rather than vendor a library: this page ships every byte it serves and
 * claims that nothing is fetched from a third party, so a PDF library would be another
 * few hundred kilobytes to vendor, license and audit for a document made of text, rules
 * and rectangles. What is here is the PDF 1.4 subset that draws those three things, in
 * uncompressed content streams — the produced file can be opened in a text editor and
 * read, which is the same standard of auditability the rest of the tool holds itself to.
 *
 * Two conventions, both deliberate:
 *
 *   - **Coordinates run from the top left**, in points, like every layout anyone has ever
 *     done by hand. PDF's own origin is bottom left; the flip happens here, once.
 *   - **Every drawing call is recorded** in `trace`. That is what lets the layout be
 *     tested — "nothing overflows the right margin", "the amount appears on page 1" —
 *     without parsing the file back.
 */

import { encodeWinAnsi, fontWidths, measure, wrapText } from "./metrics.js";

/** A4 in points, the only page size this tool needs. */
export const A4 = { width: 595.28, height: 841.89 };

/** Resource names of the three fonts, in the order their objects are written. */
const FONTS = [
  { key: "regular", resource: "F1", base: "Helvetica" },
  { key: "bold", resource: "F2", base: "Helvetica-Bold" },
  { key: "italic", resource: "F3", base: "Helvetica-Oblique" }
];

const RESOURCE = Object.fromEntries(FONTS.map((font) => [font.key, font.resource]));

/** PDF wants plain decimals: no exponent, no trailing noise. */
const n = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

/** Colour components, PDF-style, from a [r, g, b] triple in 0–1. */
const rgb = ([r, g, b]) => `${n3(r)} ${n3(g)} ${n3(b)}`;
const n3 = (value) => String(Math.round(value * 1000) / 1000);

/** Escapes the three characters a PDF literal string cannot carry unaided. */
const literal = (text) => encodeWinAnsi(text).replace(/([\\()])/g, "\\$1");

/**
 * A string for the document information dictionary, in UTF-16BE with its byte-order
 * mark. Outside a content stream a PDF string is read as PDFDocEncoding, which is *not*
 * WinAnsi — the two disagree exactly where French needs them, and the title came out as
 * "Reconnaissance de dette Š 10€000€" in a browser tab. UTF-16 leaves no room for doubt.
 */
function textString(text) {
  let out = "\xFE\xFF";

  for (const char of String(text ?? "")) {
    const code = char.codePointAt(0);
    // Beyond the basic plane there is nothing a deed would carry; a mark is enough.
    const unit = code > 0xffff ? 0x003f : code;
    out += String.fromCharCode((unit >> 8) & 0xff, unit & 0xff);
  }

  return out.replace(/([\\()])/g, "\\$1");
}

/** Timestamp in PDF's own date format, local time, no zone — the deed is printed, not filed. */
function pdfDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Opens a document. Pages are added explicitly; nothing is drawn until one exists.
 *
 * @param {object} [options]
 * @param {string} [options.title] shown by the viewer in its title bar
 * @param {string} [options.subject]
 * @param {Date} [options.now] creation date; injectable so tests get identical bytes
 * @param {{width: number, height: number}} [options.size]
 * @returns {object} the drawing API
 */
export function createDocument({
  title = "",
  subject = "",
  now = new Date(),
  size = A4
} = {}) {
  const pages = [];
  const trace = [];
  let current = null;

  function addPage() {
    // The page carries its own index: `eachPage` draws on pages that are no longer the
    // last one, and a trace entry that named the wrong page would be worse than none.
    current = { ops: [], index: pages.length };
    pages.push(current);
    return current.index;
  }

  const emit = (op) => {
    if (!current) throw new Error("createDocument: draw on a page that does not exist yet");
    current.ops.push(op);
  };

  /** Top-left coordinates in, PDF coordinates out. */
  const flip = (y) => size.height - y;

  /**
   * One line of text.
   *
   * `y` is the **baseline**, measured from the top of the page: the layout above this
   * module works in baselines throughout, since that is what keeps successive lines a
   * fixed leading apart whatever their size.
   *
   * With `width` given, `align` places the line inside the box [x, x + width].
   */
  function text(
    value,
    { x, y, font = "regular", size: fontSize = 10, color = [0, 0, 0], align = "left", width = 0, charSpacing = 0 }
  ) {
    const printed = String(value ?? "");
    if (!printed) return 0;

    const drawn = measure(printed, { font, size: fontSize, charSpacing });
    let left = x;
    if (width && align === "right") left = x + width - drawn;
    if (width && align === "center") left = x + (width - drawn) / 2;

    emit(
      `BT /${RESOURCE[font] || RESOURCE.regular} ${n(fontSize)} Tf ${rgb(color)} rg ` +
        `${n(charSpacing)} Tc ${n(left)} ${n(flip(y))} Td (${literal(printed)}) Tj ET`
    );

    trace.push({
      page: current.index,
      kind: "text",
      text: printed,
      x: left,
      y,
      right: left + drawn,
      width: drawn,
      font,
      size: fontSize
    });

    return drawn;
  }

  /**
   * Wrapped text. `y` is the baseline of the first line; the return value is the height
   * consumed, so the caller can advance its cursor without counting lines itself.
   */
  function paragraph(
    value,
    { x, y, width, font = "regular", size: fontSize = 10, leading, color, align, charSpacing = 0 }
  ) {
    const step = leading || fontSize * 1.35;
    const lines = wrapText(value, { font, size: fontSize, width, charSpacing });

    lines.forEach((line, index) => {
      text(line, { x, y: y + index * step, width, font, size: fontSize, color, align, charSpacing });
    });

    return lines.length * step;
  }

  /** A straight rule. Hairlines are what separate a form from a wall of text. */
  function line(x1, y1, x2, y2, { width = 0.6, color = [0, 0, 0], dash = null } = {}) {
    emit(
      `${dash ? `[${dash.join(" ")}] 0 d ` : "[] 0 d "}${n(width)} w ${rgb(color)} RG ` +
        `${n(x1)} ${n(flip(y1))} m ${n(x2)} ${n(flip(y2))} l S`
    );
    trace.push({ page: current.index, kind: "line", x1, y1, x2, y2 });
  }

  /** A rectangle, filled, stroked, or both. `y` is its top edge. */
  function rect(x, y, w, h, { fill = null, stroke = null, width: lineWidth = 0.6 } = {}) {
    const shape = `${n(x)} ${n(flip(y + h))} ${n(w)} ${n(h)} re`;

    if (fill && stroke) {
      emit(`${rgb(fill)} rg ${rgb(stroke)} RG ${n(lineWidth)} w ${shape} B`);
    } else if (fill) {
      emit(`${rgb(fill)} rg ${shape} f`);
    } else if (stroke) {
      emit(`[] 0 d ${rgb(stroke)} RG ${n(lineWidth)} w ${shape} S`);
    }

    trace.push({ page: current.index, kind: "rect", x, y, width: w, height: h });
  }

  /**
   * Draws on every page once they all exist — page numbers being the obvious case, since
   * "page 2 of 7" cannot be written before the seventh page has been laid out.
   *
   * @param {(index: number, count: number) => void} draw
   */
  function eachPage(draw) {
    const saved = current;
    pages.forEach((page, index) => {
      current = page;
      draw(index, pages.length);
    });
    current = saved;
  }

  /**
   * Serialises the document.
   *
   * Objects are numbered as they are written and their byte offsets recorded, which is
   * all the cross-reference table is: a viewer seeks straight to an object rather than
   * scanning the file.
   *
   * @returns {Uint8Array}
   */
  function toBytes() {
    if (!pages.length) addPage();

    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // object numbers are 1-based
    };

    const catalogId = add(null); // reserved: it names the page tree, written below
    const pagesId = add(null);
    const fontIds = FONTS.map((font) =>
      add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} ` +
          `/Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 ` +
          `/Widths [${fontWidths(font.key).join(" ")}] >>`
      )
    );
    const infoId = add(
      `<< /Title (${textString(title)}) /Subject (${textString(subject)}) ` +
        `/Producer (${textString("echeancier-pret — generateur PDF integre")}) ` +
        `/CreationDate (${pdfDate(now)}) >>`
    );

    const fontResources = FONTS.map(
      (font, index) => `/${font.resource} ${fontIds[index]} 0 R`
    ).join(" ");

    const pageIds = [];

    for (const page of pages) {
      const content = page.ops.join("\n");
      const contentId = add(
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
      );
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R ` +
            `/MediaBox [0 0 ${n(size.width)} ${n(size.height)}] ` +
            `/Resources << /Font << ${fontResources} >> >> ` +
            `/Contents ${contentId} 0 R >>`
        )
      );
    }

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] ` +
      `/Count ${pageIds.length} >>`;

    // The binary comment on line two tells any tool handling the file that it is not
    // plain text, which is what stops a naive transfer from mangling the accented bytes.
    let file = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];

    objects.forEach((body, index) => {
      offsets.push(file.length);
      file += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const startxref = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      file += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    file +=
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R ` +
      `/Info ${infoId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

    const bytes = new Uint8Array(file.length);
    for (let index = 0; index < file.length; index++) {
      bytes[index] = file.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  return {
    size,
    trace,
    get pageCount() {
      return pages.length;
    },
    addPage,
    text,
    paragraph,
    line,
    rect,
    eachPage,
    toBytes,
    measure: (value, style) => measure(value, style),
    wrap: (value, style) => wrapText(value, style)
  };
}

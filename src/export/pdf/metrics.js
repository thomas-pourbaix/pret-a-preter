/**
 * Metrics and encoding for the three base-14 fonts this project writes PDFs with.
 *
 * A PDF viewer already owns Helvetica, Helvetica-Bold and Helvetica-Oblique, so nothing
 * is embedded: the file stays small, and the page keeps its promise that no byte is
 * fetched from a third party. The price is that we must know how wide the glyphs are —
 * the viewer will not wrap a line for us — hence the tables below, which are the advance
 * widths of Adobe's own AFM files, in thousandths of the font size.
 *
 * Text is written with /WinAnsiEncoding, one byte per character. That covers French
 * completely, plus the euro sign and the typographic marks fr-FR formatting produces.
 */

/** Advance widths of Helvetica, code points 32 to 126. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

/** Advance widths of Helvetica-Bold, code points 32 to 126. */
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

/**
 * Accented letters are composites: their advance is that of the base letter, the accent
 * being drawn above without widening the glyph. Only the dotted i breaks the rule, its
 * accented forms being wider than the bare i.
 */
const BASE_LETTER = {
  à: "a", â: "a", ä: "a", á: "a", ã: "a", å: "a",
  ç: "c",
  é: "e", è: "e", ê: "e", ë: "e",
  ñ: "n",
  ô: "o", ö: "o", ó: "o", ò: "o", õ: "o",
  ù: "u", û: "u", ü: "u", ú: "u",
  ÿ: "y", ý: "y",
  À: "A", Â: "A", Ä: "A", Á: "A", Ã: "A", Å: "A",
  Ç: "C",
  É: "E", È: "E", Ê: "E", Ë: "E",
  Ñ: "N",
  Ô: "O", Ö: "O", Ó: "O", Ò: "O", Õ: "O",
  Ù: "U", Û: "U", Ü: "U", Ú: "U"
};

/** Widths that follow neither the ASCII table nor a base letter. */
const SPECIAL = {
  regular: {
    î: 278, ï: 278, í: 278, ì: 278,
    Î: 278, Ï: 278, Í: 278, Ì: 278,
    æ: 889, Æ: 1000, œ: 944, Œ: 1000, ß: 611,
    "«": 556, "»": 556, "‹": 333, "›": 333,
    "’": 191, "‘": 191, "“": 333, "”": 333,
    "–": 556, "—": 1000, "…": 1000, "€": 556, "°": 400,
    "§": 556, "©": 737, "®": 737, "±": 584, "×": 584, "÷": 584,
    "¡": 333, "¢": 556, "£": 556, "¤": 556, "¥": 556, "¦": 260, "¨": 333,
    "ª": 370, "¬": 584, "¯": 333, "²": 333, "³": 333, "´": 333, "µ": 556,
    "¶": 537, "·": 278, "¸": 333, "¹": 333, "º": 365, "¼": 834, "½": 834,
    "¾": 834, "¿": 611, "Ð": 722, "Ø": 778, "Þ": 667, "ð": 556, "ø": 611, "þ": 556,
    "\u00A0": 278
  },
  bold: {
    î: 278, ï: 278, í: 278, ì: 278,
    Î: 278, Ï: 278, Í: 278, Ì: 278,
    æ: 889, Æ: 1000, œ: 944, Œ: 1000, ß: 611,
    "«": 556, "»": 556, "‹": 333, "›": 333,
    "’": 238, "‘": 238, "“": 500, "”": 500,
    "–": 556, "—": 1000, "…": 1000, "€": 556, "°": 400,
    "§": 556, "©": 737, "®": 737, "±": 584, "×": 584, "÷": 584,
    "¡": 333, "¢": 556, "£": 556, "¤": 556, "¥": 556, "¦": 280, "¨": 333,
    "ª": 370, "¬": 584, "¯": 333, "²": 333, "³": 333, "´": 333, "µ": 611,
    "¶": 556, "·": 278, "¸": 333, "¹": 333, "º": 365, "¼": 834, "½": 834,
    "¾": 834, "¿": 611, "Ð": 722, "Ø": 778, "Þ": 667, "ð": 611, "ø": 611, "þ": 611,
    "\u00A0": 278
  }
};

/** Oblique is Helvetica slanted: same advances, so it shares the regular table. */
const TABLE = {
  regular: { ascii: HELVETICA, special: SPECIAL.regular },
  bold: { ascii: HELVETICA_BOLD, special: SPECIAL.bold },
  italic: { ascii: HELVETICA, special: SPECIAL.regular }
};

/** Fallback for anything the tables do not know: the width of the question mark drawn. */
const UNKNOWN_WIDTH = 556;

/**
 * Characters WinAnsi places in 0x80–0x9F, where Latin-1 has control codes. Everything
 * from 0xA0 to 0xFF is Latin-1 and needs no translation.
 */
const WIN_ANSI_HIGH = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
  "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f
};

/**
 * The spaces fr-FR formatting inserts. Intl separates thousands with a narrow no-break
 * space, which WinAnsi has no code for: written raw it would come out as a question mark
 * in the middle of every amount. It becomes a plain no-break space, which is what the
 * separator means anyway.
 */
const SPACE_LIKE = /[\u2007\u2009\u202F\u2060]/g;

/** One character's advance width, in thousandths of the font size. */
function charWidth(char, font) {
  const { ascii, special } = TABLE[font] || TABLE.regular;
  const code = char.codePointAt(0);

  if (code >= 32 && code <= 126) return ascii[code - 32];
  if (special[char] !== undefined) return special[char];

  const base = BASE_LETTER[char];
  if (base) return ascii[base.codePointAt(0) - 32];

  return UNKNOWN_WIDTH;
}

/** WinAnsi code points 0x80–0x9F, the other way round: code to character. */
const HIGH_BY_CODE = Object.fromEntries(
  Object.entries(WIN_ANSI_HIGH).map(([char, code]) => [code, char])
);

/**
 * The advance widths of one font, codes 32 to 255, as the PDF /Widths array wants them.
 *
 * Declaring them is not optional in practice, whatever the specification allows for the
 * standard fourteen fonts: left to itself a viewer measures with the metrics of whichever
 * Helvetica it substitutes, and those are not always Adobe's — macOS drew the euro sign
 * over the space that followed it. The layout above is computed from the table in this
 * file, so the file has to carry that table, or the two disagree on the page.
 *
 * @param {string} font "regular" | "bold" | "italic"
 * @returns {Array<number>}
 */
export function fontWidths(font) {
  const widths = [];

  for (let code = 32; code <= 255; code++) {
    const high = code >= 0x80 && code <= 0x9f;
    const char = HIGH_BY_CODE[code] || (high ? null : String.fromCharCode(code));
    widths.push(char === null ? 0 : charWidth(char, font));
  }

  return widths;
}

/**
 * Width of a string once drawn, in points.
 *
 * @param {string} text
 * @param {{font?: string, size: number, charSpacing?: number}} style
 * @returns {number}
 */
export function measure(text, { font = "regular", size, charSpacing = 0 }) {
  const value = String(text ?? "").replace(SPACE_LIKE, " ");
  let thousandths = 0;

  for (const char of value) thousandths += charWidth(char, font);

  return (thousandths / 1000) * size + charSpacing * Math.max(0, value.length - 1);
}

/**
 * Breaks `text` into lines that fit `width`, honouring explicit newlines.
 *
 * A word longer than the whole line — an email address typed into a form, a made-up
 * compound — is cut rather than allowed to run into the margin: overflowing silently is
 * the one behaviour a printed deed cannot afford.
 *
 * @param {string} text
 * @param {{font?: string, size: number, width: number, charSpacing?: number}} style
 * @returns {Array<string>}
 */
export function wrapText(text, { font = "regular", size, width, charSpacing = 0 }) {
  const style = { font, size, charSpacing };
  const lines = [];

  for (const paragraph of String(text ?? "").split("\n")) {
    const words = paragraph.split(/ +/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measure(candidate, style) <= width) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = word;
    }

    if (line) lines.push(line);
  }

  return lines.flatMap((line) => breakLongLine(line, { ...style, width }));
}

/** Last resort for a single word wider than the column: cut it where it stops fitting. */
function breakLongLine(line, { width, ...style }) {
  if (measure(line, style) <= width) return [line];

  const pieces = [];
  let piece = "";

  for (const char of line) {
    if (piece && measure(piece + char, style) > width) {
      pieces.push(piece);
      piece = "";
    }
    piece += char;
  }

  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Encodes a string as WinAnsi bytes, returned as a binary string — one character per
 * byte, every code point below 256 — which is what the writer concatenates into the file.
 *
 * @param {string} text
 * @returns {string}
 */
export function encodeWinAnsi(text) {
  const value = String(text ?? "").replace(SPACE_LIKE, " ");
  let out = "";

  for (const char of value) {
    const code = char.codePointAt(0);

    if (WIN_ANSI_HIGH[char] !== undefined) {
      out += String.fromCharCode(WIN_ANSI_HIGH[char]);
    } else if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) {
      out += String.fromCharCode(code);
    } else {
      // Unrepresentable rather than silently dropped: a visible mark is a bug report.
      out += "?";
    }
  }

  return out;
}

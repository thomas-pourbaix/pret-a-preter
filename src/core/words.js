/**
 * Amounts spelled out in French words.
 *
 * A debt acknowledgement is only valid proof if the borrower writes the sum in words as
 * well as in figures, in their own hand (article 1376 of the Code civil), and the written
 * words prevail over the figures if the two disagree. The deed therefore prints the
 * sentence the borrower is meant to copy — figures alone would leave them to spell out
 * "quatre-vingt-dix-sept" on their own, which is precisely where a deed gets challenged.
 *
 * Spelling follows the traditional convention rather than the 1990 reform: hyphens inside
 * a group below one hundred, "et" without hyphens in vingt et un / soixante et onze, and
 * plain spaces around cent, mille, million. That is what French banking documents use.
 *
 * Pure arithmetic and strings, like the rest of src/core: no DOM, no formatting locale.
 */

const UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize"
];

/** Tens by their leading digit; 70 and 90 are built on 60 and 80, as French does. */
const TENS = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
  8: "quatre-vingt"
};

/** Scales above one thousand, singular and plural — million and milliard take an s. */
const SCALES = [
  { value: 1_000_000_000, one: "un milliard", many: "milliards" },
  { value: 1_000_000, one: "un million", many: "millions" },
  // "mille" never takes an s, and "un mille" is not said: it is simply "mille".
  { value: 1_000, one: "mille", many: "mille", invariable: true }
];

/** Largest amount this module will spell; beyond it, no French deed is being written. */
const MAX = 1_000_000_000_000;

/**
 * Numbers below one hundred: the awkward part of French, where 70 is "soixante-dix" and
 * 80 is "quatre-vingts" — with the s only when nothing follows it.
 *
 * `beforeNumeral` says that a numeral adjective comes next ("mille"), which cancels the
 * plural: quatre-vingts, but quatre-vingt mille. Before a noun — million, milliard,
 * euros — the s stays, hence the distinction rather than a blanket rule.
 */
function spellBelowHundred(value, beforeNumeral = false) {
  if (value < 17) return UNITS[value];

  const tens = Math.floor(value / 10);
  const unit = value % 10;

  // 17, 18, 19 are the only teens French builds out of ten and a unit.
  if (tens === 1) return `dix-${UNITS[unit]}`;

  // 70–79 and 90–99 count from 60 and 80: soixante-dix-sept, quatre-vingt-dix-sept.
  if (tens === 7 || tens === 9) {
    const base = TENS[tens - 1];
    const rest = value - (tens === 7 ? 60 : 80);
    // Seventy-one keeps the "et" of twenty-one; ninety-one, built on eighty, does not.
    if (rest === 11 && tens === 7) return `${base} et onze`;
    return `${base}-${spellBelowHundred(rest)}`;
  }

  const base = TENS[tens];
  if (unit === 0) return tens === 8 && !beforeNumeral ? "quatre-vingts" : base;
  if (unit === 1 && tens !== 8) return `${base} et un`;
  return `${base}-${UNITS[unit]}`;
}

/** Numbers below one thousand: "cent" pluralises only when multiplied and final. */
function spellBelowThousand(value, beforeNumeral = false) {
  if (value < 100) return spellBelowHundred(value, beforeNumeral);

  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 1 ? "cent" : `${UNITS[hundreds]} cent`;

  if (rest === 0) return hundreds === 1 || beforeNumeral ? head : `${head}s`;
  return `${head} ${spellBelowHundred(rest)}`;
}

/**
 * A whole number in French words.
 *
 * @param {number} value integer, 0 ≤ value < 10^12
 * @returns {string}
 */
export function spellInteger(value) {
  if (!Number.isFinite(value) || value < 0 || value >= MAX) {
    throw new RangeError("spellInteger: expected a whole number below one trillion");
  }

  const whole = Math.round(value);
  if (whole < 1000) return spellBelowThousand(whole);

  const parts = [];
  let rest = whole;

  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    if (!count) continue;
    rest -= count * scale.value;

    if (count === 1) {
      parts.push(scale.one);
    } else {
      parts.push(`${spellBelowThousand(count, scale.invariable)} ${scale.many}`);
    }
  }

  if (rest) parts.push(spellBelowThousand(rest));
  return parts.join(" ");
}

/** Singular or plural, since "un euro" and "zéro euro" both take no s. */
const plural = (count, word) => (count >= 2 ? `${word}s` : word);

/**
 * An amount of money in French words, cents included when there are any.
 *
 *   10000    → "dix mille euros"
 *   1587.29  → "mille cinq cent quatre-vingt-sept euros et vingt-neuf centimes"
 *
 * @param {number} amount in euros; rounded to the cent before spelling
 * @returns {string}
 */
export function spellEuros(amount) {
  const cents = Math.round(Math.abs(amount) * 100);
  const euros = Math.floor(cents / 100);
  const remainder = cents % 100;

  const sign = amount < 0 && cents > 0 ? "moins " : "";
  const head = `${sign}${spellInteger(euros)} ${plural(euros, "euro")}`;

  if (!remainder) return head;
  return `${head} et ${spellInteger(remainder)} ${plural(remainder, "centime")}`;
}

/**
 * The version of the tool, in one place.
 *
 * It exists so that a document produced by this application can say which build produced
 * it: a screenshot of a wrong figure is only actionable if one knows what was running.
 * The exported deed prints it in its page footer, the workbook carries it among the
 * assumptions, and the page shows it in the footer.
 *
 * This constant — not package.json — is the source of truth: the page is served as plain
 * ES modules with no build step, and importing JSON from a module still needs an import
 * attribute no browser is guaranteed to honour. A test keeps package.json in step.
 *
 * Bumped once per round of deployed changes.
 */
export const VERSION = "0.2.0";

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
export const VERSION = "0.3.1";

/**
 * What produced the file, spelled out.
 *
 * A version number alone identifies a build to whoever already knows which tool wrote it.
 * An exported workbook or a printed deed travels: it is mailed, filed, opened months later
 * by the other party, and « v0.3.0 » in a footer says nothing to them. Every document this
 * project produces therefore carries the name of the application beside the version, so
 * that a figure questioned later leads back here.
 */
export const APP_NAME = "Prêt à prêter";

/**
 * What the name does not say.
 *
 * A name is what one remembers; it is not what one recognises on a document received from
 * someone else. « Prêt à prêter » alone, in the footer of a deed, could be anything — so the
 * exports print the trade beside the name, once, and the name carries the rest.
 */
export const APP_TAGLINE = "échéancier de prêt entre particuliers";

/** Name, trade and version as one string, the form the exports print. */
export const GENERATED_BY =
  `généré par l'application ${APP_NAME} — ${APP_TAGLINE} — version ${VERSION}`;

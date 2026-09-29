/**
 * Form-type normalization.
 *
 * EDGAR's `form` column is not a clean enum. Three things go wrong with naive
 * string equality, all verified against live data (see promptlog.md):
 *
 *  1. EDGAR renamed forms and never backfilled history. "SC 13G" runs
 *     1994-2021, "SCHEDULE 13G" runs 2025-2026, with zero overlap -- the SEC's
 *     late-2024 structured-data mandate moved 13D/G filings from HTML to XML
 *     and relabelled the submission type at the same time. They are the same
 *     schedule: the new filings declare xmlns=".../edgar/schedule13g", the old
 *     documents title themselves "SCHEDULE 13G (Rule 13d-102)", and some rows
 *     carry one spelling in `form` and the other in `primaryDocDescription`.
 *
 *  2. Retired variants. "10-K405" was the 1996-2002 form for filers checking
 *     the Item 405 box. Apple filed an annual report every year from 1994 to
 *     2025 without a gap, but `form === "10-K"` misses fiscal 1998 and 2001
 *     because those were filed as 10-K405.
 *
 *  3. Amendments are separate values ("10-K/A"). An amendment carries the same
 *     `reportDate` as the filing it corrects, so folding it into the base form
 *     double-counts the period. Amendments are therefore kept distinct and
 *     excluded from a base-form filter unless explicitly requested.
 *
 * Deliberately NOT aliased, because aliasing must join documents that are the
 * same, not documents that merely answer a similar question:
 *
 *   - "NT 10-K" is a notification that the 10-K will be late, not a report.
 *   - "20-F" / "40-F" are annual reports for foreign private issuers and
 *     Canadian filers. Spotify reports in IFRS and euros, not US GAAP and
 *     dollars, so the numbers are not comparable to a 10-K's.
 *   - "10-KSB" / "10-QSB" were the small-business forms under Regulation S-B,
 *     a reduced disclosure regime with fewer years of financials. Different
 *     requirements, so a different document -- unlike 10-K405, which differed
 *     from a 10-K only by a checkbox.
 */

/** Canonical form + whether this particular filing is an amendment. */
export type ParsedForm = {
  /** EDGAR's literal string, preserved so nothing is lost. */
  raw: string;
  /** Canonical base form, amendment suffix removed, aliases applied. */
  base: string;
  /** True when EDGAR's string carried an "/A" amendment suffix. */
  isAmendment: boolean;
  /** Canonical display string: `base` plus "/A" when it is an amendment. */
  canonical: string;
};

/**
 * Base-form aliases: EDGAR spelling -> canonical spelling.
 * Applied after the "/A" suffix is stripped, so one entry covers both the
 * form and its amendment.
 */
const BASE_ALIASES: Record<string, string> = {
  // Beneficial ownership: renamed during the 2024 XML migration.
  "SCHEDULE 13D": "SC 13D",
  "SCHEDULE 13G": "SC 13G",
  // 10-K405 differed from 10-K only by a cover-page checkbox (Item 405 of
  // Regulation S-K, on delinquent Section 16(a) filers). Same document, same
  // accounting; EDGAR encoded the checkbox into the form type until 2003.
  "10-K405": "10-K",
  "10-KSB405": "10-KSB",
};

/**
 * Collapses the whitespace and punctuation variations a human types.
 * "10k" / "10 k" / "10-k" all arrive as "10-K".
 */
function canonicalizeSpelling(input: string): string {
  const upper = input.trim().toUpperCase().replace(/\s+/g, " ");
  // Insert the hyphen EDGAR uses for the numbered report forms when it's missing.
  return upper.replace(/^(\d+)[\s-]?([KQ])(\b|\/|$)/, "$1-$2$3");
}

/** Parses one EDGAR form string into its canonical parts. */
export function parseForm(raw: string): ParsedForm {
  const spelled = canonicalizeSpelling(raw);
  const isAmendment = spelled.endsWith("/A");
  const withoutSuffix = isAmendment ? spelled.slice(0, -2).trim() : spelled;
  const base = BASE_ALIASES[withoutSuffix] ?? withoutSuffix;
  return {
    raw,
    base,
    isAmendment,
    canonical: isAmendment ? `${base}/A` : base,
  };
}

/**
 * Does a filing's form match what the caller asked for?
 *
 * Matching is on the canonical base form. Amendments only match when the
 * caller opts in, or when they asked for the amendment explicitly ("10-K/A").
 */
export function formMatches(
  filingForm: ParsedForm,
  requested: string,
  includeAmendments: boolean,
): boolean {
  const want = parseForm(requested);
  if (filingForm.base !== want.base) return false;
  // "10-K/A" asked for explicitly -> only amendments.
  if (want.isAmendment) return filingForm.isAmendment;
  return includeAmendments || !filingForm.isAmendment;
}

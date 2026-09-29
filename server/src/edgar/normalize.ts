/**
 * Columnar -> row normalization.
 *
 * EDGAR returns filings as parallel arrays, one per field, where row *i* of a
 * filing is element *i* of every array. This module turns that into ordinary
 * objects and nothing else -- it performs no I/O, so it is directly testable.
 */
import type { Filing } from "@quartr/shared";
import { parseForm } from "./forms";

/** The columnar block EDGAR returns, both in `filings.recent` and in each overflow chunk. */
export type FilingsColumns = {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: (0 | 1)[];
  isInlineXBRL: (0 | 1)[];
  primaryDocument: string[];
  primaryDocDescription: string[];
};

export type SubmissionsResponse = {
  cik: string;
  name: string;
  tickers?: string[];
  filings: {
    recent: FilingsColumns;
    /** Older filings, split into separate JSON documents. */
    files: { name: string; filingCount: number; filingFrom: string; filingTo: string }[];
  };
};

/** EDGAR's archive paths use the CIK without zero-padding. */
function archiveCik(cik: string): string {
  return String(Number(cik));
}

/**
 * Builds the links for a filing, and classifies what the primary link points at.
 *
 * Three cases, all observed in live data:
 *
 *  - Most filings name an HTML, PDF or text document: a 10-K, an 8-K, a
 *    prospectus. The link goes to the document itself.
 *
 *  - Structured filings -- Form 3/4/5, 144, the modern Schedule 13D/G -- are
 *    submitted as XML, and `primaryDocument` points at EDGAR's own stylesheet
 *    rendering of it (`xslF345X06/form4.xml`). These are forms, not documents,
 *    and calling them "Document" in a UI is simply wrong.
 *
 *  - Some filings have no primary document at all. Two variants: it is empty
 *    (109 of Apple's 1,249 pre-2015 filings), or it is a `.paper` placeholder
 *    for a filing made on paper rather than electronically. The `.paper` URL
 *    looks valid and even answers HEAD with 200, but a GET returns 404 --
 *    EDGAR's archive is S3-backed and HEAD is not a reliable existence check.
 *    Both cases link to the filing index instead, which does exist.
 */
function buildUrls(cik: string, accessionNumber: string, primaryDocument: string) {
  const bare = accessionNumber.replace(/-/g, "");
  const dir = `https://www.sec.gov/Archives/edgar/data/${archiveCik(cik)}/${bare}`;
  const filingIndexUrl = `${dir}/${accessionNumber}-index.htm`;

  const isPaperPlaceholder = /\.paper$/i.test(primaryDocument);
  if (!primaryDocument || isPaperPlaceholder) {
    return { filingIndexUrl, documentUrl: filingIndexUrl, documentKind: "index" as const };
  }

  // EDGAR puts its stylesheet rendering in a directory prefixed "xsl".
  const isRenderedForm = /^xsl/i.test(primaryDocument.split("/")[0] ?? "");
  return {
    filingIndexUrl,
    documentUrl: `${dir}/${primaryDocument}`,
    documentKind: isRenderedForm ? ("form" as const) : ("document" as const),
  };
}

/** EDGAR uses "" for absent strings; the API contract uses null. */
function orNull(value: string | undefined): string | null {
  return value ? value : null;
}

/**
 * Turns one columnar block into rows.
 *
 * The column arrays are equal-length in every response observed, but this
 * reads the length from `accessionNumber` and indexes defensively so a short
 * column yields null rather than throwing.
 */
export function normalizeFilings(cik: string, columns: FilingsColumns): Filing[] {
  const count = columns.accessionNumber?.length ?? 0;
  const filings: Filing[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const accessionNumber = columns.accessionNumber[i]!;
    const rawForm = columns.form[i] ?? "";
    const parsed = parseForm(rawForm);
    const { documentUrl, filingIndexUrl, documentKind } = buildUrls(
      cik,
      accessionNumber,
      columns.primaryDocument[i] ?? "",
    );

    filings[i] = {
      accessionNumber,
      form: parsed.canonical,
      rawForm,
      isAmendment: parsed.isAmendment,
      filingDate: columns.filingDate[i] ?? "",
      reportDate: orNull(columns.reportDate[i]),
      acceptanceDateTime: orNull(columns.acceptanceDateTime[i]),
      items: orNull(columns.items[i]),
      description: orNull(columns.primaryDocDescription[i]),
      size: columns.size[i] ?? 0,
      isXBRL: columns.isXBRL[i] === 1 || columns.isInlineXBRL[i] === 1,
      documentKind,
      documentUrl,
      filingIndexUrl,
    };
  }

  return filings;
}

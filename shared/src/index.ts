/**
 * Types shared between the server and the web client.
 *
 * These describe the *API contract*. EDGAR's own columnar wire format stays
 * private to the server.
 */

export type Company = {
  /** Zero-padded to 10 digits, as the EDGAR submissions API expects. */
  cik: string;
  ticker: string;
  name: string;
};

export type Filing = {
  /** e.g. "0000320193-25-000079". Unique per filing. */
  accessionNumber: string;
  /** Canonical form, aliases applied: "10-K", "SC 13G/A". */
  form: string;
  /** EDGAR's literal string, e.g. "10-K405" or "SCHEDULE 13G/A". */
  rawForm: string;
  /** True when this filing amends an earlier one. */
  isAmendment: boolean;
  /** ISO date the filing was submitted, "YYYY-MM-DD". */
  filingDate: string;
  /** ISO date of the period covered. Empty for forms with no period. */
  reportDate: string | null;
  /** Full ISO timestamp EDGAR accepted the submission. */
  acceptanceDateTime: string | null;
  /** 8-K item numbers, e.g. "2.02,9.01". Null when not applicable. */
  items: string | null;
  /** EDGAR's description of the primary document, often empty. */
  description: string | null;
  /** Submission size in bytes. */
  size: number;
  isXBRL: boolean;
  /**
   * What `documentUrl` actually points at, so the UI can label the link
   * honestly instead of calling everything a "document":
   *  - "document": a narrative filing (10-K, 8-K, prospectus) as HTML/PDF/text
   *  - "form":     a structured form (Form 4, 144, Schedule 13G) submitted as
   *                XML and rendered by EDGAR's own stylesheet
   *  - "index":    no primary document exists, so this links to the filing's
   *                index page listing whatever was submitted
   */
  documentKind: "document" | "form" | "index";
  /** Direct link to the primary document, or to the index when there is none. */
  documentUrl: string;
  /** Always-valid link to the filing's index page on sec.gov. */
  filingIndexUrl: string;
};

export type FilingsPage = {
  company: Company;
  filings: Filing[];
  page: number;
  pageSize: number;
  /** Total filings matching the current filter. */
  total: number;
  totalPages: number;
  /**
   * True while older filings are still being loaded in the background.
   * `total` may grow while this is true.
   */
  partial: boolean;
  /** Form types this company has actually filed, with counts, for the UI. */
  availableForms: { form: string; count: number }[];
};

export type FormCount = { form: string; count: number };

export type LatestReport = {
  /** Canonical form of the report found, e.g. "10-K" or "20-F". */
  form: string;
  filingDate: string;
  /** Period the report covers, when EDGAR records one. */
  reportDate: string | null;
  accessionNumber: string;
  documentUrl: string;
};

export type CompanySummary = {
  company: Company;
  /** Filings per form type over the trailing 12 months, descending by count. */
  countsByForm: FormCount[];
  /** Total filings in the trailing 12-month window. */
  totalLast12Months: number;
  /** Inclusive window the counts cover, as ISO dates. */
  window: { from: string; to: string };
  /**
   * The company's most recent 10-K, or null if it has never filed one.
   * Foreign private issuers (Spotify) file 20-F instead and will be null here.
   */
  latestTenK: LatestReport | null;
  /**
   * Most recent annual report of any kind (10-K, 20-F or 40-F). Lets the UI
   * show something meaningful when `latestTenK` is null.
   */
  latestAnnualReport: LatestReport | null;
};

export type SummaryResponse = {
  companies: CompanySummary[];
  /** Tickers that could not be summarised, with the reason. */
  errors: { ticker: string; reason: string }[];
};

export * from "./game";

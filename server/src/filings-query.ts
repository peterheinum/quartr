/**
 * Filtering, sorting and pagination over a company's normalized filings.
 *
 * Pure, so the behaviour that matters -- which filings a given query returns
 * and in what order -- is testable without a network or an HTTP server.
 */
import type { Filing, FormCount } from "@quartr/shared";
import { formMatches, parseForm } from "./edgar/forms";

export type FilingsQuery = {
  /** Canonical or raw form types; empty means no form filter. */
  forms: string[];
  includeAmendments: boolean;
  sort: "asc" | "desc";
  page: number;
  pageSize: number;
  /** Inclusive ISO date bounds on filingDate. */
  from: string | null;
  to: string | null;
};

export type FilingsResult = {
  filings: Filing[];
  total: number;
  totalPages: number;
  /** Form types present in the company's filings, with counts, for the UI. */
  availableForms: FormCount[];
};

/**
 * Form types the company has actually filed, most frequent first.
 *
 * Derived from the data rather than hardcoded, because each company has a
 * different vocabulary: Spotify files 20-F and 6-K and has never filed a 10-K
 * or an 8-K, so a fixed list would be wrong for it.
 *
 * Counts ignore the current form filter -- otherwise selecting "10-K" would
 * collapse the list to just 10-K and strand the user -- but they do respect
 * the date range and the amendment toggle, so the numbers match what
 * selecting that form would actually return.
 */
function availableForms(filings: Filing[], query: FilingsQuery): FormCount[] {
  const counts = new Map<string, number>();
  for (const filing of filings) {
    if (!withinDates(filing, query)) continue;
    if (filing.isAmendment && !query.includeAmendments) continue;
    counts.set(filing.form, (counts.get(filing.form) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
}

function withinDates(filing: Filing, query: FilingsQuery): boolean {
  if (query.from && filing.filingDate < query.from) return false;
  if (query.to && filing.filingDate > query.to) return false;
  return true;
}

function matchesForms(filing: Filing, query: FilingsQuery): boolean {
  if (query.forms.length === 0) {
    // No form filter: the amendment toggle still applies.
    return query.includeAmendments || !filing.isAmendment;
  }
  const parsed = parseForm(filing.rawForm);
  return query.forms.some((form) => formMatches(parsed, form, query.includeAmendments));
}

/**
 * Sorts by filing date, breaking ties on accession number so that pagination
 * is stable: without a tiebreak, filings sharing a date could reorder between
 * requests and a row could appear on two pages or on none.
 */
function compare(a: Filing, b: Filing, sort: "asc" | "desc"): number {
  const direction = sort === "asc" ? 1 : -1;
  return (
    direction * (a.filingDate.localeCompare(b.filingDate) ||
      a.accessionNumber.localeCompare(b.accessionNumber))
  );
}

export function queryFilings(filings: Filing[], query: FilingsQuery): FilingsResult {
  const matched = filings.filter(
    (filing) => withinDates(filing, query) && matchesForms(filing, query),
  );
  matched.sort((a, b) => compare(a, b, query.sort));

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const start = (query.page - 1) * query.pageSize;

  return {
    filings: matched.slice(start, start + query.pageSize),
    total,
    totalPages,
    availableForms: availableForms(filings, query),
  };
}

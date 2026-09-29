/**
 * Summary computation: filings per form type over the last 12 months, plus
 * the latest annual report.
 *
 * Pure, so it is testable without network access. The 12-month window is
 * always fully contained in EDGAR's `filings.recent` -- that block holds at
 * least the last 12 months by construction -- so a summary never needs the
 * overflow chunks, even for a filer as prolific as JPMorgan.
 */
import type { Company, CompanySummary, Filing, LatestReport } from "@quartr/shared";

/** Annual reports, in preference order: 10-K, then the foreign equivalents. */
const ANNUAL_FORMS = ["10-K", "20-F", "40-F"] as const;

/** The same calendar day one year earlier, as an ISO date. */
export function twelveMonthsBefore(asOf: Date): string {
  const from = new Date(
    Date.UTC(asOf.getUTCFullYear() - 1, asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  return from.toISOString().slice(0, 10);
}

function toLatestReport(filing: Filing): LatestReport {
  return {
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    documentUrl: filing.documentUrl,
  };
}

/**
 * Most recent filing of a given canonical form, ignoring amendments.
 *
 * Amendments are excluded because a 10-K/A shares its reportDate with the
 * 10-K it corrects; returning the amendment would report the same annual
 * report twice under two different filing dates.
 */
function latestOfForm(filings: Filing[], form: string): Filing | null {
  let best: Filing | null = null;
  for (const filing of filings) {
    if (filing.form !== form || filing.isAmendment) continue;
    if (!best || filing.filingDate > best.filingDate) best = filing;
  }
  return best;
}

export function summarize(
  company: Company,
  filings: Filing[],
  asOf: Date = new Date(),
): CompanySummary {
  const to = asOf.toISOString().slice(0, 10);
  const from = twelveMonthsBefore(asOf);

  // Counts are keyed on the canonical form, so the SC 13G / SCHEDULE 13G
  // rename does not split one form across two rows. Amendments are counted
  // under their own label ("10-K/A") rather than folded into the base form.
  const counts = new Map<string, number>();
  let totalLast12Months = 0;
  for (const filing of filings) {
    if (filing.filingDate < from || filing.filingDate > to) continue;
    counts.set(filing.form, (counts.get(filing.form) ?? 0) + 1);
    totalLast12Months++;
  }

  const countsByForm = [...counts.entries()]
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));

  // The latest annual report is searched across ALL filings, not just the
  // 12-month window: a company that has not filed one recently still has one.
  const tenK = latestOfForm(filings, "10-K");
  let annual: Filing | null = null;
  for (const form of ANNUAL_FORMS) {
    const candidate = latestOfForm(filings, form);
    if (candidate && (!annual || candidate.filingDate > annual.filingDate)) {
      annual = candidate;
    }
  }

  return {
    company,
    countsByForm,
    totalLast12Months,
    window: { from, to },
    latestTenK: tenK ? toLatestReport(tenK) : null,
    latestAnnualReport: annual ? toLatestReport(annual) : null,
  };
}

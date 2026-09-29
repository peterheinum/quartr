import type { SummaryResponse, CompanySummary, FormCount } from "@quartr/shared";

/**
 * SummaryPanel
 * ============
 *
 * Renders a matrix of companies (rows) x SEC form types (columns), showing how
 * many of each form a company filed in the trailing 12 months, plus its total
 * filing count and the date of its most recent 10-K.
 *
 * Column selection: the set of form types is the union across all companies
 * in `result.companies`, ordered by total count (summed across companies)
 * descending, so the busiest forms sit leftmost. Because a single company
 * (e.g. JPMorgan, with ~22,800 424B2 pricing supplements a year) can dominate
 * the column ordering, we cap the number of individual columns at 12 and fold
 * everything past that into a single "Other" column, whose `title` attribute
 * lists the folded-in form names so the detail isn't lost, just collapsed.
 *
 * The "Latest 10-K" column is the part of this table that looks like it could
 * be a bug but isn't: some companies are foreign private issuers (Spotify,
 * incorporated in Luxembourg) and are permitted to file an annual report on
 * Form 20-F (or 40-F for Canadian filers) instead of a 10-K. For those
 * companies `latestTenK` is legitimately `null` forever - not "not yet
 * fetched," not "error." We show that state explicitly, with a note pointing
 * at whatever annual report *was* found (`latestAnnualReport`), rather than
 * rendering blank as if the data were missing.
 *
 * Zero-valued cells are rendered as a muted middot rather than "0": in a
 * matrix this wide (up to 12 form columns + Other) a grid of zeros next to a
 * handful of real numbers is much harder to scan than sparse dots with the
 * real values standing out.
 */

const MAX_FORM_COLUMNS = 12;

type SummaryPanelProps = {
  result: SummaryResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRemove: (ticker: string) => void;
  onSelectCompany: (ticker: string) => void;
};

/** Look up a company's count for a given form, or 0 if it never filed it. */
function countFor(company: CompanySummary, form: string): number {
  const entry = company.countsByForm.find((c) => c.form === form);
  return entry ? entry.count : 0;
}

/** Render a count cell: muted dot for zero, tabular numeral otherwise. */
function CountCell({ count }: { count: number }) {
  if (count === 0) {
    return (
      <td className="num muted" aria-label="0">
        &middot;
      </td>
    );
  }
  return <td className="num">{count.toLocaleString('en-US')}</td>;
}

function LatestTenKCell({ company }: { company: CompanySummary }) {
  const { latestTenK, latestAnnualReport } = company;

  if (latestTenK) {
    return (
      <td className="date">
        <a href={latestTenK.documentUrl} target="_blank" rel="noopener noreferrer">
          {latestTenK.filingDate}
        </a>
      </td>
    );
  }

  if (latestAnnualReport) {
    return (
      <td
        className="date latest-annual"
        title="Foreign private issuers file Form 20-F (or 40-F for Canadian filers) in place of a 10-K."
      >
        <div>&mdash;</div>
        <div className="muted fallback">
          No 10-K &middot; files {latestAnnualReport.form}{" "}
          <a
            href={latestAnnualReport.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {latestAnnualReport.filingDate}
          </a>
        </div>
      </td>
    );
  }

  return (
    <td className="date latest-annual">
      <span className="muted">&mdash; No annual report</span>
    </td>
  );
}

export function SummaryPanel({
  result,
  loading,
  refreshing,
  error,
  onRemove,
  onSelectCompany,
}: SummaryPanelProps) {
  if (error) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Summary</h2>
        </div>
        <div className="notice error">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Summary</h2>
        </div>
        <div className="empty">Loading summary&hellip;</div>
      </div>
    );
  }

  const companies = result?.companies ?? [];
  const errors = result?.errors ?? [];

  if (companies.length === 0 && errors.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Summary</h2>
        </div>
        <div className="empty">Add a company above to see its filing summary.</div>
      </div>
    );
  }

  // Union of form types across companies, with totals, to pick/order columns.
  const totalsByForm = new Map<string, number>();
  for (const company of companies) {
    for (const fc of company.countsByForm) {
      totalsByForm.set(fc.form, (totalsByForm.get(fc.form) ?? 0) + fc.count);
    }
  }
  const orderedForms: FormCount[] = Array.from(totalsByForm.entries())
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count);

  const visibleForms = orderedForms.slice(0, MAX_FORM_COLUMNS);
  const overflowForms = orderedForms.slice(MAX_FORM_COLUMNS);
  const hasOverflow = overflowForms.length > 0;
  const overflowTitle = hasOverflow
    ? `Other forms: ${overflowForms.map((f) => f.form).join(", ")}`
    : undefined;

  const window = companies[0]?.window;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Summary</h2>
        {window && (
          <span className="muted">
            {window.from} to {window.to}
          </span>
        )}
        {refreshing && <span className="spinner-text">Refreshing&hellip;</span>}
      </div>

      {errors.length > 0 && (
        <div className="notice error">
          Could not summarise: {errors.map((e) => `${e.ticker} (${e.reason})`).join(", ")}
        </div>
      )}

      {companies.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Company</th>
                {visibleForms.map((f) => (
                  <th scope="col" className="num" key={f.form} title={f.form}>
                    {f.form}
                  </th>
                ))}
                {hasOverflow && (
                  <th scope="col" className="num" title={overflowTitle}>
                    Other
                  </th>
                )}
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">Latest 10-K</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((summary) => {
                const { company } = summary;
                const overflowCount = overflowForms.reduce(
                  (sum, f) => sum + countFor(summary, f.form),
                  0,
                );
                return (
                  <tr key={company.ticker}>
                    <th scope="row">
                      {/* The remove control sits beside the company rather
                          than in a trailing column: this table scrolls
                          horizontally for filers with many form types, and a
                          last-column control is invisible until you scroll. */}
                      <button
                        type="button"
                        className="remove"
                        aria-label={`Remove ${company.ticker} from summary`}
                        title={`Remove ${company.ticker} from the summary`}
                        onClick={() => onRemove(company.ticker)}
                      >
                        &times;
                      </button>{" "}
                      {company.name}{" "}
                      <button
                        type="button"
                        title={`Show ${company.ticker} filings above`}
                        onClick={() => onSelectCompany(company.ticker)}
                      >
                        {company.ticker}
                      </button>
                    </th>
                    {visibleForms.map((f) => (
                      <CountCell key={f.form} count={countFor(summary, f.form)} />
                    ))}
                    {hasOverflow && <CountCell count={overflowCount} />}
                    <td className="num">{summary.totalLast12Months.toLocaleString('en-US')}</td>
                    <LatestTenKCell company={summary} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import type { FilingsPage, Filing } from "@quartr/shared";

/**
 * Renders a single company's filings as a paginated, sortable table.
 *
 * This component is purely presentational: it owns no state of its own and
 * defers all sorting/paging decisions to the parent via `onSortChange` /
 * `onPageChange`. It handles four mutually exclusive states (error, initial
 * loading, empty result, and the happy path with rows), plus two overlays
 * that can appear on top of the happy path: a "partial" banner while EDGAR
 * backfill is still streaming in for high-volume filers, and a lightweight
 * "Refreshing…" indicator while a background refetch is in flight.
 */

type FilingsTableProps = {
  result: FilingsPage | null;
  loading: boolean; // first load, nothing to show yet
  refreshing: boolean; // refetching with data already on screen
  error: string | null;
  sort: "asc" | "desc";
  page: number;
  pageSize: number;
  onSortChange: (sort: "asc" | "desc") => void;
  onPageChange: (page: number) => void;
};

/** Formats a byte count as a human-readable size, e.g. "9.4 MB", "12 KB". */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

/** How each kind of primary link is described to the reader. */
const LINK_LABELS: Record<Filing["documentKind"], { label: string; title: string }> = {
  document: {
    label: "Document",
    title: "Opens the filed document on sec.gov",
  },
  form: {
    label: "Form",
    title:
      "This filing is a structured form submitted as XML (e.g. Form 4, Schedule 13G). " +
      "Opens EDGAR's rendering of it on sec.gov.",
  },
  index: {
    label: "Index",
    title:
      "This filing has no primary document — it predates EDGAR tracking one, or was " +
      "filed on paper. Opens the filing's index page on sec.gov.",
  },
};

function FilingRow({ filing }: { filing: Filing }) {
  // The raw form is shown alongside the canonical one because EDGAR uses
  // legacy/inconsistent literal strings (e.g. "10-K405") that we normalize
  // for filtering/display; surfacing the original avoids hiding information.
  const showRawForm = filing.rawForm !== filing.form;
  // The server classifies what the link actually points at. A Form 4 or a
  // Schedule 13G is a structured form EDGAR renders from XML, not a document,
  // and labelling every link "Document" misdescribes most of a typical list.
  const link = LINK_LABELS[filing.documentKind];

  return (
    <tr key={filing.accessionNumber}>
      <td>
        <span className={filing.isAmendment ? "tag muted" : "tag"}>{filing.form}</span>
        {showRawForm && <span className="raw-form">({filing.rawForm})</span>}
      </td>
      <td className="date">{filing.filingDate}</td>
      <td className="date">{filing.reportDate ?? "—"}</td>
      <td>
        {filing.description ?? "—"}
        {filing.items !== null && (
          <div className="muted" style={{ fontSize: 12 }}>
            {filing.items}
          </div>
        )}
      </td>
      <td className="num">{formatSize(filing.size)}</td>
      <td>
        <a href={filing.documentUrl} target="_blank" rel="noopener noreferrer" title={link.title}>
          {link.label}
        </a>
      </td>
    </tr>
  );
}

export function FilingsTable({
  result,
  loading,
  refreshing,
  error,
  sort,
  page,
  pageSize,
  onSortChange,
  onPageChange,
}: FilingsTableProps) {
  if (error) {
    return (
      <div className="panel-body">
        <div className="notice error">{error}</div>
      </div>
    );
  }

  if (loading) {
    return <div className="empty">Loading filings…</div>;
  }

  if (!result) {
    return null;
  }

  if (result.filings.length === 0) {
    return <div className="empty">No filings match these filters. Try widening the form or date range.</div>;
  }

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, result.total);

  return (
    <>
      {result.partial && (
        <div className="panel-body">
          <div className="notice info">
            Still loading older filings — {result.total.toLocaleString('en-US')} loaded so far. This list refreshes
            automatically as more arrive.
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Form</th>
              <th className="sortable date">
                <button
                  type="button"
                  onClick={() => onSortChange(sort === "desc" ? "asc" : "desc")}
                  aria-label={`Sort by filed date, ${sort === "desc" ? "ascending" : "descending"}`}
                >
                  Filed {sort === "desc" ? "▼" : "▲"}
                </button>
              </th>
              <th className="date">Period</th>
              <th>Description</th>
              <th className="num">Size</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {result.filings.map((filing) => (
              <FilingRow key={filing.accessionNumber} filing={filing} />
            ))}
          </tbody>
        </table>
      </div>

      {result.total > 0 && (
        <div className="pagination">
          <span>
            Showing {rangeStart.toLocaleString('en-US')}–{rangeEnd.toLocaleString('en-US')} of {result.total.toLocaleString('en-US')}
          </span>
          <div className="spacer" />
          {refreshing && <span className="spinner-text">Refreshing…</span>}
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {result.totalPages}
          </span>
          <button type="button" disabled={page >= result.totalPages} onClick={() => onPageChange(page + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

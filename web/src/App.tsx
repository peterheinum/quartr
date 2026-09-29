/**
 * Application shell: owns all query state and wires the three panels together.
 *
 * The state that determines what is on screen lives in the address bar (see
 * urlState.ts), so a filtered view is shareable and the back button works.
 * The components below stay presentational.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FilingsPage, SummaryResponse } from "@quartr/shared";
import { fetchFilings, fetchSummary } from "./api";
import { useFetch } from "./useFetch";
import { CallIt } from "./components/CallIt";
import { Controls } from "./components/Controls";
import { FilingsTable } from "./components/FilingsTable";
import { SummaryPanel } from "./components/SummaryPanel";
import { useUrlState } from "./urlState";

const PAGE_SIZE = 25;

type View = "filings" | "call-it";

/** Which screen is showing, kept in the URL hash so it survives a reload and works with the back button. */
function useView(): [View, (next: View) => void] {
  const read = (): View => (window.location.hash === "#/call-it" ? "call-it" : "filings");
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const change = useCallback((next: View) => {
    if (next === "call-it") {
      window.location.hash = "/call-it";
    } else {
      // Drop the hash without a page jump; hashchange does not fire for pushState, so set the view directly.
      window.history.pushState(null, "", window.location.pathname + window.location.search);
      setView("filings");
    }
  }, []);
  return [view, change];
}

export function App() {
  const [view, setView] = useView();
  return (
    <>
      <nav className={view === "call-it" ? "tabs dark" : "tabs"} aria-label="Sections">
        <div className="tabs-inner">
          <button className="tab" aria-current={view === "filings" ? "page" : undefined} onClick={() => setView("filings")}>Filings</button>
          <button className="tab" aria-current={view === "call-it" ? "page" : undefined} onClick={() => setView("call-it")}>Call It</button>
        </div>
      </nav>
      {view === "call-it" ? (
        // The game has its own night-mode look (game.css), scoped to .arcade-page.
        <div className="arcade-page">
          <div className="app">
            <CallIt />
          </div>
        </div>
      ) : (
        <FilingsView />
      )}
    </>
  );
}

function FilingsView() {
  const [query, update] = useUrlState();
  const { ticker, forms, includeAmendments, sort, page, summaryTickers } = query;

  const filings = useFetch<FilingsPage>(
    (signal) =>
      fetchFilings({ ticker, forms, includeAmendments, sort, page, pageSize: PAGE_SIZE }, signal),
    [ticker, forms.join(","), includeAmendments, sort, page],
    // Keep polling while the server is still backfilling older filings.
    useCallback((data: FilingsPage) => data.partial, []),
  );

  const summary = useFetch<SummaryResponse>(
    (signal) => (summaryTickers.length > 0 ? fetchSummary(summaryTickers, signal) : Promise.resolve({ companies: [], errors: [] })),
    [summaryTickers.join(",")],
  );

  /** Changing any filter resets to page 1; staying on page 9 of a new, shorter
   *  result set would show an empty table for no visible reason. Switching
   *  company also clears the form filter, since form types are per company. */
  const changeCompany = useCallback(
    (next: string) => update({ ticker: next.toUpperCase(), forms: [], page: 1 }),
    [update],
  );
  const changeForms = useCallback(
    (next: string[]) => update({ forms: next, page: 1 }),
    [update],
  );
  const changeAmendments = useCallback(
    (next: boolean) => update({ includeAmendments: next, page: 1 }),
    [update],
  );
  const changeSort = useCallback(
    (next: "asc" | "desc") => update({ sort: next, page: 1 }),
    [update],
  );
  const changePage = useCallback((next: number) => update({ page: next }), [update]);

  const addToSummary = useCallback(
    (next: string) => {
      const upper = next.toUpperCase();
      if (summaryTickers.includes(upper)) return;
      update({ summaryTickers: [...summaryTickers, upper] });
    },
    [summaryTickers, update],
  );
  const removeFromSummary = useCallback(
    (next: string) => update({ summaryTickers: summaryTickers.filter((t) => t !== next) }),
    [summaryTickers, update],
  );

  const availableForms = useMemo(() => filings.data?.availableForms ?? [], [filings.data]);

  return (
    <div className="app">
      <header>
        <h1>EDGAR Filings</h1>
        <p className="subtitle">
          Filing history for any of the 8,049 companies that file with the SEC, from the
          EDGAR submissions API.
        </p>
      </header>

      <section>
        <h2>Filings</h2>
        <div className="panel">
          <div className="panel-header">
            <Controls
              ticker={ticker}
              company={filings.data?.company ?? null}
              availableForms={availableForms}
              selectedForms={forms}
              includeAmendments={includeAmendments}
              onCompanyChange={changeCompany}
              onFormsChange={changeForms}
              onIncludeAmendmentsChange={changeAmendments}
              onAddToSummary={addToSummary}
              inSummary={summaryTickers.includes(ticker)}
            />
          </div>
          <FilingsTable
            result={filings.data}
            loading={filings.loading}
            refreshing={filings.refreshing}
            error={filings.error}
            sort={sort}
            page={page}
            pageSize={PAGE_SIZE}
            onSortChange={changeSort}
            onPageChange={changePage}
          />
        </div>
      </section>

      <section>
        <h2>Summary — last 12 months</h2>
        <SummaryPanel
          result={summary.data}
          loading={summary.loading}
          refreshing={summary.refreshing}
          error={summary.error}
          onRemove={removeFromSummary}
          onSelectCompany={changeCompany}
        />
      </section>
    </div>
  );
}

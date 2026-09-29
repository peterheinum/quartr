/**
 * Query state kept in the address bar.
 *
 * Everything that determines what is on screen -- the company, the form
 * filters, the sort direction, the page, and the companies in the summary --
 * lives in the URL rather than in component state alone. That makes a
 * filtered view shareable, bookmarkable, and reachable with the back button,
 * and it survives a reload.
 *
 * Parsing and serialising are pure functions so the behaviour that matters
 * (what a given URL means, and what a given state serialises to) is testable
 * without a browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AppQuery = {
  ticker: string;
  forms: string[];
  includeAmendments: boolean;
  sort: "asc" | "desc";
  page: number;
  /** Companies shown in the summary panel. */
  summaryTickers: string[];
};

/**
 * Opens on a domestic filer, a foreign private issuer with no 10-K, and a
 * very high-volume filer -- the three cases the UI has to handle differently.
 */
export const DEFAULT_QUERY: AppQuery = {
  ticker: "AAPL",
  forms: [],
  includeAmendments: false,
  sort: "desc",
  page: 1,
  summaryTickers: ["AAPL", "SPOT", "JPM"],
};

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Reads a query string into state.
 *
 * Anything malformed falls back to the default rather than throwing: a URL is
 * user input, and a bad one should still render the app.
 */
export function parseQuery(search: string): AppQuery {
  const params = new URLSearchParams(search);

  const page = Number(params.get("page"));
  const sort = params.get("sort");
  const amendments = params.get("amendments");
  const summary = params.get("summary");

  return {
    ticker: (params.get("ticker") ?? DEFAULT_QUERY.ticker).trim().toUpperCase() ||
      DEFAULT_QUERY.ticker,
    forms: parseList(params.get("form")),
    includeAmendments: amendments === "1" || amendments === "true",
    sort: sort === "asc" || sort === "desc" ? sort : DEFAULT_QUERY.sort,
    page: Number.isInteger(page) && page >= 1 ? page : DEFAULT_QUERY.page,
    // An explicit empty value means "no companies", which is distinct from
    // the parameter being absent and therefore defaulted.
    summaryTickers: summary === null ? DEFAULT_QUERY.summaryTickers : parseList(summary),
  };
}

/**
 * Serialises state back to a query string, omitting anything at its default
 * so that the common case is a clean URL rather than a wall of parameters.
 */
export function serializeQuery(query: AppQuery): string {
  const params = new URLSearchParams();

  if (query.ticker !== DEFAULT_QUERY.ticker) params.set("ticker", query.ticker);
  if (query.forms.length > 0) params.set("form", query.forms.join(","));
  if (query.includeAmendments) params.set("amendments", "1");
  if (query.sort !== DEFAULT_QUERY.sort) params.set("sort", query.sort);
  if (query.page !== DEFAULT_QUERY.page) params.set("page", String(query.page));

  const summaryChanged =
    query.summaryTickers.length !== DEFAULT_QUERY.summaryTickers.length ||
    query.summaryTickers.some((t, i) => t !== DEFAULT_QUERY.summaryTickers[i]);
  if (summaryChanged) params.set("summary", query.summaryTickers.join(","));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * Binds `AppQuery` to the address bar.
 *
 * Each update pushes a history entry, because every one of them is a
 * deliberate user action -- picking a company, toggling a filter, turning a
 * page -- and the back button should undo it.
 */
export function useUrlState(): [AppQuery, (patch: Partial<AppQuery>) => void] {
  const [query, setQuery] = useState<AppQuery>(() =>
    parseQuery(typeof window === "undefined" ? "" : window.location.search),
  );

  // The first sync replaces rather than pushes, so that normalising a
  // hand-typed URL does not leave a dead entry behind the user's first Back.
  const isFirstSync = useRef(true);

  useEffect(() => {
    const onPopState = () => setQuery(parseQuery(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const search = serializeQuery(query);
    if (search === window.location.search) {
      isFirstSync.current = false;
      return;
    }
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (isFirstSync.current) {
      window.history.replaceState(null, "", url);
      isFirstSync.current = false;
    } else {
      window.history.pushState(null, "", url);
    }
  }, [query]);

  const update = useCallback((patch: Partial<AppQuery>) => {
    setQuery((previous) => ({ ...previous, ...patch }));
  }, []);

  return [query, update];
}

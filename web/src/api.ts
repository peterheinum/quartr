/**
 * Typed client for the EDGAR API.
 *
 * Requests go to /api/*, which Vite proxies to the server in development, so
 * the frontend never needs an absolute URL or CORS handling.
 */
import type { Company, FilingsPage, SummaryResponse } from "@quartr/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const query = params.toString();
  const response = await fetch(`/api${path}${query ? `?${query}` : ""}`, { signal });
  if (!response.ok) {
    // The server returns { error } for every failure, but a proxy or a crash
    // could return something else, so fall back to the status text.
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? response.statusText, response.status);
  }
  return response.json() as Promise<T>;
}

export type FilingsParams = {
  ticker: string;
  forms: string[];
  includeAmendments: boolean;
  sort: "asc" | "desc";
  page: number;
  pageSize: number;
};

export function fetchFilings(
  { ticker, forms, includeAmendments, sort, page, pageSize }: FilingsParams,
  signal?: AbortSignal,
): Promise<FilingsPage> {
  const params = new URLSearchParams({
    sort,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (forms.length > 0) params.set("form", forms.join(","));
  if (includeAmendments) params.set("includeAmendments", "true");
  return get<FilingsPage>(
    `/companies/${encodeURIComponent(ticker)}/filings`,
    params,
    signal,
  );
}

export function fetchSummary(tickers: string[], signal?: AbortSignal): Promise<SummaryResponse> {
  return get<SummaryResponse>(
    "/filings/summary",
    new URLSearchParams({ tickers: tickers.join(",") }),
    signal,
  );
}

export function searchCompanies(query: string, signal?: AbortSignal): Promise<{ companies: Company[] }> {
  return get<{ companies: Company[] }>(
    "/companies",
    new URLSearchParams({ q: query, limit: "8" }),
    signal,
  );
}

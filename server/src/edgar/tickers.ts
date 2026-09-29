/**
 * Ticker -> CIK resolution.
 *
 * EDGAR's submissions API is keyed by CIK, not ticker, so we resolve through
 * company_tickers.json. That file is ~10k entries and changes rarely, so we
 * fetch it once and keep it in memory behind a TTL.
 */
import type { Company } from "@quartr/shared";
import { edgarFetch } from "./client";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const TTL_MS = 24 * 60 * 60 * 1000;

/** Shape of company_tickers.json: an object keyed by array-index-as-string. */
type TickerFileEntry = { cik_str: number; ticker: string; title: string };
type TickerFile = Record<string, TickerFileEntry>;

let cache: { at: number; byTicker: Map<string, Company> } | null = null;
let inFlight: Promise<Map<string, Company>> | null = null;

/** EDGAR wants CIK as 10 digits, zero-padded: 320193 -> "0000320193". */
export function padCik(cik: number | string): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/** Tickers are matched case-insensitively; EDGAR uses "-" where some feeds use ".". */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

async function loadTickerMap(): Promise<Map<string, Company>> {
  const raw = await edgarFetch<TickerFile>(TICKERS_URL);
  const byTicker = new Map<string, Company>();
  for (const entry of Object.values(raw)) {
    if (!entry?.ticker) continue;
    byTicker.set(normalizeTicker(entry.ticker), {
      cik: padCik(entry.cik_str),
      ticker: entry.ticker.toUpperCase(),
      name: entry.title,
    });
  }
  return byTicker;
}

async function getTickerMap(): Promise<Map<string, Company>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byTicker;
  // Collapse concurrent cold-start callers onto one upstream request.
  inFlight ??= loadTickerMap()
    .then((byTicker) => {
      cache = { at: Date.now(), byTicker };
      return byTicker;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Returns null when the ticker isn't in EDGAR's list. */
export async function resolveTicker(ticker: string): Promise<Company | null> {
  const map = await getTickerMap();
  return map.get(normalizeTicker(ticker)) ?? null;
}

/** Substring search over ticker and company name, for the UI's company picker. */
export async function searchCompanies(query: string, limit = 10): Promise<Company[]> {
  const map = await getTickerMap();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact: Company[] = [];
  const partial: Company[] = [];
  for (const company of map.values()) {
    if (company.ticker.toLowerCase() === q) exact.push(company);
    else if (
      company.ticker.toLowerCase().startsWith(q) ||
      company.name.toLowerCase().includes(q)
    ) {
      partial.push(company);
    }
    if (exact.length + partial.length > 500) break;
  }
  return [...exact, ...partial].slice(0, limit);
}

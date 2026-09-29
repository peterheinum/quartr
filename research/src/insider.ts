/** Insider-trade events and their forward returns. */
import type { Bar } from "./prices";

export interface InsiderRow {
  acc: string;
  filed: string; // YYYY-MM-DD, the day the Form 4 became public
  tradeDate: string;
  cik: string;
  ticker: string;
  insider: string;
  rel: string;
  title: string;
  code: "P" | "S";
  shares: number;
  value: number;
  plan: boolean; // sale made under a pre-arranged Rule 10b5-1 plan
}

export interface Event {
  cik: string;
  ticker: string;
  code: "P" | "S";
  /** Filing date of the first row in the cluster: when the market could first know. */
  date: string;
  /** Distinct insiders trading in the cluster window. */
  insiders: number;
  value: number;
  /** Average price per share across the cluster, from the filings themselves. */
  avgPrice: number;
  /** True when any officer (not just a director) is in the cluster. */
  officer: boolean;
  tradeDate: string;
}

const dayMs = 864e5;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);

/**
 * Collapse rows into one event per issuer per `gapDays`: the first filing starts a cluster,
 * every later row of the same code within `gapDays` of the cluster start joins it, and the
 * next row after that starts a new cluster. Independent enough to count as separate observations.
 */
export function clusterEvents(rows: InsiderRow[], code: "P" | "S", gapDays = 90): Event[] {
  const byIssuer = new Map<string, InsiderRow[]>();
  for (const r of rows) if (r.code === code) byIssuer.set(r.cik, [...(byIssuer.get(r.cik) ?? []), r]);
  const events: Event[] = [];
  for (const list of byIssuer.values()) {
    list.sort((a, b) => a.filed.localeCompare(b.filed) || a.acc.localeCompare(b.acc));
    let i = 0;
    while (i < list.length) {
      const start = list[i]!;
      const group = [start];
      let j = i + 1;
      while (j < list.length && daysBetween(start.filed, list[j]!.filed) <= gapDays) group.push(list[j++]!);
      const shares = group.reduce((s, r) => s + r.shares, 0);
      const value = group.reduce((s, r) => s + r.value, 0);
      events.push({
        cik: start.cik, ticker: start.ticker, code, date: start.filed,
        insiders: new Set(group.map((r) => r.insider)).size, value, avgPrice: value / shares,
        officer: group.some((r) => r.rel.includes("Officer")), tradeDate: start.tradeDate,
      });
      i = j;
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Forward {
  entry: Bar;
  /** Trading-day offset -> {stock return, excess over benchmark} in percent. */
  byOffset: Record<number, { ret: number; excess: number } | null>;
}

/**
 * Returns measured from the close of the first trading day strictly AFTER `filed`.
 * A Form 4 can be filed after the close, so the filing day's own close is not a price
 * anyone could have traded on knowing the filing; entering a day later avoids look-ahead.
 * Offsets are trading days from that entry bar. Null where the data does not reach.
 */
export function forwardReturns(bars: Bar[], bench: Bar[], filed: string, offsets: number[]): Forward | null {
  const i = bars.findIndex((b) => b.date > filed);
  if (i < 0) return null;
  const entry = bars[i]!;
  const bi = bench.findIndex((b) => b.date === entry.date);
  if (bi < 0) return null;
  const byOffset: Forward["byOffset"] = {};
  for (const k of offsets) {
    const b = bars[i + k], m = bench[bi + k];
    if (!b || !m || b.date !== m.date) { byOffset[k] = null; continue; }
    const ret = (b.close / entry.close - 1) * 100;
    byOffset[k] = { ret, excess: ret - (m.close / bench[bi]!.close - 1) * 100 };
  }
  return { entry, byOffset };
}

const SPLIT_FACTORS = [2, 3, 4, 5, 10, 20];

/**
 * Whether a Form 4 trade price is plausibly the same stock as Yahoo's close for that ticker and day.
 * Yahoo's closes are adjusted for later splits, Form 4 prices are not, so a clean split factor
 * (2:1, 1:10, ...) also counts. A ticker reused by a different company will usually fail both.
 */
export function priceMatches(tradePrice: number, yahooClose: number): boolean {
  if (!(tradePrice > 0) || !(yahooClose > 0)) return false;
  const r = tradePrice / yahooClose;
  if (Math.abs(r - 1) <= 0.25) return true;
  return SPLIT_FACTORS.some((k) => Math.abs(r / k - 1) <= 0.08 || Math.abs(r * k - 1) <= 0.08);
}

/** Symbols that can be looked up: rejects free-text junk like "NYSE: N" or "N/A". */
export function isPlausibleTicker(t: string): boolean {
  return /^[A-Z]{1,5}([.-][A-Z])?$/.test(t);
}

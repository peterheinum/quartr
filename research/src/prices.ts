/**
 * Stock prices around a filing date.
 *
 * Reference point is the close on the last trading day *before* the filing
 * date: it is the last price that could not yet reflect the filing, whether it
 * landed pre-market or after the close. Every return is measured from it.
 */

export interface Bar {
  date: string; // YYYY-MM-DD, exchange-local
  close: number;
  // Present on bars from Yahoo; optional so tests can build minimal bars.
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface PricePoint {
  label: string;
  date: string;
  close: number;
  /** Return vs. the reference close, in percent. */
  returnPct: number;
}

export interface FilingWindow {
  filingDate: string;
  reference: Bar | null;
  points: PricePoint[];
  /** Horizons that fall after the last bar we have, so cannot be computed yet. */
  missing: string[];
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Index of the first bar on or after `date`, or -1. `bars` must be ascending. */
function firstOnOrAfter(bars: Bar[], date: string): number {
  return bars.findIndex((b) => b.date >= date);
}

export function windowAroundFiling(bars: Bar[], filingDate: string): FilingWindow {
  const day0 = firstOnOrAfter(bars, filingDate);
  const last = bars[bars.length - 1]?.date ?? "";
  if (day0 < 1) {
    return { filingDate, reference: null, points: [], missing: ["all"] };
  }
  const reference = bars[day0 - 1]!;

  const targets: { label: string; bar: Bar | undefined; needs: string }[] = [
    { label: "-5d", bar: bars[day0 - 6], needs: "" },
    { label: "0d", bar: bars[day0], needs: "" },
    { label: "+5d", bar: bars[day0 + 5], needs: "" },
    { label: "+30d", bar: bars[firstOnOrAfter(bars, addDays(filingDate, 30))], needs: addDays(filingDate, 30) },
    { label: "+6m", bar: bars[firstOnOrAfter(bars, addMonths(filingDate, 6))], needs: addMonths(filingDate, 6) },
  ];

  const points: PricePoint[] = [];
  const missing: string[] = [];
  for (const t of targets) {
    if (!t.bar || (t.needs && t.needs > last)) {
      missing.push(t.label);
      continue;
    }
    points.push({
      label: t.label,
      date: t.bar.date,
      close: t.bar.close,
      returnPct: ((t.bar.close - reference.close) / reference.close) * 100,
    });
  }
  return { filingDate, reference, points, missing };
}

/** Daily bars from Yahoo's public chart endpoint (no key needed). */
export async function fetchDailyBars(symbol: string, from: string, to: string): Promise<Bar[]> {
  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: ${res.status}`);
  const json = (await res.json()) as any;
  const r = json.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${symbol}: no data`);
  const tz = r.meta?.exchangeTimezoneName ?? "America/New_York";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const q = r.indicators.quote[0];
  const bars: Bar[] = [];
  r.timestamp.forEach((ts: number, i: number) => {
    const close: number | null = q.close[i];
    if (close == null) return;
    bars.push({
      date: fmt.format(new Date(ts * 1000)),
      close,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      volume: q.volume[i],
    });
  });
  return bars;
}

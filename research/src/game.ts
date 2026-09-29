/** Pure helpers for building "Call It" rounds. No I/O. */
import type { Bar } from "./prices";
import type { Candle, Pair, Pick } from "../../shared/src/game";
import type { TurnoverFlags } from "./turnover";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Simple moving average of the `period` closes ending at index `i` (inclusive), or null with too little history. */
export function smaAt(closes: number[], i: number, period = 200): number | null {
  if (i < period - 1) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += closes[k]!;
  return sum / period;
}

/** A bar as a candle rebased to `base` = 100. A bar without open/high/low degrades to a flat candle at its close. */
export function candleOf(b: Bar, base: number): Candle {
  const c = b.close;
  const r = (v: number) => round2((v / base) * 100);
  return [r(b.open ?? c), r(b.high ?? c), r(b.low ?? c), r(c)];
}

export interface PriceWindow {
  before: Pair;
  sma200: (number | null)[];
  after: Pair;
  answer: Pick;
  /** Stock return minus SPY return over the horizon, percent. */
  excess: number;
  /** Percent above/below the 200-day SMA on the decision day. */
  distFromSma: number;
  /** Date of the decision-day bar. */
  decisionDate: string;
}

/**
 * The price story around one event, from the last close on or before `eventDate` (the decision day).
 *
 * `before` holds `beforeDays` candles ending on the decision day and `after` the next `horizon`,
 * for the stock and for SPY, each rebased to 100 at its own decision-day close. Everything in
 * `before` and the moving average uses only data up to the decision day, so showing it to a player
 * leaks nothing about the outcome. Returns null when the history, the horizon or the benchmark's
 * dates do not line up.
 */
export function buildPriceWindow(bars: Bar[], spy: Bar[], eventDate: string, beforeDays = 90, horizon = 21): PriceWindow | null {
  let i = -1;
  for (let k = 0; k < bars.length && bars[k]!.date <= eventDate; k++) i = k;
  if (i < 199 || i < beforeDays - 1 || i + horizon >= bars.length) return null;

  const closes = bars.map((b) => b.close);
  const spyByDate = new Map(spy.map((b) => [b.date, b]));
  const start = i - beforeDays + 1;

  // Every day in the window needs a matching benchmark bar, or the two panels would not line up.
  const window = bars.slice(start, i + horizon + 1);
  const spyWindow = window.map((b) => spyByDate.get(b.date));
  if (spyWindow.some((s) => s == null)) return null;

  const base = closes[i]!;
  const spyBase = spyByDate.get(bars[i]!.date)!.close;
  const cut = beforeDays; // index in `window` of the first "after" bar
  const stockC = window.map((b) => candleOf(b, base));
  const spyC = spyWindow.map((b) => candleOf(b!, spyBase));

  const stockRet = (closes[i + horizon]! / base - 1) * 100;
  const spyRet = (spyByDate.get(bars[i + horizon]!.date)!.close / spyBase - 1) * 100;
  const sma = smaAt(closes, i)!;
  return {
    before: { stock: stockC.slice(0, cut), spy: spyC.slice(0, cut) },
    sma200: closes.slice(start, i + 1).map((_, k) => {
      const s = smaAt(closes, start + k);
      return s == null ? null : round2((s / base) * 100);
    }),
    after: { stock: stockC.slice(cut), spy: spyC.slice(cut) },
    answer: stockRet > spyRet ? "beat" : "lag",
    excess: round2(stockRet - spyRet),
    distFromSma: ((base - sma) / sma) * 100,
    decisionDate: bars[i]!.date,
  };
}

// --- The signals that play alongside the human. Each is a one-line rule, on purpose. ---

/** Above its 200-day average: expect it to keep beating the market. */
export const trendBot = (distFromSma: number): Pick => (distFromSma > 0 ? "beat" : "lag");

/** A 10-K more positive in tone than the company's own norm: expect it to beat. */
export const toneBot = (toneVsOwnAverage: number): Pick => (toneVsOwnAverage > 0 ? "beat" : "lag");

/** Insiders buying: beat. Insiders selling: lag. */
export const insiderBot = (code: "P" | "S"): Pick => (code === "P" ? "beat" : "lag");

/** Any top executive leaving: lag. Otherwise (only appointments): beat. */
export const turnoverBot = (f: TurnoverFlags): Pick => (f.ceoOut || f.cfoOut ? "lag" : "beat");

// --- Wording for the facts panel: describe, never name. ---

export function describeTrend(dist: number): string {
  const pct = Math.abs(dist).toFixed(0);
  if (Math.abs(dist) < 1) return "about at its 200-day average";
  return dist > 0 ? `${pct}% above its 200-day average` : `${pct}% below its 200-day average`;
}

export function describeFed(rate: number, change12m: number): string {
  const regime = change12m > 0.5 ? "raising rates" : change12m < -0.5 ? "cutting rates" : "holding rates";
  return `Fed ${regime} (target ${rate.toFixed(2)}%, ${change12m >= 0 ? "+" : ""}${change12m.toFixed(2)} pts over 12 months)`;
}

export function describeTone(toneRel: number): string {
  if (Math.abs(toneRel) < 0.15) return "about the company's usual tone";
  return toneRel > 0 ? "more positive than the company's usual tone" : "more negative than the company's usual tone";
}

export function describeMoney(usd: number): string {
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${Math.round(usd / 1e3)}k`;
}

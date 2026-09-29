/**
 * Returns around executive-turnover 8-Ks at the 30 companies.
 * Per event: (1) a 2-day reaction window [close before the filing date -> close of the next trading day],
 * (2) forward drift from the close after that, at 1w/1m/3m/6m/1y. All excess over SPY.
 * Control: random other dates for the same company, away from any Item 5.02 filing.
 */
import { readFileSync } from "node:fs";
import type { Bar } from "../src/prices";
import { forwardReturns } from "../src/insider";
import { mean } from "../src/stats";
import type { TurnoverFlags } from "../src/turnover";

interface Ev { ticker: string; filed: string; flags: TurnoverFlags }
const all = JSON.parse(readFileSync(".data/turnover/events.json", "utf8")) as Ev[];
const OFFSETS = [5, 21, 63, 126, 252];
const LABEL: Record<number, string> = { 5: "1w", 21: "1m", 63: "3m", 126: "6m", 252: "1y" };
const CONTROLS = 6;

const cache = new Map<string, Bar[]>();
const bars = (t: string) => cache.get(t) ?? (cache.set(t, JSON.parse(readFileSync(`.data/prices/${t}.json`, "utf8"))), cache.get(t)!);
const spy = bars("SPY");

let seed = 20260928;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

/** Excess return of `bars` over SPY from the close before `date` to the close of the next trading day. */
function reaction(b: Bar[], date: string): number | null {
  const i = b.findIndex((x) => x.date >= date);
  if (i < 1 || i + 1 >= b.length) return null;
  const s0 = spy.find((x) => x.date === b[i - 1]!.date), s1 = spy.find((x) => x.date === b[i + 1]!.date);
  if (!s0 || !s1) return null;
  return (b[i + 1]!.close / b[i - 1]!.close - 1) * 100 - (s1.close / s0.close - 1) * 100;
}

interface Row { reaction: number | null; fwd: Record<number, number | null> }
function measure(b: Bar[], date: string): Row | null {
  const f = forwardReturns(b, spy, date, OFFSETS);
  if (!f) return null;
  return { reaction: reaction(b, date), fwd: Object.fromEntries(OFFSETS.map((k) => [k, f.byOffset[k]?.excess ?? null])) };
}

/** One event per company per `gap` days, so a multi-filing announcement counts once. */
function cluster(evs: Ev[], gapDays = 45): Ev[] {
  const out: Ev[] = [];
  for (const e of [...evs].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.filed.localeCompare(b.filed))) {
    const last = out.at(-1);
    if (last && last.ticker === e.ticker && Date.parse(e.filed) - Date.parse(last.filed) <= gapDays * 864e5) continue;
    out.push(e);
  }
  return out;
}

const filingDates = new Map<string, number[]>();
for (const e of all) filingDates.set(e.ticker, [...(filingDates.get(e.ticker) ?? []), Date.parse(e.filed)]);
function controlFor(ticker: string): Row[] {
  const b = bars(ticker), dates = filingDates.get(ticker) ?? [];
  const cands = b.map((_, i) => i).filter((i) => b[i]!.date >= "2016-06-01" && dates.every((d) => Math.abs(d - Date.parse(b[i]!.date)) > 14 * 864e5));
  return Array.from({ length: CONTROLS }, () => measure(b, b[pick(cands)]!.date)).filter((r): r is Row => r != null);
}

const groups: [string, (f: TurnoverFlags) => boolean][] = [
  ["CEO leaves", (f) => f.ceoOut],
  ["CEO appointed", (f) => f.ceoIn],
  ["CFO leaves", (f) => f.cfoOut],
  ["CFO appointed", (f) => f.cfoIn],
  ["CEO or CFO, any change", (f) => f.ceoOut || f.ceoIn || f.cfoOut || f.cfoIn],
  ["Other officer leaves", (f) => f.officerOut && !f.ceoOut && !f.cfoOut],
  ["Director leaves", (f) => f.directorOut && !f.ceoOut && !f.cfoOut && !f.officerOut],
];

const f1 = (x: number | null) => (x == null ? "  n/a" : (x >= 0 ? "+" : "") + x.toFixed(1)).padStart(6);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
console.log("Excess return vs SPY, percent. 'diff' = event minus the same company's random other dates (mean of 6 per event).");
console.log("group".padEnd(24) + "n".padStart(4) + "  window   mean  median  %>SPY  |  control    diff   t(diff)");
for (const [name, pred] of groups) {
  const evs = cluster(all.filter((e) => pred(e.flags)));
  const rows = evs.map((e) => ({ e, r: measure(bars(e.ticker), e.filed), c: controlFor(e.ticker) })).filter((x) => x.r);
  const windows: [string, (r: Row) => number | null][] = [["2d reaction", (r) => r.reaction], ...OFFSETS.map((k): [string, (r: Row) => number | null] => [LABEL[k]!, (r) => r.fwd[k]!])];
  for (const [label, get] of windows) {
    const pairs = rows.map((x) => {
      const v = get(x.r!);
      const cv = x.c.map(get).filter((z): z is number => z != null);
      return v == null || !cv.length ? null : { v, c: mean(cv) };
    }).filter((p): p is { v: number; c: number } => p != null);
    if (pairs.length < 8) continue;
    const d = pairs.map((p) => p.v - p.c), m = mean(d);
    const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1)) / Math.sqrt(d.length);
    const v = pairs.map((p) => p.v);
    console.log(
      (label === "2d reaction" ? name : "").padEnd(24) + (label === "2d reaction" ? String(rows.length) : "").padStart(4) + "  " + label.padEnd(9) +
      f1(mean(v)) + f1(median(v)) + `${((v.filter((x) => x > 0).length / v.length) * 100).toFixed(0)}%`.padStart(7) + "  |" +
      f1(mean(pairs.map((p) => p.c))) + f1(m) + (m / se).toFixed(1).padStart(8),
    );
  }
  console.log();
}

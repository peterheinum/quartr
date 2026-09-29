/**
 * Do insider purchases / discretionary sales at the ~30 large companies we follow predict returns?
 * Each event's excess-over-SPY return is compared with two controls: random other dates for the
 * SAME ticker, and the OTHER large companies on the SAME date.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Bar } from "../src/prices";
import { clusterEvents, forwardReturns, isPlausibleTicker, priceMatches, type Event, type InsiderRow } from "../src/insider";
import { clusteredMean, mean } from "../src/stats";

const DIR = ".data/insider";
const OFFSETS = [5, 21, 63, 126, 252];
const LABEL: Record<number, string> = { 5: "1w", 21: "1m", 63: "3m", 126: "6m", 252: "1y" };
const CONTROLS_PER_EVENT = 5;

// Universe: the companies whose 10-Ks we scored. Prices are the ones already downloaded for them.
const CORE = new Set(readFileSync(".data/corpus/scores.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).ticker as string));
const rows = readFileSync(`${DIR}/events.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as InsiderRow);
const events = [...clusterEvents(rows, "P"), ...clusterEvents(rows.filter((r) => !r.plan), "S")].filter((e) => CORE.has(e.ticker));
const anyEventDates = new Map<string, number[]>();
for (const r of rows) anyEventDates.set(r.ticker, [...(anyEventDates.get(r.ticker) ?? []), Date.parse(r.filed)]);

const load = (t: string): Bar[] | null => {
  const f = `.data/prices/${t}.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Bar[]) : null;
};
const spy = load("SPY")!;

// Seeded RNG so the control draws are reproducible.
let seed = 987654321;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

// Same-date control: the other large companies.
const pool = new Map<string, Bar[]>();
for (const t of CORE) { const b = load(t); if (b) pool.set(t, b); }
const poolTickers = [...pool.keys()];

// --- accounting: where do events go? ---
const loss = { total: events.length, badTicker: 0, noPrices: 0, priceMismatch: 0, usable: 0 };
interface Res { e: Event; ex: Record<number, number | null>; ctlTicker: Record<number, number | null>; ctlPeers: Record<number, number | null> }
const results: Res[] = [];
const byTicker = new Map<string, Event[]>();
for (const e of events) {
  if (!isPlausibleTicker(e.ticker)) { loss.badTicker++; continue; }
  if (!pool.has(e.ticker)) { loss.noPrices++; continue; }
  byTicker.set(e.ticker, [...(byTicker.get(e.ticker) ?? []), e]);
}
for (const [ticker, evs] of byTicker) {
  const b = pool.get(ticker)!;
  const evDates = anyEventDates.get(ticker) ?? [];
  // Control days for this ticker: at least 90 days from any insider trade in it.
  const cands: number[] = [];
  for (let i = 0; i < b.length - 1; i++) {
    const t = Date.parse(b[i]!.date);
    if (b[i]!.date >= "2016-01-01" && evDates.every((d) => Math.abs(d - t) > 90 * 864e5)) cands.push(i);
  }
  for (const e of evs) {
    // Close on the last bar at or before the trade date vs the price the insider actually paid.
    const td = e.tradeDate || e.date;
    let k = -1;
    for (let i = 0; i < b.length && b[i]!.date <= td; i++) k = i;
    if (k < 0 || !priceMatches(e.avgPrice, b[k]!.close)) { loss.priceMismatch++; continue; }
    const f = forwardReturns(b, spy, e.date, OFFSETS);
    if (!f) continue;
    loss.usable++;
    const ex: Res["ex"] = {}, ctlTicker: Res["ctlTicker"] = {}, ctlPeers: Res["ctlPeers"] = {};
    const own = cands.length ? Array.from({ length: CONTROLS_PER_EVENT }, () => pick(cands)) : [];
    const peers = Array.from({ length: CONTROLS_PER_EVENT }, () => pick(poolTickers)).filter((t) => t !== ticker);
    for (const off of OFFSETS) {
      ex[off] = f.byOffset[off]?.excess ?? null;
      const a = own.map((i) => forwardReturns(b, spy, b[i]!.date, [off])?.byOffset[off]?.excess).filter((v): v is number => v != null);
      const c = peers.map((t) => forwardReturns(pool.get(t)!, spy, e.date, [off])?.byOffset[off]?.excess).filter((v): v is number => v != null);
      ctlTicker[off] = a.length ? mean(a) : null;
      ctlPeers[off] = c.length ? mean(c) : null;
    }
    results.push({ e, ex, ctlTicker, ctlPeers });
  }
}
console.log("event accounting:", loss, `| tickers with events: ${byTicker.size}, peer pool ${pool.size}`);

// Winsorize each horizon at its 1st/99th percentile: a few glitchy or micro-cap prices otherwise dominate every mean.
const bounds: Record<number, [number, number]> = {};
for (const off of OFFSETS) {
  const all = results.flatMap((r) => [r.ex[off], r.ctlTicker[off], r.ctlPeers[off]]).filter((v): v is number => v != null).sort((a, b) => a - b);
  bounds[off] = [all[Math.floor(all.length * 0.01)]!, all[Math.floor(all.length * 0.99)]!];
}
const clip = (v: number, off: number) => Math.min(bounds[off]![1], Math.max(bounds[off]![0], v));
console.log("winsorization bounds (1st/99th pct, excess %):", Object.fromEntries(OFFSETS.map((o) => [LABEL[o], bounds[o]!.map((x) => +x.toFixed(0))])));
console.log(`events with a forward window: ${results.length}
`);

const groups: [string, (e: Event) => boolean][] = [
  ["BUY  all clusters", (e) => e.code === "P"],
  ["BUY  >=2 insiders", (e) => e.code === "P" && e.insiders >= 2],
  ["BUY  officer involved", (e) => e.code === "P" && e.officer],
  ["BUY  >= $250k", (e) => e.code === "P" && e.value >= 250_000],
  ["BUY  price >= $10", (e) => e.code === "P" && e.avgPrice >= 10],
  ["BUY  price < $5", (e) => e.code === "P" && e.avgPrice < 5],
  ["SELL unplanned, all", (e) => e.code === "S"],
  ["SELL price >= $10", (e) => e.code === "S" && e.avgPrice >= 10],
  ["SELL unplanned >= $1M", (e) => e.code === "S" && e.value >= 1e6],
  ["SELL unplanned, officer", (e) => e.code === "S" && e.officer],
];
const f1 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(1);
console.log("Excess return vs SPY, winsorized. Two controls, each subtracted per event: (A) same ticker on random other dates; (B) other stocks on the SAME date.");
console.log("t is clustered by filing month.");
console.log("group".padEnd(24) + "hor".padStart(4) + "      n  mean  median  %>SPY |  vs A (t)      vs B (t)");
for (const [name, pred] of groups) {
  for (const off of OFFSETS) {
    const r = results.filter((x) => pred(x.e) && x.ex[off] != null && x.ctlTicker[off] != null && x.ctlPeers[off] != null);
    if (r.length < 30) continue;
    const raw = r.map((x) => clip(x.ex[off]!, off));
    const months = r.map((x) => x.e.date.slice(0, 7));
    const A = clusteredMean(r.map((x, i) => raw[i]! - clip(x.ctlTicker[off]!, off)), months);
    const B = clusteredMean(r.map((x, i) => raw[i]! - clip(x.ctlPeers[off]!, off)), months);
    const med = [...raw].sort((a, b) => a - b)[Math.floor(raw.length / 2)]!;
    console.log(
      name.padEnd(24) + LABEL[off]!.padStart(4) + String(r.length).padStart(7) + f1(mean(raw)).padStart(6) + f1(med).padStart(8) +
      `${((raw.filter((v) => v > 0).length / raw.length) * 100).toFixed(0)}%`.padStart(8) + " |" + `${f1(A.mean)} (${A.t.toFixed(1)})`.padStart(13) + `${f1(B.mean)} (${B.t.toFixed(1)})`.padStart(14),
    );
  }
  console.log();
}

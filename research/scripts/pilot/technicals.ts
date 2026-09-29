/** Does distance from the 200-day SMA add to tone in explaining post-filing returns? */
import { readFileSync } from "node:fs";
import type { Bar } from "../../src/prices";
import { windowAroundFiling } from "../../src/prices";
import { distanceFromSma } from "../../src/technical";
import { looR2, mean, ols, pearson } from "../../src/stats";

const rows = JSON.parse(readFileSync(".data/sentiment.json", "utf8")) as {
  ticker: string; filed: string; netTone: number; excess: Record<string, number | null>;
}[];
const bars = new Map<string, Bar[]>();
const get = (t: string) => bars.get(t) ?? (bars.set(t, JSON.parse(readFileSync(`.data/prices/${t}.json`, "utf8"))), bars.get(t)!);

// Tone relative to the company's own average removes 10-K vs 20-F house style.
const byCo = new Map<string, number[]>();
rows.forEach((r) => byCo.set(r.ticker, [...(byCo.get(r.ticker) ?? []), r.netTone]));
const data = rows.map((r) => {
  const ref = windowAroundFiling(get(r.ticker), r.filed).reference!;
  return { ...r, dist: distanceFromSma(get(r.ticker), ref.date)!, toneRel: (r.netTone - mean(byCo.get(r.ticker)!)) * 100 };
});

console.log("ticker filed       dist from SMA200   toneRel(x100)");
for (const d of data) console.log(`${d.ticker.padEnd(5)} ${d.filed}  ${(d.dist >= 0 ? "+" : "") + d.dist.toFixed(1).padStart(6)}%        ${(d.toneRel >= 0 ? "+" : "") + d.toneRel.toFixed(2)}`);

const models: [string, (d: (typeof data)[number]) => number[]][] = [
  ["tone", (d) => [d.toneRel]],
  ["trend (dist)", (d) => [d.dist]],
  ["tone + trend", (d) => [d.toneRel, d.dist]],
  ["tone + trend + tone*trend", (d) => [d.toneRel, d.dist, d.toneRel * d.dist]],
];
for (const h of ["0d", "+5d", "+30d", "+6m"]) {
  const set = data.filter((d) => d.excess[h] != null);
  const y = set.map((d) => d.excess[h]!);
  console.log(`\n=== excess return at ${h}  (n=${set.length}) ===`);
  console.log(`corr(tone,y)=${pearson(set.map((d) => d.toneRel), y).toFixed(2)}  corr(dist,y)=${pearson(set.map((d) => d.dist), y).toFixed(2)}`);
  console.log("model                        R2    adjR2   leave-one-out R2");
  for (const [name, f] of models) {
    const X = set.map(f);
    const fit = ols(X, y);
    console.log(`${name.padEnd(27)} ${fit.r2.toFixed(2).padStart(5)}  ${fit.adjR2.toFixed(2).padStart(6)}   ${looR2(X, y).toFixed(2).padStart(6)}`);
  }
}

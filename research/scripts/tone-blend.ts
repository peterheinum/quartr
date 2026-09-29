/**
 * Blend 10-K tone, SMA200 distance and Fed tone into one score.
 * Weights are searched on a grid. The honest number is walk-forward: for each
 * test year, weights are chosen only from filings whose outcome was already
 * known before that year began.
 */
import { HORIZONS, loadObservations, type Horizon, type Obs } from "../src/dataset";
import { mean, pearson, pValue } from "../src/stats";

const { obs } = loadObservations();
const HORIZON_DAYS: Record<Horizon, number> = { "0d": 1, "+5d": 8, "+30d": 30, "+6m": 183 };
const SIGNALS = ["tone", "trend", "fed"] as const;
const raw = (o: Obs) => [o.toneRel, o.dist, o.fedTone];
const GRID = [-1, -0.5, 0, 0.5, 1];
const weights: number[][] = [];
for (const a of GRID) for (const b of GRID) for (const c of GRID) if (a || b || c) weights.push([a, b, c]);

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const stats = (rows: Obs[]) => [0, 1, 2].map((i) => {
  const v = rows.map((o) => raw(o)[i]!), m = mean(v);
  return { m, sd: Math.sqrt(mean(v.map((x) => (x - m) ** 2))) };
});
const score = (o: Obs, w: number[], st: ReturnType<typeof stats>) => raw(o).reduce((s, v, i) => s + w[i]! * ((v - st[i]!.m) / st[i]!.sd), 0);
const fmtW = (w: number[]) => `(${w.map((x) => (x >= 0 ? "+" : "") + x.toFixed(1)).join(" ")})`;

function bestWeights(train: Obs[], h: Horizon): number[] {
  const st = stats(train), y = train.map((o) => o.excess[h]!);
  let best = weights[0]!, bestR = -Infinity;
  for (const w of weights) {
    const r = pearson(train.map((o) => score(o, w, st)), y);
    if (r > bestR) [best, bestR] = [w, r];
  }
  return best;
}

const fixed: [string, number[]][] = [["equal (1,1,1)", [1, 1, 1]], ["10-K tone only", [1, 0, 0]], ["trend only", [0, 1, 0]], ["Fed tone only", [0, 0, 1]]];
const years = [...new Set(obs.map((o) => o.filed.slice(0, 4)))].sort().filter((y) => y >= "2019");

interface Pred { s: number; y: number }
const stat = (preds: Pred[]) => {
  const r = pearson(preds.map((p) => p.s), preds.map((p) => p.y));
  const hit = preds.filter((p) => Math.sign(p.s) === Math.sign(p.y)).length / preds.length;
  const sorted = [...preds].sort((a, b) => a.s - b.s), k = Math.floor(preds.length / 3);
  const spread = mean(sorted.slice(-k).map((p) => p.y)) - mean(sorted.slice(0, k).map((p) => p.y));
  return { r, p: pValue(r, preds.length), hit, spread, n: preds.length };
};
const row = (name: string, s: ReturnType<typeof stat>) =>
  `  ${name.padEnd(30)} r ${(s.r >= 0 ? "+" : "") + s.r.toFixed(3)} (p ${s.p.toFixed(2)})  hit ${(s.hit * 100).toFixed(0)}%  top-vs-bottom third ${(s.spread >= 0 ? "+" : "") + s.spread.toFixed(1)}pp  n=${s.n}`;

for (const h of HORIZONS) {
  const usable = obs.filter((o) => o.excess[h] != null);
  const base = usable.filter((o) => o.excess[h]! > 0).length / usable.length;
  console.log(`\n=== ${h} (n=${usable.length}; ${(base * 100).toFixed(0)}% of filings beat SPY) ===`);

  // In-sample: best weights over everything. Optimistic by construction.
  const wAll = bestWeights(usable, h), stAll = stats(usable);
  console.log(row(`IN-SAMPLE best ${fmtW(wAll)}`, stat(usable.map((o) => ({ s: score(o, wAll, stAll), y: o.excess[h]! })))));

  // Walk-forward.
  const wf: Pred[] = [], chosen: string[] = [], fixedPreds = fixed.map(() => [] as Pred[]);
  for (const yr of years) {
    const start = `${yr}-01-01`;
    const train = usable.filter((o) => addDays(o.filed, HORIZON_DAYS[h]) <= start);
    const test = usable.filter((o) => o.filed.startsWith(yr));
    if (train.length < 60 || !test.length) continue;
    const w = bestWeights(train, h), st = stats(train);
    chosen.push(`${yr}${fmtW(w)}`);
    test.forEach((o) => wf.push({ s: score(o, w, st), y: o.excess[h]! }));
    fixed.forEach(([, fw], i) => test.forEach((o) => fixedPreds[i]!.push({ s: score(o, fw, st), y: o.excess[h]! })));
  }
  console.log(row("WALK-FORWARD (tuned weights)", stat(wf)));
  fixed.forEach(([name], i) => console.log(row("  baseline: " + name, stat(fixedPreds[i]!))));
  console.log(`  weights picked each year (tone trend fed): ${chosen.join(" ")}`);
}
console.log(`\nsignals: ${SIGNALS.join(", ")}; weight grid ${GRID.join(",")} per signal (${weights.length} combos); walk-forward test years ${years[0]}-${years.at(-1)}`);

/**
 * Corpus analysis: does 10-K tone, alone or with trend (SMA200) and Fed backdrop,
 * explain returns in excess of SPY after the filing?
 */
import { HORIZONS, loadObservations, type Obs } from "../src/dataset";
import { looR2, mean, ols, pearson, pValue, spearman } from "../src/stats";

const { obs, scored, dropped } = loadObservations();
console.log(`filings scored ${scored}, dropped as exhibit-wrapper 10-Ks (${dropped}); ${obs.length} observations across ${new Set(obs.map((o) => o.ticker)).size} companies, ${obs.map((o) => o.filed).sort()[0]} -> ${obs.map((o) => o.filed).sort().at(-1)}`);

const features: [string, (o: Obs) => number | null][] = [
  ["10-K tone vs own avg", (o) => o.toneRel],
  ["10-K tone change YoY", (o) => o.dTone],
  ["dist from SMA200 (%)", (o) => o.dist],
  ["Fed statement tone", (o) => o.fedTone],
  ["Fed tone change", (o) => o.fedDTone],
  ["Fed rate level (%)", (o) => o.rate],
  ["Fed rate 12m change", (o) => o.rate12m],
];

console.log("\n=== single feature vs excess-over-SPY return: Pearson r (p) ===");
console.log("feature".padEnd(24) + HORIZONS.map((h) => h.padStart(16)).join(""));
for (const [name, f] of features) {
  const cells = HORIZONS.map((h) => {
    const pts = obs.filter((o) => f(o) != null && o.excess[h] != null);
    const x = pts.map((o) => f(o)!), y = pts.map((o) => o.excess[h]!);
    const r = pearson(x, y);
    return `${r >= 0 ? "+" : ""}${r.toFixed(2)} (${pValue(r, pts.length).toFixed(2)})`.padStart(16);
  });
  console.log(name.padEnd(24) + cells.join(""));
}

const z = (a: number[]) => { const m = mean(a), sd = Math.sqrt(mean(a.map((v) => (v - m) ** 2))); return (v: number) => (v - m) / sd; };
const zTone = z(obs.map((o) => o.toneRel)), zDist = z(obs.map((o) => o.dist)), zR = z(obs.map((o) => o.rate12m)), zF = z(obs.map((o) => o.fedTone));
const models: [string, (o: Obs) => number[]][] = [
  ["tone", (o) => [zTone(o.toneRel)]],
  ["tone + trend", (o) => [zTone(o.toneRel), zDist(o.dist)]],
  ["tone + trend + Fed rate12m", (o) => [zTone(o.toneRel), zDist(o.dist), zR(o.rate12m)]],
  ["tone + trend + Fed tone", (o) => [zTone(o.toneRel), zDist(o.dist), zF(o.fedTone)]],
  ["all four", (o) => [zTone(o.toneRel), zDist(o.dist), zR(o.rate12m), zF(o.fedTone)]],
  ["all four + tone*trend + tone*rate", (o) => [zTone(o.toneRel), zDist(o.dist), zR(o.rate12m), zF(o.fedTone), zTone(o.toneRel) * zDist(o.dist), zTone(o.toneRel) * zR(o.rate12m)]],
];
console.log("\n=== models: in-sample R2 / adjusted R2 / leave-one-out R2 (out-of-sample; <=0 means no better than the mean) ===");
for (const h of HORIZONS) {
  const set = obs.filter((o) => o.excess[h] != null);
  const y = set.map((o) => o.excess[h]!);
  console.log(`\n${h} (n=${set.length})`);
  for (const [name, f] of models) {
    const X = set.map(f), fit = ols(X, y);
    console.log(`  ${name.padEnd(36)} R2 ${fit.r2.toFixed(3)}  adj ${fit.adjR2.toFixed(3)}  LOO ${looR2(X, y).toFixed(3)}`);
  }
}

console.log("\n=== does the Fed regime change what tone tells you? corr(10-K tone, excess return) by regime ===");
const regimes: [string, (o: Obs) => boolean][] = [
  ["hiking  (12m change > +0.5pp)", (o) => o.rate12m > 0.5],
  ["flat    (within +/-0.5pp)", (o) => Math.abs(o.rate12m) <= 0.5],
  ["easing  (12m change < -0.5pp)", (o) => o.rate12m < -0.5],
];
console.log("regime".padEnd(32) + "     n" + HORIZONS.map((h) => h.padStart(16)).join(""));
for (const [name, f] of regimes) {
  const sub = obs.filter(f);
  const cells = HORIZONS.map((h) => {
    const pts = sub.filter((o) => o.excess[h] != null);
    const r = pearson(pts.map((o) => o.toneRel), pts.map((o) => o.excess[h]!));
    return `${r >= 0 ? "+" : ""}${r.toFixed(2)} (${pValue(r, pts.length).toFixed(2)})`.padStart(16);
  });
  console.log(name.padEnd(32) + String(sub.length).padStart(6) + cells.join(""));
}
console.log(`\nSpearman check, tone vs excess: ${HORIZONS.map((h) => { const p = obs.filter((o) => o.excess[h] != null); return h + " " + spearman(p.map((o) => o.toneRel), p.map((o) => o.excess[h]!)).toFixed(2); }).join("  ")}`);

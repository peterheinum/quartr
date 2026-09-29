/** Scores downloaded filings with Loughran-McDonald and correlates tone with returns. */
import { readFileSync, writeFileSync } from "node:fs";
import { htmlToText, loadDictionary, scoreText } from "../../src/sentiment";
import { windowAroundFiling, type Bar } from "../../src/prices";
import { mean, pearson, pValue, spearman } from "../../src/stats";

const dict = loadDictionary();
const manifest = JSON.parse(readFileSync(".data/filings/manifest.json", "utf8")) as {
  ticker: string; form: string; filingDate: string; file: string;
}[];
const bars = (t: string) => JSON.parse(readFileSync(`.data/prices/${t}.json`, "utf8")) as Bar[];
const spy = bars("SPY");
const HORIZONS = ["0d", "+5d", "+30d", "+6m"];

interface Row {
  ticker: string; form: string; filed: string; words: number;
  negPct: number; posPct: number; uncPct: number; netTone: number;
  dNet: number | null; dNeg: number | null;
  raw: Record<string, number | null>; excess: Record<string, number | null>;
  topNeg: [string, number][];
}
const rows: Row[] = [];
for (const m of manifest.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.filingDate.localeCompare(b.filingDate))) {
  const s = scoreText(htmlToText(readFileSync(`.data/filings/${m.file}`, "utf8")), dict);
  const w = windowAroundFiling(bars(m.ticker), m.filingDate);
  const b = windowAroundFiling(spy, m.filingDate);
  const raw: Row["raw"] = {}, excess: Row["excess"] = {};
  for (const h of HORIZONS) {
    const p = w.points.find((x) => x.label === h)?.returnPct;
    const q = b.points.find((x) => x.label === h)?.returnPct;
    raw[h] = p ?? null;
    excess[h] = p != null && q != null ? p - q : null;
  }
  const prev = rows.filter((r) => r.ticker === m.ticker).at(-1);
  rows.push({
    ticker: m.ticker, form: m.form, filed: m.filingDate, words: s.words,
    negPct: s.pct.Negative, posPct: s.pct.Positive, uncPct: s.pct.Uncertainty, netTone: s.netTone,
    dNet: prev ? s.netTone - prev.netTone : null, dNeg: prev ? s.pct.Negative - prev.negPct : null,
    raw, excess, topNeg: s.top.Negative,
  });
}
writeFileSync(".data/sentiment.json", JSON.stringify(rows, null, 2));

console.log("ticker filed       words   neg%  pos%  unc%  netTone  dNet    | excess vs SPY: " + HORIZONS.join("   "));
for (const r of rows) {
  const f = (v: number | null, d = 2) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(d));
  console.log(
    `${r.ticker.padEnd(5)} ${r.filed} ${String(r.words).padStart(7)} ${r.negPct.toFixed(2).padStart(5)} ${r.posPct.toFixed(2).padStart(5)} ${r.uncPct.toFixed(2).padStart(5)} ${f(r.netTone, 3).padStart(8)} ${f(r.dNet, 3).padStart(7)} | ${HORIZONS.map((h) => f(r.excess[h], 1).padStart(6)).join(" ")}`,
  );
}

// --- correlation ---
function report(title: string, xKey: "netTone" | "negPct" | "dNet" | "dNeg", set: Row[]) {
  console.log(`\n${title}  (x = ${xKey})`);
  console.log("horizon   n   pearson  p     spearman   same-sign");
  for (const h of HORIZONS) {
    const pts = set.filter((r) => r[xKey] != null && r.excess[h] != null);
    const x = pts.map((r) => r[xKey] as number), y = pts.map((r) => r.excess[h] as number);
    if (pts.length < 4) continue;
    const r = pearson(x, y);
    // For negPct/dNeg, "good" tone is *lower*, so flip the sign to ask "did better tone -> better return".
    const dir = xKey === "negPct" || xKey === "dNeg" ? -1 : 1;
    const hit = pts.filter((_, i) => Math.sign(dir * (x[i]! - mean(x))) === Math.sign(y[i]!)).length;
    console.log(`${h.padEnd(6)} ${String(pts.length).padStart(4)}  ${r.toFixed(2).padStart(7)}  ${pValue(r, pts.length).toFixed(2)}  ${spearman(x, y).toFixed(2).padStart(7)}     ${hit}/${pts.length}`);
  }
}
report("ALL filings, level of tone vs excess return", "netTone", rows);
report("ALL filings, level of negative words vs excess return", "negPct", rows);
report("Year-over-year CHANGE in tone within each company vs excess return", "dNet", rows);
report("Year-over-year CHANGE in negative words vs excess return", "dNeg", rows);

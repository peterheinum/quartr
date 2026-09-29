/** Downloads daily prices and computes the windows around each downloaded filing. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fetchDailyBars, windowAroundFiling } from "../../src/prices";

const manifest = JSON.parse(readFileSync(".data/filings/manifest.json", "utf8")) as {
  ticker: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
}[];

// 200 trading days is ~290 calendar days; 400 leaves room for holidays and a 200-day MA warm-up.
const LOOKBACK_DAYS = 400;
const BENCHMARK = "SPY";
const tickers = [...new Set(manifest.map((m) => m.ticker)), BENCHMARK];
const today = new Date().toISOString().slice(0, 10);
mkdirSync(".data/prices", { recursive: true });

const out: unknown[] = [];
for (const ticker of tickers) {
  const filings = manifest.filter((m) => m.ticker === ticker);
  // The benchmark needs to cover every filing date, whichever company it belongs to.
  const earliest = manifest.map((f) => f.filingDate).sort()[0]!;
  const from = new Date(new Date(`${earliest}T00:00:00Z`).getTime() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
  const bars = await fetchDailyBars(ticker, from, today);
  writeFileSync(`.data/prices/${ticker}.json`, JSON.stringify(bars));
  console.log(`${ticker}: ${bars.length} bars ${bars[0]!.date} -> ${bars.at(-1)!.date}`);
  for (const f of filings) {
    out.push({ ticker, form: f.form, accession: f.accessionNumber, ...windowAroundFiling(bars, f.filingDate) });
  }
}
writeFileSync(".data/prices/windows.json", JSON.stringify(out, null, 2));

console.log("\nticker form  filed       ref close |   -5d    0d    +5d   +30d   +6m   (% vs ref)");
for (const w of out as any[]) {
  const cell = (l: string) => {
    const p = w.points.find((x: any) => x.label === l);
    return (p ? (p.returnPct >= 0 ? "+" : "") + p.returnPct.toFixed(1) : "  n/a").padStart(6);
  };
  console.log(
    `${w.ticker.padEnd(5)} ${w.form.padEnd(5)} ${w.filingDate} ${String(w.reference?.close.toFixed(2)).padStart(9)} | ${["-5d", "0d", "+5d", "+30d", "+6m"].map(cell).join(" ")}`,
  );
}

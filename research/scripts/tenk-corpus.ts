/**
 * Builds the sentiment corpus: for each company, every original 10-K filed
 * since 2016 (with enough time for a 6-month return), scored with
 * Loughran-McDonald. Only the scores are kept, never the HTML.
 * Resumable: filings already in scores.jsonl are skipped.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { getAllFilings } from "../../server/src/edgar/store";
import { resolveTicker } from "../../server/src/edgar/tickers";
import { edgarFetchText } from "../../server/src/edgar/client";
import { htmlToText, loadDictionary, scoreText } from "../src/sentiment";
import { fetchDailyBars } from "../src/prices";
import { writeFileSync } from "node:fs";

// Domestic 10-K filers only, so form type does not confound the tone comparison.
const TICKERS = [
  "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "JPM", "BAC", "WFC",
  "GS", "XOM", "CVX", "JNJ", "PFE", "MRK", "UNH", "WMT", "COST", "HD",
  "PG", "KO", "PEP", "DIS", "NFLX", "INTC", "CSCO", "ORCL", "CAT", "BA",
];
// A ticker can be re-pointed at a new holding company whose history is short. Exxon's
// history is under its old CIK; `XOM` now resolves to a 2026 holding company with 34 filings.
const CIK_OVERRIDE: Record<string, string> = { XOM: "0000034088" };
const FROM = "2016-01-01";
// A 6-month return needs 6 months of data after the filing.
const TO = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);

mkdirSync(".data/corpus", { recursive: true });
const OUT = ".data/corpus/scores.jsonl";
const done = new Set(
  existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).accession) : [],
);
const dict = loadDictionary();
const failures: string[] = [];

for (const ticker of TICKERS) {
  const resolved = await resolveTicker(ticker);
  if (!resolved) { failures.push(`${ticker}: unknown ticker`); continue; }
  const company = CIK_OVERRIDE[ticker] ? { ...resolved, cik: CIK_OVERRIDE[ticker] } : resolved;
  const all = await getAllFilings(company.cik);
  const tenKs = all.filings.filter(
    (f) => f.form === "10-K" && !f.isAmendment && f.filingDate >= FROM && f.filingDate <= TO,
  );
  let n = 0;
  for (const f of tenKs) {
    if (done.has(f.accessionNumber)) continue;
    if (f.documentKind !== "document") { failures.push(`${ticker} ${f.filingDate}: no primary document`); continue; }
    try {
      const s = scoreText(htmlToText(await edgarFetchText(f.documentUrl)), dict);
      appendFileSync(OUT, JSON.stringify({
        ticker, cik: company.cik, accession: f.accessionNumber, form: f.form, rawForm: f.rawForm,
        filed: f.filingDate, reportDate: f.reportDate, url: f.documentUrl,
        words: s.words, pct: s.pct, netTone: s.netTone,
      }) + "\n");
      n++;
    } catch (e) {
      failures.push(`${ticker} ${f.filingDate}: ${(e as Error).message}`);
    }
  }
  console.log(`${ticker.padEnd(6)} ${String(tenKs.length).padStart(2)} 10-Ks in range, ${n} newly scored (${all.filings.length} filings in history${all.partial ? ", PARTIAL" : ""})`);
}

// Prices for every ticker plus the benchmark, with a 400-day lookback for the SMA200.
const start = new Date(new Date(`${FROM}T00:00:00Z`).getTime() - 400 * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
mkdirSync(".data/prices", { recursive: true });
for (const t of [...TICKERS, "SPY"]) {
  try {
    const bars = await fetchDailyBars(t, start, today);
    writeFileSync(`.data/prices/${t}.json`, JSON.stringify(bars));
  } catch (e) {
    failures.push(`prices ${t}: ${(e as Error).message}`);
  }
}
console.log(`\nfailures (${failures.length}):`);
for (const f of failures) console.log("  " + f);

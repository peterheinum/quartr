/** Classifies every downloaded Item 5.02 section, prints counts, and checks against events known to have happened. */
import { readFileSync, writeFileSync } from "node:fs";
import { classify, classifySentence, sentences, type FlagName } from "../src/turnover";

const rows = readFileSync(".data/turnover/text.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { ticker: string; accession: string; filed: string; section: string | null });
// How each company names itself in prose, so its own CEO can be told from a subsidiary's or another firm's.
const COMPANY: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", AMZN: "Amazon", GOOGL: "Alphabet|Google", META: "Meta|Facebook", NVDA: "NVIDIA", TSLA: "Tesla",
  JPM: "JPMorgan", BAC: "Bank of America", WFC: "Wells Fargo", GS: "Goldman Sachs", XOM: "Exxon", CVX: "Chevron", JNJ: "Johnson",
  PFE: "Pfizer", MRK: "Merck", UNH: "UnitedHealth", WMT: "Walmart|Wal-Mart", COST: "Costco", HD: "Home Depot", PG: "Procter|P&G",
  KO: "Coca-Cola", PEP: "PepsiCo", DIS: "Disney", NFLX: "Netflix", INTC: "Intel", CSCO: "Cisco", ORCL: "Oracle", CAT: "Caterpillar", BA: "Boeing",
};
const events = rows.map((r) => ({ ticker: r.ticker, filed: r.filed, accession: r.accession, flags: classify(r.section, COMPANY[r.ticker]), section: r.section }));
writeFileSync(".data/turnover/events.json", JSON.stringify(events));

const keys = Object.keys(events[0]!.flags) as FlagName[];
console.log("filings", events.length, "| any flag:", events.filter((e) => Object.values(e.flags).some(Boolean)).length, "| no flag:", events.filter((e) => !Object.values(e.flags).some(Boolean)).length);
for (const k of keys) console.log(k.padEnd(13), events.filter((e) => e.flags[k]).length);

/** The sentence that raised `flag`, to judge precision by reading. */
const trigger = (ticker: string, section: string | null, flag: FlagName) => (section ? sentences(section).find((s) => classifySentence(s, COMPANY[ticker]).includes(flag)) : undefined) ?? "";
const show = (flag: FlagName, n: number) => {
  const hits = events.filter((e) => e.flags[flag]);
  console.log(`\n--- ${flag}: ${hits.length} filings; showing ${Math.min(n, hits.length)} ---`);
  for (const e of hits.slice(0, n)) console.log(`${e.ticker.padEnd(5)} ${e.filed}  ${trigger(e.ticker, e.section, flag).replace(/\s+/g, " ").slice(0, 190)}`);
};
const arg = process.argv[2] as FlagName | undefined;
if (arg) show(arg, Number(process.argv[3] ?? 25));

// Recall: events I am confident happened, checked within +/- 10 days of the date.
const known: [string, string, FlagName, string][] = [
  ["INTC", "2024-12-02", "ceoOut", "Gelsinger resigns"],
  ["BA", "2024-03-25", "ceoOut", "Calhoun to step down"],
  ["DIS", "2022-11-20", "ceoIn", "Iger returns as CEO"],
  ["AAPL", "2024-08-26", "cfoOut", "Maestri leaves CFO role"],
  ["AAPL", "2024-08-26", "cfoIn", "Parekh named CFO"],
  ["NFLX", "2023-01-19", "ceoOut", "Hastings steps down as co-CEO"],
  ["UNH", "2025-05-13", "ceoOut", "Witty steps down"],
  ["INTC", "2021-01-13", "ceoIn", "Gelsinger named CEO"],
  ["TSLA", "2023-08-07", "cfoIn", "Taneja named CFO"],
  ["JPM", "2021-05-18", "cfoIn", "Barnum named CFO"],
  ["WFC", "2016-10-12", "ceoOut", "Stumpf retires after sales scandal"],
];
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 10 * 864e5;
console.log("\nRecall on known events:");
let hit = 0;
for (const [t, d, f, note] of known) {
  const ok = events.some((e) => e.ticker === t && near(e.filed, d) && e.flags[f]);
  const any = events.filter((e) => e.ticker === t && near(e.filed, d)).map((e) => e.filed);
  if (ok) hit++;
  console.log(`  ${ok ? "found  " : "MISSED "} ${t} ${d} ${f.padEnd(7)} ${note}${ok ? "" : `  (8-Ks in window: ${any.join(", ") || "none"})`}`);
}
console.log(`  ${hit}/${known.length}`);

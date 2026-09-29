/** Lists every 8-K carrying Item 5.02 (officer/director changes) for the 30 companies, 2016 onward. */
import { readFileSync, writeFileSync } from "node:fs";
import { getAllFilings } from "../../server/src/edgar/store";

// Same company universe (and the same XOM override) as the 10-K corpus.
const CIK_OVERRIDE: Record<string, string> = { XOM: "0000034088" };
const companies = new Map<string, string>();
for (const l of readFileSync(".data/corpus/scores.jsonl", "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l);
  companies.set(r.ticker, CIK_OVERRIDE[r.ticker] ?? r.cik);
}

const out: { ticker: string; accession: string; filed: string; items: string; url: string; indexUrl: string }[] = [];
for (const [ticker, cik] of companies) {
  const all = await getAllFilings(cik);
  const hits = all.filings.filter((f) => f.form === "8-K" && f.filingDate >= "2016-01-01" && (f.items ?? "").split(",").includes("5.02"));
  for (const f of hits) out.push({ ticker, accession: f.accessionNumber, filed: f.filingDate, items: f.items ?? "", url: f.documentUrl, indexUrl: f.filingIndexUrl });
  console.log(`${ticker.padEnd(6)} ${String(hits.length).padStart(3)} 8-Ks with Item 5.02 (${all.filings.length} filings${all.partial ? ", PARTIAL" : ""})`);
}
writeFileSync(".data/turnover/8k_502.json", JSON.stringify(out, null, 1));
console.log("total", out.length);

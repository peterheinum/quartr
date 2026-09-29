/** Downloads each 8-K with Item 5.02 and keeps only that item's text. Resumable. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { edgarFetchText } from "../../server/src/edgar/client";
import { extractItem, htmlToText } from "../src/sentiment";

const OUT = ".data/turnover/text.jsonl";
const list = JSON.parse(readFileSync(".data/turnover/8k_502.json", "utf8")) as { ticker: string; accession: string; filed: string; url: string }[];
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).accession) : []);
let n = 0, noItem = 0;
const failures: string[] = [];
for (const f of list) {
  if (done.has(f.accession)) continue;
  try {
    const section = extractItem(htmlToText(await edgarFetchText(f.url)), "5.02");
    if (!section) noItem++;
    appendFileSync(OUT, JSON.stringify({ ticker: f.ticker, accession: f.accession, filed: f.filed, url: f.url, section }) + "\n");
    n++;
  } catch (e) {
    failures.push(`${f.ticker} ${f.filed}: ${(e as Error).message}`);
  }
  if (n % 100 === 0 && n) console.log(`${n}/${list.length - done.size}`);
}
console.log(`fetched ${n}, item text not found in ${noItem}, failures ${failures.length}`, failures.slice(0, 5));

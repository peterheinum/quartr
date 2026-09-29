/** Downloads FOMC statements (2016+), scores them, and saves them with the fed funds target rate. */
import { mkdirSync, writeFileSync } from "node:fs";
import { extractStatement, parseFredCsv, statementUrls } from "../src/fed";
import { loadDictionary, scoreText } from "../src/sentiment";

const UA = { "User-Agent": "Mozilla/5.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** GET with a few retries: FRED in particular resets connections now and then. */
const get = async (url: string) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
};

mkdirSync(".data/fed", { recursive: true });
const dict = loadDictionary();

// The calendar page covers recent years; older years live on per-year historical pages.
const pages = [
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  ...[2016, 2017, 2018, 2019, 2020].map((y) => `https://www.federalreserve.gov/monetarypolicy/fomchistorical${y}.htm`),
];
const found = new Map<string, string>();
for (const p of pages) for (const s of statementUrls(await get(p))) found.set(s.date, s.url);
console.log(`found ${found.size} statements ${[...found.keys()].sort()[0]} -> ${[...found.keys()].sort().at(-1)}`);

const out: unknown[] = [];
const failures: string[] = [];
for (const [date, url] of [...found].sort()) {
  if (date < "2015-06-01") continue;
  try {
    const text = extractStatement(await get(url));
    const s = scoreText(text, dict);
    out.push({ date, url, words: s.words, pct: s.pct, netTone: s.netTone });
  } catch (e) {
    failures.push(`${date}: ${(e as Error).message}`);
  }
  await sleep(300);
}
writeFileSync(".data/fed/statements.json", JSON.stringify(out, null, 2));

const rates = await get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU&cosd=2015-01-01");
writeFileSync(".data/fed/target_rate.json", JSON.stringify(parseFredCsv(rates)));
console.log(`scored ${out.length} statements, ${failures.length} failures`, failures);

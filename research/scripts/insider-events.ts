/**
 * Builds the insider-trade event table from the SEC's quarterly Form 3/4/5 data sets.
 * One archive at a time: download, extract the three tables we need, aggregate to one
 * row per (filing, code), append to events.jsonl, delete the archive. Resumable.
 *
 * Kept: Form 4 open-market purchases (P) and sales (S) by officers/directors. Pure
 * 10%-owner filers are excluded (funds, PIPEs, holding companies are not insider conviction).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const UA = process.env.SEC_USER_AGENT ?? "Quartr Assignment Peter Heinum peter.heinum@gmail.com";
const DIR = ".data/insider";
const EVENTS = `${DIR}/events.jsonl`;
const DONE = `${DIR}/done.txt`;
// Windows' own bsdtar reads zip archives; a GNU tar earlier on PATH (e.g. Git Bash) does not.
const TAR = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe") : "tar";
const MIN_VALUE = { P: 25_000, S: 100_000 } as const;

mkdirSync(DIR, { recursive: true });
const done = new Set(existsSync(DONE) ? readFileSync(DONE, "utf8").split("\n").filter(Boolean) : []);

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** "31-JAN-2024" -> "2024-01-31" */
const isoDate = (s: string) => (s && /^\d\d-[A-Z]{3}-\d{4}$/.test(s) ? `${s.slice(7)}-${MONTHS[s.slice(3, 6)]}-${s.slice(0, 2)}` : "");

function table(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const head = lines[0]!.split("\t");
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i]!.split("\t");
    const r: Record<string, string> = {};
    head.forEach((h, j) => (r[h] = f[j] ?? ""));
    out.push(r);
  }
  return out;
}

export function quartersFrom(links: string[]): { q: string; url: string }[] {
  return links
    .map((l) => ({ q: /(\d{4}q\d)_form345/.exec(l)?.[1] ?? "", url: `https://www.sec.gov${l}` }))
    .filter((x) => x.q >= "2016q1")
    .sort((a, b) => a.q.localeCompare(b.q));
}

async function processQuarter(q: string, url: string): Promise<number> {
  const zip = `${DIR}/${q}.zip`, tmp = `${DIR}/tmp_${q}`;
  try {
    return await extractQuarter(q, url, zip, tmp);
  } finally {
    rmSync(zip, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function extractQuarter(q: string, url: string, zip: string, tmp: string): Promise<number> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${q}: HTTP ${res.status}`);
  await Bun.write(zip, res);
  mkdirSync(tmp, { recursive: true });
  execFileSync(TAR, ["-xf", zip, "-C", tmp, "SUBMISSION.tsv", "REPORTINGOWNER.tsv", "NONDERIV_TRANS.tsv"]);

  const sub = new Map(table(`${tmp}/SUBMISSION.tsv`).filter((r) => r.DOCUMENT_TYPE === "4").map((r) => [r.ACCESSION_NUMBER!, r]));
  const owner = new Map<string, Record<string, string>>();
  for (const r of table(`${tmp}/REPORTINGOWNER.tsv`)) if (sub.has(r.ACCESSION_NUMBER!) && !owner.has(r.ACCESSION_NUMBER!)) owner.set(r.ACCESSION_NUMBER!, r);

  const agg = new Map<string, { acc: string; code: "P" | "S"; shares: number; value: number; tradeDate: string }>();
  for (const t of table(`${tmp}/NONDERIV_TRANS.tsv`)) {
    const code = t.TRANS_CODE;
    if ((code !== "P" && code !== "S") || !sub.has(t.ACCESSION_NUMBER!)) continue;
    // Common stock only: exclude preferred, units, notes and other classes that share the form.
    if (!/common|ordinary|class [a-c]\b/i.test(t.SECURITY_TITLE ?? "")) continue;
    const shares = Number(t.TRANS_SHARES), price = Number(t.TRANS_PRICEPERSHARE);
    if (!(shares > 0) || !(price > 0)) continue;
    const key = `${t.ACCESSION_NUMBER}|${code}`;
    const cur = agg.get(key) ?? { acc: t.ACCESSION_NUMBER!, code, shares: 0, value: 0, tradeDate: isoDate(t.TRANS_DATE ?? "") };
    cur.shares += shares;
    cur.value += shares * price;
    agg.set(key, cur);
  }

  let n = 0;
  for (const e of agg.values()) {
    if (e.value < MIN_VALUE[e.code]) continue;
    const s = sub.get(e.acc)!, o = owner.get(e.acc);
    const rel = o?.RPTOWNER_RELATIONSHIP ?? "";
    if (!o || rel.includes("TenPercentOwner") || !/Officer|Director/.test(rel)) continue;
    const ticker = (s.ISSUERTRADINGSYMBOL ?? "").toUpperCase().split(/[\s,]/)[0]!;
    if (!ticker) continue;
    appendFileSync(EVENTS, JSON.stringify({
      acc: e.acc, filed: isoDate(s.FILING_DATE!), tradeDate: e.tradeDate, cik: s.ISSUERCIK, ticker, issuer: s.ISSUERNAME,
      insider: o.RPTOWNERNAME, cikOwner: o.RPTOWNERCIK, rel, title: o.RPTOWNER_TITLE,
      code: e.code, shares: e.shares, value: Math.round(e.value), plan: s.AFF10B5ONE === "1" || s.AFF10B5ONE === "true",
    }) + "\n");
    n++;
  }
  return n;
}

if (import.meta.main) {
  const only = process.argv[2]; // optional: a single quarter like 2024q1
  const linksPage = await (await fetch("https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets", { headers: { "User-Agent": UA } })).text();
  const links = [...linksPage.matchAll(/href="([^"]*_form345\.zip)"/g)].map((m) => m[1]!);
  for (const { q, url } of quartersFrom([...new Set(links)])) {
    if ((only && q !== only) || done.has(q)) continue;
    try {
      const n = await processQuarter(q, url);
      appendFileSync(DONE, q + "\n");
      console.log(`${q}: ${n} events kept`);
    } catch (e) {
      console.log(`${q}: FAILED ${(e as Error).message}`);
    }
    await Bun.sleep(400);
  }
}

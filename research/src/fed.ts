/** Federal Reserve inputs: FOMC statement text and the fed funds target rate. */

export interface RatePoint {
  date: string;
  rate: number;
}

/** FRED graph CSV: a header row, then `date,value` rows where a missing value is ".". */
export function parseFredCsv(csv: string): RatePoint[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .filter(([d, v]) => d && v && v !== "." && !Number.isNaN(Number(v)))
    .map(([d, v]) => ({ date: d!, rate: Number(v) }));
}

/** Most recent observation on or before `date`; `series` ascending. */
export function rateOn(series: RatePoint[], date: string): number | null {
  let out: number | null = null;
  for (const p of series) {
    if (p.date > date) break;
    out = p.rate;
  }
  return out;
}

/** Change in the target rate over the `days` before `date`, in percentage points. Null without both ends. */
export function rateChange(series: RatePoint[], date: string, days = 365): number | null {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  const before = rateOn(series, d.toISOString().slice(0, 10));
  const now = rateOn(series, date);
  return before == null || now == null ? null : now - before;
}

/** Statement URLs ("...a.htm") from an FOMC calendar/historical page. The "a1" implementation notes are excluded. */
export function statementUrls(page: string): { date: string; url: string }[] {
  const dates = new Set([...page.matchAll(/monetary(\d{8})a\.htm/g)].map((m) => m[1]!));
  return [...dates].sort().map((d) => ({
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    url: `https://www.federalreserve.gov/newsevents/pressreleases/monetary${d}a.htm`,
  }));
}

/** The statement body: from the article container up to the list of voting members. */
export function extractStatement(html: string): string {
  const start = html.indexOf('id="article"');
  if (start < 0) throw new Error("no article container");
  const rest = html.slice(start);
  const ends = ["Voting for the monetary policy action", "Implementation Note", "For media inquiries"]
    .map((m) => rest.indexOf(m))
    .filter((i) => i > 0);
  const body = ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

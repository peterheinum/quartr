/** Joins scored filings, prices, SMA200 distance and Fed data into one observation per filing. */
import { readFileSync } from "node:fs";
import { windowAroundFiling, type Bar } from "./prices";
import { distanceFromSma } from "./technical";
import { rateChange, type RatePoint } from "./fed";
import { mean } from "./stats";

export const HORIZONS = ["0d", "+5d", "+30d", "+6m"] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Obs {
  ticker: string;
  filed: string;
  /** 10-K net tone minus the company's own average, x100. */
  toneRel: number;
  /** Change in 10-K net tone vs the company's previous 10-K, x100. */
  dTone: number | null;
  /** Percent above/below the 200-day SMA on the last close before the filing. */
  dist: number;
  /** Net tone of the FOMC statement in force on the filing date, x100. */
  fedTone: number;
  fedDTone: number;
  rate: number;
  rate12m: number;
  /** Return minus SPY's over the same horizon, percent. */
  excess: Record<Horizon, number | null>;
}

export interface Dataset {
  obs: Obs[];
  scored: number;
  dropped: string;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

export function loadObservations(dir = ".data"): Dataset {
  const scores = readFileSync(`${dir}/corpus/scores.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) as {
    ticker: string; filed: string; words: number; netTone: number;
  }[];
  const statements = (JSON.parse(readFileSync(`${dir}/fed/statements.json`, "utf8")) as { date: string; netTone: number }[]).sort((a, b) => a.date.localeCompare(b.date));
  const rates = JSON.parse(readFileSync(`${dir}/fed/target_rate.json`, "utf8")) as RatePoint[];
  const cache = new Map<string, Bar[]>();
  const bars = (t: string) => cache.get(t) ?? (cache.set(t, JSON.parse(readFileSync(`${dir}/prices/${t}.json`, "utf8"))), cache.get(t)!);

  // Drop 10-Ks whose main document is a wrapper around an exhibit (WFC, early PFE/WMT).
  const medWords = new Map<string, number>();
  for (const t of new Set(scores.map((s) => s.ticker))) medWords.set(t, median(scores.filter((s) => s.ticker === t).map((s) => s.words)));
  const isWrapper = (s: (typeof scores)[number]) => s.words < 15000 || s.words < 0.6 * medWords.get(s.ticker)!;
  const kept = scores.filter((s) => !isWrapper(s));
  const dropCounts: Record<string, number> = {};
  for (const s of scores.filter(isWrapper)) dropCounts[s.ticker] = (dropCounts[s.ticker] ?? 0) + 1;

  const obs: Obs[] = [];
  for (const t of new Set(kept.map((s) => s.ticker))) {
    const mine = kept.filter((s) => s.ticker === t).sort((a, b) => a.filed.localeCompare(b.filed));
    const avg = mean(mine.map((s) => s.netTone));
    mine.forEach((s, i) => {
      const w = windowAroundFiling(bars(t), s.filed);
      const b = windowAroundFiling(bars("SPY"), s.filed);
      if (!w.reference) return;
      const dist = distanceFromSma(bars(t), w.reference.date);
      // The Fed statement in force on the filing date: the latest one strictly before it.
      const idx = statements.findLastIndex((x) => x.date < s.filed);
      const r12 = rateChange(rates, s.filed);
      const rNow = rates.findLast((p) => p.date <= s.filed)?.rate;
      if (dist == null || idx < 1 || r12 == null || rNow == null) return;
      const excess = {} as Obs["excess"];
      for (const h of HORIZONS) {
        const p = w.points.find((x) => x.label === h)?.returnPct;
        const q = b.points.find((x) => x.label === h)?.returnPct;
        excess[h] = p != null && q != null ? p - q : null;
      }
      obs.push({
        ticker: t, filed: s.filed, toneRel: (s.netTone - avg) * 100,
        dTone: i > 0 ? (s.netTone - mine[i - 1]!.netTone) * 100 : null,
        dist, fedTone: statements[idx]!.netTone * 100,
        fedDTone: (statements[idx]!.netTone - statements[idx - 1]!.netTone) * 100,
        rate: rNow, rate12m: r12, excess,
      });
    });
  }
  return {
    obs,
    scored: scores.length,
    dropped: Object.entries(dropCounts).map(([t, n]) => `${t}:${n}`).join(" "),
  };
}

/**
 * Builds the "Call It" deck: one round per real past event at the 30 companies, written to
 * web/public/game-rounds.json so the web app needs no server and no research code.
 *
 * Kinds of round: a 10-K filing, insider buying or unplanned selling, an executive-turnover 8-K.
 * The decision day is the close on the day the filing was published; the answer is whether the
 * stock beat SPY over the next GAME_HORIZON_DAYS trading days.
 *
 * Reads what the other research scripts left in .data/ (10-K scores, insider events, 8-K text, Fed data, prices).
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { Bar } from "../src/prices";
import { clusterEvents, priceMatches, type InsiderRow } from "../src/insider";
import { loadObservations } from "../src/dataset";
import { rateChange, rateOn, type RatePoint } from "../src/fed";
import { describeFed, describeMoney, describeTone, describeTrend, buildPriceWindow, insiderBot, toneBot, trendBot, turnoverBot } from "../src/game";
import type { TurnoverFlags } from "../src/turnover";
import type { BotName, GameDeck, GameRound, Pick, RoundKind } from "../../shared/src/game";
import { GAME_HISTORY_DAYS, GAME_HORIZON_DAYS } from "../../shared/src/game";

const OUT = "web/public/game-rounds.json";
const PER_KIND = { tenk: 80, insiderBuy: 40, insiderSell: 40, turnover: 80 };
const MAX_PER_TICKER = 6; // per kind, so one busy company does not fill the deck

const NAMES: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", NVDA: "NVIDIA", TSLA: "Tesla",
  JPM: "JPMorgan Chase", BAC: "Bank of America", WFC: "Wells Fargo", GS: "Goldman Sachs", XOM: "ExxonMobil", CVX: "Chevron",
  JNJ: "Johnson & Johnson", PFE: "Pfizer", MRK: "Merck", UNH: "UnitedHealth", WMT: "Walmart", COST: "Costco", HD: "Home Depot",
  PG: "Procter & Gamble", KO: "Coca-Cola", PEP: "PepsiCo", DIS: "Disney", NFLX: "Netflix", INTC: "Intel", CSCO: "Cisco",
  ORCL: "Oracle", CAT: "Caterpillar", BA: "Boeing",
};

const load = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const lines = <T,>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

const priceCache = new Map<string, Bar[]>();
const bars = (t: string) => priceCache.get(t) ?? (priceCache.set(t, load<Bar[]>(`.data/prices/${t}.json`)), priceCache.get(t)!);
const spy = bars("SPY");
const rates = load<RatePoint[]>(".data/fed/target_rate.json");

// Seeded shuffle so a rebuild gives the same deck.
let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
function shuffled<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const CORE = new Set(lines<{ ticker: string }>(".data/corpus/scores.jsonl").map((r) => r.ticker));

interface Candidate {
  kind: RoundKind;
  ticker: string;
  date: string;
  headline: string;
  /** Facts specific to the event; trend and Fed context are appended for every kind. */
  facts: { label: string; value: string }[];
  /** Bot picks that do not depend on the price window; trend is added once the window is built. */
  bots: Partial<Record<BotName, Pick>>;
}

/** Pick candidates in shuffled order, at most MAX_PER_TICKER per company, keeping only those with a full price window. */
function take(cands: Candidate[], n: number): GameRound[] {
  const perTicker = new Map<string, number>();
  const rounds: GameRound[] = [];
  for (const c of shuffled(cands)) {
    if (rounds.length >= n) break;
    if ((perTicker.get(c.ticker) ?? 0) >= MAX_PER_TICKER) continue;
    const w = buildPriceWindow(bars(c.ticker), spy, c.date, GAME_HISTORY_DAYS, GAME_HORIZON_DAYS);
    if (!w) continue;
    const r12 = rateChange(rates, w.decisionDate), rNow = rateOn(rates, w.decisionDate);
    perTicker.set(c.ticker, (perTicker.get(c.ticker) ?? 0) + 1);
    rounds.push({
      id: `${c.kind}-${c.ticker}-${w.decisionDate}`,
      kind: c.kind,
      headline: c.headline,
      facts: [
        ...c.facts,
        { label: "Price trend", value: `Stock is ${describeTrend(w.distFromSma)}` },
        ...(r12 != null && rNow != null ? [{ label: "Backdrop", value: describeFed(rNow, r12) }] : []),
      ],
      before: w.before,
      sma200: w.sma200,
      after: w.after,
      answer: w.answer,
      excess: w.excess,
      reveal: { ticker: c.ticker, name: NAMES[c.ticker] ?? c.ticker, date: w.decisionDate },
      bots: { ...c.bots, trend: trendBot(w.distFromSma) },
    });
  }
  return rounds;
}

// --- 10-K filings ---
const tenk: Candidate[] = loadObservations().obs.map((o) => ({
  kind: "tenk",
  ticker: o.ticker,
  date: o.filed,
  headline: "The company files its annual report (10-K)",
  facts: [{ label: "Report tone", value: `Wording is ${describeTone(o.toneRel)}` }],
  bots: { tone: toneBot(o.toneRel) },
}));

// --- insider trades: facts use ONLY the filings made on the decision day, never the later ones in the cluster ---
const insiderRows = lines<InsiderRow>(".data/insider/events.jsonl").filter((r) => CORE.has(r.ticker));
const insiderCands: { code: "P" | "S"; cand: Candidate }[] = [];
for (const [code, rows] of [["P", insiderRows], ["S", insiderRows.filter((r) => !r.plan)]] as const) {
  for (const e of clusterEvents(rows, code)) {
    const day = rows.filter((r) => r.cik === e.cik && r.code === code && r.filed === e.date);
    const shares = day.reduce((s, r) => s + r.shares, 0), value = day.reduce((s, r) => s + r.value, 0);
    if (code === "S" && value < 1_000_000) continue;
    const b = CORE.has(e.ticker) ? bars(e.ticker) : null;
    if (!b || !shares) continue;
    // The trade price must match the ticker's price that day, or the ticker was reused by another company.
    const td = day[0]!.tradeDate || e.date;
    let k = -1;
    for (let i = 0; i < b.length && b[i]!.date <= td; i++) k = i;
    if (k < 0 || !priceMatches(value / shares, b[k]!.close)) continue;
    const who = new Set(day.map((r) => r.insider)).size;
    const officer = day.some((r) => r.rel.includes("Officer"));
    insiderCands.push({
      code,
      cand: {
        kind: "insider",
        ticker: e.ticker,
        date: e.date,
        headline: code === "P" ? "Company insiders buy stock on the open market" : "Company insiders sell stock (not under a pre-set plan)",
        facts: [
          { label: code === "P" ? "Bought" : "Sold", value: `${describeMoney(value)} by ${who} ${who === 1 ? "insider" : "insiders"}` },
          { label: "Who", value: officer ? "Includes a company officer" : "Directors only" },
        ],
        bots: { insider: insiderBot(code) },
      },
    });
  }
}

// --- executive turnover 8-Ks: one event per company per 45 days ---
type TurnoverEv = { ticker: string; filed: string; flags: TurnoverFlags };
const turnoverAll = load<TurnoverEv[]>(".data/turnover/events.json")
  .filter((e) => e.flags.ceoOut || e.flags.ceoIn || e.flags.cfoOut || e.flags.cfoIn)
  .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.filed.localeCompare(b.filed));
const turnoverEvents: TurnoverEv[] = [];
for (const e of turnoverAll) {
  const last = turnoverEvents.at(-1);
  if (last && last.ticker === e.ticker && Date.parse(e.filed) - Date.parse(last.filed) <= 45 * 864e5) continue;
  turnoverEvents.push(e);
}
function turnoverHeadline(f: TurnoverFlags): string {
  const role = f.ceoOut || f.ceoIn ? "CEO" : "CFO";
  const out = role === "CEO" ? f.ceoOut : f.cfoOut, inn = role === "CEO" ? f.ceoIn : f.cfoIn;
  if (out && inn) return `The ${role} is replaced: one leaves, a successor is named`;
  return out ? `The ${role} announces they are leaving` : `A new ${role} is named`;
}
const turnover: Candidate[] = turnoverEvents.map((e) => ({
  kind: "turnover",
  ticker: e.ticker,
  date: e.filed,
  headline: turnoverHeadline(e.flags),
  facts: [{ label: "Source", value: "Reported to the SEC in an 8-K filing" }],
  bots: { turnover: turnoverBot(e.flags) },
}));

const rounds = shuffled([
  ...take(tenk, PER_KIND.tenk),
  ...take(insiderCands.filter((c) => c.code === "P").map((c) => c.cand), PER_KIND.insiderBuy),
  ...take(insiderCands.filter((c) => c.code === "S").map((c) => c.cand), PER_KIND.insiderSell),
  ...take(turnover, PER_KIND.turnover),
]);

const deck: GameDeck = { generated: new Date().toISOString().slice(0, 10), horizonDays: GAME_HORIZON_DAYS, historyDays: GAME_HISTORY_DAYS, rounds };
writeFileSync(OUT, JSON.stringify(deck));

// --- validation: what the game will show ---
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "n/a");
console.log(`wrote ${OUT}: ${rounds.length} rounds, ${(statSync(OUT).size / 1024).toFixed(0)} KB, horizon ${GAME_HORIZON_DAYS} trading days`);
console.log("rounds by kind:", Object.fromEntries(["tenk", "insider", "turnover"].map((k) => [k, rounds.filter((r) => r.kind === k).length])));
console.log(`share of rounds where the stock beat SPY: ${pct(rounds.filter((r) => r.answer === "beat").length, rounds.length)}`);
console.log("\nsignal accuracy over the whole deck (the game's leaderboard, before any human plays):");
for (const bot of ["tone", "trend", "insider", "turnover"] as BotName[]) {
  const played = rounds.filter((r) => r.bots[bot]);
  const right = played.filter((r) => r.bots[bot] === r.answer).length;
  console.log(`  ${bot.padEnd(9)} ${String(played.length).padStart(4)} rounds  ${pct(right, played.length).padStart(4)} right`);
}
const bads = rounds.filter(
  (r) =>
    r.before.stock.at(-1)![3] !== 100 || r.before.spy.at(-1)![3] !== 100 ||
    r.before.stock.length !== GAME_HISTORY_DAYS || r.before.spy.length !== GAME_HISTORY_DAYS ||
    r.after.stock.length !== GAME_HORIZON_DAYS || r.after.spy.length !== GAME_HORIZON_DAYS,
);
console.log(`\nshape check: ${bads.length} malformed rounds; ids unique: ${new Set(rounds.map((r) => r.id)).size === rounds.length}`);

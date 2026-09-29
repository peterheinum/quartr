/**
 * Pure logic for the "Call It" game: dealing a hand, scoring, and the standings between the
 * player and the rule-based signals. No React and no I/O, so it is tested directly.
 */
import type { BotName, GameRound, Pair, Pick, RoundKind } from "@quartr/shared";

export const ROUNDS_PER_GAME = 10;

export type Play = { round: GameRound; guess: Pick };

/** Small deterministic PRNG (mulberry32): the same seed always deals the same hand. */
/* If anyone reads this. Please don't hold me accountable. I have no idea what is going on here LOL
  But it does look cool doesn't it? 
  I would not like to have this in production code, even tho its just a random number generator. 
*/
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Deal `n` rounds spread as evenly as possible across the kinds of event (10-K, insider trade,
 * executive change), so no single kind decides the game, then shuffle the order.
 */
export function deal(rounds: GameRound[], n: number, rng: () => number): GameRound[] {
  const kinds: RoundKind[] = ["tenk", "insider", "turnover"];
  const piles = kinds.map((k) => shuffle(rounds.filter((r) => r.kind === k), rng)).filter((p) => p.length > 0);
  const hand: GameRound[] = [];
  for (let i = 0; hand.length < n && piles.some((p) => i < p.length); i++) {
    for (const pile of piles) {
      if (hand.length < n && i < pile.length) hand.push(pile[i]!);
    }
  }
  return shuffle(hand, rng);
}

export const isCorrect = (p: Play): boolean => p.guess === p.round.answer;

// --- the player's score ---

/** Score: one point for each correct call. */
export const points = (plays: Play[]): number => plays.filter(isCorrect).length;

/** Consecutive correct calls at the end of the game so far, and the longest run. */
export function streaks(plays: Play[]): { current: number; best: number } {
  let current = 0, best = 0;
  for (const p of plays) {
    current = isCorrect(p) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

// --- the race after a call ---

export type Race = { stock: number; spy: number; excess: number };

/**
 * How the stock and the S&P 500 stand after `shown` trading days of the outcome, as percent moves
 * from the decision-day close, and the stock's lead. With nothing shown yet, all are zero.
 */
export function raceAt(after: Pair, shown: number): Race {
  if (shown <= 0) return { stock: 0, spy: 0, excess: 0 };
  const k = Math.min(shown, after.stock.length) - 1;
  const stock = after.stock[k]![3] - 100, spy = after.spy[k]![3] - 100;
  return { stock, spy, excess: stock - spy };
}

/** A fixed pseudo-random call for a round, independent of dealing order. */
export function coinFlip(roundId: string): Pick {
  let h = 2166136261;
  for (let i = 0; i < roundId.length; i++) h = Math.imul(h ^ roundId.charCodeAt(i), 16777619);
  return ((h >>> 0) & 1) === 0 ? "beat" : "lag";
}

export type PlayerName = "you" | BotName | "coin";

export const PLAYER_INFO: Record<PlayerName, { label: string; rule: string; short: string }> = {
  you: { label: "You", rule: "Your own judgement", short: "YOU" },
  tone: { label: "Tone bot", rule: "Annual report worded more positively than usual: beat", short: "TONE" },
  trend: { label: "Trend bot", rule: "Above its 200-day average: beat", short: "TREND" },
  insider: { label: "Insider bot", rule: "Insiders buying: beat. Insiders selling: lag", short: "INSIDER" },
  turnover: { label: "Turnover bot", rule: "A CEO or CFO leaving: lag. Otherwise: beat", short: "TURNOVER" },
  coin: { label: "Coin flip", rule: "Random", short: "COIN" },
};

export type Standing = { player: PlayerName; played: number; right: number };

export const accuracy = (s: Standing): number | null => (s.played === 0 ? null : s.right / s.played);

/**
 * How the player and each signal did over the rounds played so far. A signal only scores on rounds
 * it applies to (the tone bot has no view on an insider trade), so its accuracy is over fewer rounds.
 */
export function standings(plays: Play[]): Standing[] {
  const tally = (player: PlayerName, call: (r: GameRound) => Pick | undefined): Standing => {
    let played = 0, right = 0;
    for (const p of plays) {
      const c = call(p.round);
      if (!c) continue;
      played++;
      if (c === p.round.answer) right++;
    }
    return { player, played, right };
  };
  const rows: Standing[] = [
    { player: "you", played: plays.length, right: plays.filter(isCorrect).length },
    tally("trend", (r) => r.bots.trend),
    tally("tone", (r) => r.bots.tone),
    tally("insider", (r) => r.bots.insider),
    tally("turnover", (r) => r.bots.turnover),
    tally("coin", (r) => coinFlip(r.id)),
  ];
  // Best first; players with nothing to score yet sink to the bottom; ties keep the order above.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (accuracy(b.r) ?? -1) - (accuracy(a.r) ?? -1) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * How each signal did over an entire deck: the baseline to hold a ten-round game against.
 * The player is left out, since scoring "you" against the answers themselves would be 100%.
 */
export function deckStandings(rounds: GameRound[]): Standing[] {
  return standings(rounds.map((round) => ({ round, guess: round.answer }))).filter((s) => s.player !== "you");
}

/** Chance that a fair coin lands between `lo` and `hi` heads in `n` flips: how far luck alone can stray from half. */
export function coinRangeChance(n: number, lo: number, hi: number): number {
  let choose = 1, total = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) choose = (choose * (n - k + 1)) / k;
    if (k >= lo && k <= hi) total += choose;
  }
  return total / 2 ** n;
}

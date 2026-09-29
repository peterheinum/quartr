import { describe, expect, test } from "bun:test";
import type { BotName, Candle, GameRound, Pick, RoundKind } from "@quartr/shared";
import {
  accuracy, coinFlip, coinRangeChance, deal, deckStandings, isCorrect, makeRng, points, raceAt, standings, streaks,
  type Play,
} from "../src/game";

const flat = (close: number): Candle => [close, close, close, close];

function round(id: string, kind: RoundKind, answer: Pick, bots: Partial<Record<BotName, Pick>> = {}, afterClose = { stock: 101, spy: 100 }): GameRound {
  return {
    id, kind, headline: "h", facts: [],
    before: { stock: [flat(100)], spy: [flat(100)] }, sma200: [null],
    after: { stock: [flat(afterClose.stock)], spy: [flat(afterClose.spy)] },
    answer, excess: 1, reveal: { ticker: "X", name: "X", date: "2020-01-01" }, bots,
  };
}
const many = (kind: RoundKind, n: number) => Array.from({ length: n }, (_, i) => round(`${kind}-${i}`, kind, i % 2 ? "beat" : "lag"));
const play = (r: GameRound, guess: Pick): Play => ({ round: r, guess });

describe("makeRng", () => {
  test("the same seed gives the same sequence, and values are in [0, 1)", () => {
    const a = makeRng(7), b = makeRng(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  test("different seeds differ", () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });
});

describe("deal", () => {
  const deck = [...many("tenk", 20), ...many("insider", 20), ...many("turnover", 20)];

  test("deals the requested number with no repeats", () => {
    const hand = deal(deck, 10, makeRng(1));
    expect(hand).toHaveLength(10);
    expect(new Set(hand.map((r) => r.id)).size).toBe(10);
  });
  test("spreads evenly across kinds", () => {
    const hand = deal(deck, 9, makeRng(3));
    for (const k of ["tenk", "insider", "turnover"] as RoundKind[]) expect(hand.filter((r) => r.kind === k)).toHaveLength(3);
  });
  test("a kind that runs out does not stop the deal", () => {
    const hand = deal([...many("tenk", 1), ...many("insider", 20)], 6, makeRng(1));
    expect(hand).toHaveLength(6);
    expect(hand.filter((r) => r.kind === "tenk")).toHaveLength(1);
  });
  test("asking for more than exists deals what there is", () => {
    expect(deal(many("tenk", 3), 10, makeRng(1))).toHaveLength(3);
  });
  test("the same seed deals the same hand", () => {
    expect(deal(deck, 10, makeRng(5)).map((r) => r.id)).toEqual(deal(deck, 10, makeRng(5)).map((r) => r.id));
  });
});

describe("coinFlip", () => {
  test("is stable for a given round and roughly balanced across rounds", () => {
    expect(coinFlip("abc")).toBe(coinFlip("abc"));
    const beats = Array.from({ length: 1000 }, (_, i) => coinFlip(`round-${i}`)).filter((p) => p === "beat").length;
    expect(beats).toBeGreaterThan(400);
    expect(beats).toBeLessThan(600);
  });
});

describe("score and streaks", () => {
  const win = round("w", "tenk", "beat"), loss = round("l", "tenk", "lag");
  test("each correct call scores one point and a wrong one scores nothing", () => {
    expect(points([play(win, "beat")])).toBe(1);
    expect(points([play(win, "lag")])).toBe(0);
    expect(points([play(win, "beat"), play(loss, "beat"), play(win, "beat")])).toBe(2);
  });
  test("no plays score zero", () => {
    expect(points([])).toBe(0);
  });
  test("streaks track the current run and the best run", () => {
    const seq = [play(win, "beat"), play(win, "beat"), play(win, "lag"), play(win, "beat"), play(win, "beat"), play(win, "beat")];
    expect(streaks(seq)).toEqual({ current: 3, best: 3 });
    expect(streaks(seq.slice(0, 3))).toEqual({ current: 0, best: 2 });
    expect(streaks([])).toEqual({ current: 0, best: 0 });
  });
});

describe("raceAt", () => {
  const after = {
    stock: [flat(101), flat(104), flat(97)],
    spy: [flat(100.5), flat(101), flat(99)],
  };
  test("nothing shown yet is a dead heat at zero", () => {
    expect(raceAt(after, 0)).toEqual({ stock: 0, spy: 0, excess: 0 });
  });
  test("reports each side's move from the decision-day close and the stock's lead", () => {
    const r = raceAt(after, 2);
    expect(r.stock).toBeCloseTo(4);
    expect(r.spy).toBeCloseTo(1);
    expect(r.excess).toBeCloseTo(3);
  });
  test("the lead can be negative, and asking past the end holds at the final day", () => {
    const r = raceAt(after, 99);
    expect(r.stock).toBeCloseTo(-3);
    expect(r.spy).toBeCloseTo(-1);
    expect(r.excess).toBeCloseTo(-2);
  });
});

describe("standings", () => {
  const plays: Play[] = [
    play(round("a", "tenk", "beat", { trend: "beat", tone: "lag" }), "beat"),
    play(round("b", "insider", "lag", { trend: "beat", insider: "lag" }), "beat"),
    play(round("c", "turnover", "lag", { trend: "lag", turnover: "lag" }), "lag"),
  ];
  const by = (name: string) => standings(plays).find((s) => s.player === name)!;

  test("the player is scored on every round", () => {
    expect(by("you")).toEqual({ player: "you", played: 3, right: 2 });
  });
  test("a bot is scored only on the rounds it has a view on", () => {
    expect(by("tone")).toEqual({ player: "tone", played: 1, right: 0 });
    expect(by("insider")).toEqual({ player: "insider", played: 1, right: 1 });
    expect(by("trend")).toEqual({ player: "trend", played: 3, right: 2 });
    expect(by("turnover")).toEqual({ player: "turnover", played: 1, right: 1 });
  });
  test("sorted best first, and a bot with nothing to score sinks to the bottom", () => {
    const rows = standings([plays[0]!]); // only a 10-K round: insider and turnover bots have no view
    expect(rows.at(-1)!.played).toBe(0);
    const accs = rows.filter((r) => r.played > 0).map((r) => accuracy(r)!);
    expect(accs).toEqual([...accs].sort((x, y) => y - x));
  });
  test("accuracy is null with nothing played, a fraction otherwise", () => {
    expect(accuracy({ player: "tone", played: 0, right: 0 })).toBeNull();
    expect(accuracy({ player: "you", played: 4, right: 3 })).toBe(0.75);
  });
  test("isCorrect compares the guess with the answer", () => {
    expect(isCorrect(plays[0]!)).toBe(true);
    expect(isCorrect(plays[1]!)).toBe(false);
  });
});

describe("deck baseline", () => {
  test("deckStandings scores the bots over the whole deck and leaves the player out", () => {
    const deck = [round("a", "tenk", "beat", { trend: "beat" }), round("b", "tenk", "lag", { trend: "beat" })];
    const rows = deckStandings(deck);
    expect(rows.find((r) => r.player === "you")).toBeUndefined();
    expect(rows.find((r) => r.player === "trend")).toEqual({ player: "trend", played: 2, right: 1 });
  });
  test("coinRangeChance matches the binomial: 3 to 7 heads in 10 flips is about 89%", () => {
    expect(coinRangeChance(10, 3, 7)).toBeCloseTo(0.8906, 3);
    expect(coinRangeChance(10, 0, 10)).toBe(1);
    expect(coinRangeChance(4, 2, 2)).toBeCloseTo(0.375, 5);
  });
});

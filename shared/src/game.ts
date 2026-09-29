/**
 * Data contract for the "Call It" game: one pre-built round per real past event.
 *
 * The deck is a static JSON file (`web/public/game-rounds.json`) written by
 * `research/scripts/game-rounds.ts` and read by the web app, so the game needs no
 * server and no research code at runtime.
 */

/** The player's call, and the truth: did the stock beat the S&P 500 (SPY) over the next month? */
export type Pick = "beat" | "lag";

/** The rule-based "signals" that play alongside the human. Each applies only to some kinds of round. */
export type BotName = "tone" | "trend" | "insider" | "turnover";

export type RoundKind = "tenk" | "insider" | "turnover";

/** Trading days after the decision that the answer is measured over. */
export const GAME_HORIZON_DAYS = 21;

/** Trading days of history shown before the decision. */
export const GAME_HISTORY_DAYS = 90;

/** One daily candle: [open, high, low, close]. */
export type Candle = [open: number, high: number, low: number, close: number];

/** A stock and the S&P 500 over the same days, each rebased so the decision-day close is 100. */
export type Pair = { stock: Candle[]; spy: Candle[] };

export type GameRound = {
  id: string;
  kind: RoundKind;
  /** What happened, without saying where: "Officers and directors bought stock". */
  headline: string;
  /** Context shown before the guess. Never names the company or gives a date. */
  facts: { label: string; value: string }[];
  /**
   * The GAME_HISTORY_DAYS candles up to and including the decision day. The last stock candle and the
   * last S&P candle both close at exactly 100.
   */
  before: Pair;
  /** Stock's 200-day simple moving average aligned with `before.stock`, same rebased scale. Null where too little history. */
  sma200: (number | null)[];
  /** Trading days 1..GAME_HORIZON_DAYS after the decision. Hidden until the guess is made. */
  after: Pair;
  /** Whether the stock's return over `after` beat SPY's. */
  answer: Pick;
  /** Stock return minus SPY return over the horizon, in percent. */
  excess: number;
  /** Shown only after the guess. */
  reveal: { ticker: string; name: string; date: string };
  /** What each signal would have called. A missing key means that signal does not apply to this round. */
  bots: Partial<Record<BotName, Pick>>;
};

export type GameDeck = {
  generated: string;
  horizonDays: number;
  historyDays: number;
  rounds: GameRound[];
};

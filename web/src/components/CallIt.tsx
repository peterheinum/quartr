/**
 * "Call It": for each real past event, guess whether the stock beats the S&P 500 over the next
 * 21 trading days, After you lock in, the month plays out candle by candle
 * against the S&P 500. Four simple rule-based signals play the same rounds.
 *
 * Every screen is laid out to fit one viewport without scrolling (see game.css).
 *
 * The deck is a static file built by research/scripts/game-rounds.ts. Everything shown before a
 * call is knowable at the time; the company, the date and the outcome stay hidden until you lock in.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { GameDeck, GameRound, Pick } from "@quartr/shared";
import { useFetch } from "../useFetch";
import { CandleChart } from "./CandleChart";
import {
  PLAYER_INFO, ROUNDS_PER_GAME, accuracy, coinFlip, coinRangeChance, deal, deckStandings, isCorrect, makeRng, points,
  raceAt, standings, streaks, type Play, type PlayerName, type Race, type Standing,
} from "../game";
import "../game.css";

type Stage =
  | { name: "intro" }
  | { name: "playing"; hand: GameRound[]; index: number; plays: Play[] }
  | { name: "done"; plays: Play[] };

const KIND: Record<GameRound["kind"], { icon: string; label: string }> = {
  tenk: { icon: "📄", label: "ANNUAL REPORT" },
  insider: { icon: "💼", label: "INSIDER TRADE" },
  turnover: { icon: "🔄", label: "EXECUTIVE CHANGE" },
};

const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const signed = (x: number, digits = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
const arrow = (p: Pick) => (p === "beat" ? "▲" : "▼");

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

async function fetchDeck(signal: AbortSignal): Promise<GameDeck> {
  const res = await fetch("/game-rounds.json", { signal });
  if (!res.ok) throw new Error(`Could not load the game data (${res.status})`);
  return (await res.json()) as GameDeck;
}

export function CallIt() {
  const deck = useFetch<GameDeck>(fetchDeck, []);
  const [stage, setStage] = useState<Stage>({ name: "intro" });

  if (deck.loading) return <p className="arena-loading">Loading rounds…</p>;
  if (deck.error || !deck.data) return <div className="arena-error">{deck.error ?? "No game data."}</div>;
  const data = deck.data;

  const start = () => {
    const hand = deal(data.rounds, ROUNDS_PER_GAME, makeRng(Math.floor(Math.random() * 2 ** 32)));
    setStage({ name: "playing", hand, index: 0, plays: [] });
  };

  if (stage.name === "intro") return <Intro deck={data} onStart={start} />;
  if (stage.name === "done") return <Finish plays={stage.plays} deck={data} onAgain={start} />;

  const round = stage.hand[stage.index]!;
  const onNext = (play: Play) => {
    const plays = [...stage.plays, play];
    setStage(stage.index + 1 >= stage.hand.length ? { name: "done", plays } : { ...stage, index: stage.index + 1, plays });
  };

  // Keyed by round so each round starts with fresh state: call and playback.
  return <RoundView key={round.id} round={round} number={stage.index + 1} total={stage.hand.length} plays={stage.plays} horizon={data.horizonDays} onNext={onNext} />;
}

/* ------------------------------------------------------------------ intro */

function Intro({ deck, onStart }: { deck: GameDeck; onStart: () => void }) {
  return (
    <div className="arena intro">
      <header className="hero">
        <p className="eyebrow">A GAME OF REAL MARKETS</p>
        <h1 className="logo">CALL <span>IT</span></h1>
        <p className="tagline">Real events. Hidden stocks. Will it beat the S&amp;P 500 over the next {deck.horizonDays} trading days?</p>
      </header>

      <ol className="steps">
        <li className="glass step">
          <span className="step-n">1</span>
          <div>
            <h3>Read the tape</h3>
            <p>A real annual report, insider trade or CEO/CFO change, company and date hidden. {deck.historyDays} days of candles and a few facts.</p>
          </div>
        </li>
        <li className="glass step">
          <span className="step-n">2</span>
          <div>
            <h3>Make the call</h3>
            <p>Will the stock beat the market or lag it? Lock in your call. Each right call scores a point.</p>
          </div>
        </li>
        <li className="glass step">
          <span className="step-n">3</span>
          <div>
            <h3>Watch it play out</h3>
            <p>The month unfolds candle by candle against the S&amp;P 500, on one log scale so the race is fair.</p>
          </div>
        </li>
      </ol>

      <section className="glass field-preview">
        <h2>Up against four signals</h2>
        <ul>
          {(["trend", "tone", "insider", "turnover"] as const).map((k) => (
            <li key={k}><strong>{PLAYER_INFO[k].label}</strong><span>{PLAYER_INFO[k].rule}</span></li>
          ))}
        </ul>
      </section>

      <div className="start-row">
        <button className="btn-start" onClick={onStart} autoFocus>Start a {ROUNDS_PER_GAME}-round game</button>
        <p className="kbd-hint">
          {deck.rounds.length} real events, 2016–2026 &nbsp;·&nbsp; <kbd>↑</kbd> beat <kbd>↓</kbd> lag <kbd>Enter</kbd> next
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- HUD */

function Hud({ number, total, plays, current }: { number: number; total: number; plays: Play[]; current: number }) {
  const score = points(plays);
  const { current: streak } = streaks(plays);
  return (
    <div className="hud glass">
      <div className="pips" aria-label={`Round ${number} of ${total}`}>
        {Array.from({ length: total }, (_, i) => {
          const p = plays[i];
          const cls = p ? (isCorrect(p) ? "pip right" : "pip wrong") : i === current ? "pip now" : "pip";
          return <span key={i} className={cls} />;
        })}
        <span className="pip-label">ROUND {number}/{total}</span>
      </div>
      <div className="hud-stats">
        <div className={streak >= 2 ? "stat hot" : "stat"} title="Consecutive correct calls">
          <span className="stat-k">STREAK</span>
          <span className="stat-v">{streak >= 2 ? "🔥 " : ""}{streak}</span>
        </div>
        <div className="stat" title="One point for each correct call">
          <span className="stat-k">SCORE</span>
          <span key={score} className={`stat-v pop ${score > 0 ? "pos" : ""}`}>{score}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ round */

function RoundView(props: { round: GameRound; number: number; total: number; plays: Play[]; horizon: number; onNext: (play: Play) => void }) {
  const { round, number, total, plays, horizon, onNext } = props;
  const reduced = useReducedMotion();
  const [guess, setGuess] = useState<Pick | null>(null);
  const [shown, setShown] = useState(0);
  const advanced = useRef(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  const phase: "deciding" | "playing" | "revealed" = guess == null ? "deciding" : shown < horizon ? "playing" : "revealed";
  const current: Play | null = guess ? { round, guess } : null;
  // The score and the field only move once the outcome has played out, so they never spoil it.
  const counted = phase === "revealed" && current ? [...plays, current] : plays;

  const lock = useCallback((g: Pick) => setGuess((prev) => prev ?? g), []);
  const skip = useCallback(() => setShown(horizon), [horizon]);
  const advance = useCallback(() => {
    if (advanced.current || !guess) return;
    advanced.current = true;
    onNext({ round, guess });
  }, [guess, onNext, round]);

  // Playback: one candle per tick, with a beat of suspense before the first.
  useEffect(() => {
    if (!guess || shown >= horizon) return;
    if (reduced) { setShown(horizon); return; }
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 500 : 140);
    return () => clearTimeout(t);
  }, [guess, shown, horizon, reduced]);

  useEffect(() => { if (phase === "revealed") nextRef.current?.focus(); }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (phase === "deciding") {
        if (e.key === "ArrowUp" || e.key.toLowerCase() === "b") { e.preventDefault(); lock("beat"); }
        else if (e.key === "ArrowDown" || e.key.toLowerCase() === "l") { e.preventDefault(); lock("lag"); }
      } else if (phase === "playing" && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        skip();
      } else if (phase === "revealed" && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, lock, skip, advance]);

  const race = guess ? raceAt(round.after, shown) : null;
  const correct = current != null && isCorrect(current);

  return (
    <div className="arena round">
      <Hud number={number} total={total} plays={counted} current={number - 1} />

      <div className="arena-grid">
        <section className="glass stage">
          <div className="stage-head">
            <span className="kind-chip"><span aria-hidden="true">{KIND[round.kind].icon}</span> {KIND[round.kind].label}</span>
            <span className="headline">{round.headline}</span>
          </div>
          <CandleChart before={round.before} sma200={round.sma200} after={guess ? round.after : undefined} shown={shown} horizon={horizon} />
          {/* always present, so the chart keeps the same size before and after you lock in */}
          <RaceMeter race={race ?? { stock: 0, spy: 0, excess: 0 }} day={shown} horizon={horizon} idle={!guess} />
        </section>

        <aside className="side">
          {/* once the outcome is in, the verdict card carries the reveal and the briefing is no longer needed */}
          {phase !== "revealed" && (
            <section className="glass briefing">
              <h2>Briefing</h2>
              <dl>
                {round.facts.map((f) => (
                  <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {phase === "deciding" && (
            <section className="glass call-panel">
              <h2>Your call</h2>
              <p className="q">Beat the S&amp;P 500 over the next {horizon} trading days?</p>
              <div className="call-buttons">
                <button className="btn-beat" onClick={() => lock("beat")}><span>▲</span> BEAT<small>↑</small></button>
                <button className="btn-lag" onClick={() => lock("lag")}><span>▼</span> LAG<small>↓</small></button>
              </div>
            </section>
          )}

          {phase === "playing" && guess && (
            <section className="glass call-panel locked">
              <h2>Locked in</h2>
              <p className={`lock-pill ${guess}`}>{arrow(guess)} {guess === "beat" ? "BEAT" : "LAG"}</p>
              <p className="muted">Day {shown} of {horizon}…</p>
              <button className="btn-ghost" onClick={skip}>Skip ⏭ <kbd>Space</kbd></button>
            </section>
          )}

          {phase === "revealed" && current && (
            <Verdict round={round} current={current} plays={plays} correct={correct} race={race!} number={number} total={total} nextRef={nextRef} onNext={advance} horizon={horizon} />
          )}

          <Field round={round} plays={counted} revealed={phase === "revealed"} />
        </aside>
      </div>
    </div>
  );
}

/** Before the call it holds its place, dimmed, so the chart does not change size when the race starts. */
function RaceMeter({ race, day, horizon, idle }: { race: Race; day: number; horizon: number; idle: boolean }) {
  const span = Math.max(10, Math.ceil(Math.max(Math.abs(race.stock), Math.abs(race.spy)) / 5) * 5);
  const bar = (v: number) => ({ width: `${(Math.min(Math.abs(v), span) / span) * 50}%`, [v >= 0 ? "left" : "right"]: "50%" }) as CSSProperties;
  const lead = race.excess;
  return (
    <div className={idle ? "race idle" : "race"} aria-live="off">
      <div className="race-head">
        <span>{idle ? "THE RACE · starts when you lock in" : `THE RACE · day ${Math.max(day, 0)}/${horizon}`}</span>
        {!idle && <span className={lead >= 0 ? "lead up" : "lead down"}>{lead >= 0 ? "Stock leads by" : "S&P leads by"} {Math.abs(lead).toFixed(1)} pts</span>}
      </div>
      {([["STOCK", race.stock], ["S&P 500", race.spy]] as const).map(([label, v]) => (
        <div className="race-row" key={label}>
          <span className="race-label">{label}</span>
          <div className="race-track"><i className="race-mid" /><b className={v >= 0 ? "race-bar up" : "race-bar down"} style={bar(v)} /></div>
          <span className={idle ? "race-val" : v >= 0 ? "race-val up" : "race-val down"}>{idle ? "–" : signed(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Verdict(props: {
  round: GameRound; current: Play; plays: Play[]; correct: boolean; race: Race; number: number; total: number; horizon: number;
  nextRef: RefObject<HTMLButtonElement>; onNext: () => void;
}) {
  const { round, current, plays, correct, race, number, total, horizon, nextRef, onNext } = props;
  const { current: streak } = streaks([...plays, current]);
  return (
    <section className={correct ? "glass verdict hit" : "glass verdict miss"} role="status">
      <div className="verdict-top">
        <p className="verdict-title">{correct ? "NAILED IT" : "MISSED"}</p>
        <p className="verdict-points">{correct ? "+1" : "+0"}</p>
      </div>
      {correct && streak >= 2 && <p className="verdict-streak">🔥 {streak} in a row</p>}
      <p className="verdict-text">
        You called <strong>{current.guess === "beat" ? "beat" : "lag"}</strong>. It <strong>{round.answer === "beat" ? "beat" : "lagged"}</strong> the market.
      </p>
      <div className="reveal-card">
        <span className="reveal-name">{round.reveal.name} <em>{round.reveal.ticker}</em></span>
        <span className="reveal-date">{round.reveal.date}</span>
        <span className="reveal-line">
          <b className={race.stock >= 0 ? "up" : "down"}>{signed(race.stock)}</b> vs S&amp;P <b className={race.spy >= 0 ? "up" : "down"}>{signed(race.spy)}</b> over {horizon} days
        </span>
      </div>
      <button ref={nextRef} className="btn-next" onClick={onNext}>{number === total ? "See results" : "Next round"} <kbd>Enter</kbd></button>
    </section>
  );
}

/** The signals and the player, with their record so far and, after the reveal, their call on this round. */
function Field({ round, plays, revealed }: { round: GameRound; plays: Play[]; revealed: boolean }) {
  const byPlayer = new Map(standings(plays).map((s) => [s.player, s]));
  const order: PlayerName[] = ["you", "trend", "tone", "insider", "turnover", "coin"];
  const callFor = (p: PlayerName): Pick | undefined => (p === "you" ? undefined : p === "coin" ? coinFlip(round.id) : round.bots[p]);
  return (
    <section className="glass opponents">
      <h2>The field</h2>
      <ul>
        {order.map((p) => {
          const s = byPlayer.get(p)!;
          const call = callFor(p);
          const hasView = p === "you" || p === "coin" || call != null;
          const acc = accuracy(s);
          return (
            <li key={p} className={`${p === "you" ? "me" : ""} ${hasView ? "" : "off"}`}>
              <span className="who">{PLAYER_INFO[p].label}</span>
              <span className="rec">{s.played === 0 ? "–" : `${s.right}/${s.played}`}</span>
              <span className="meter"><i style={{ width: `${(acc ?? 0) * 100}%` }} /></span>
              <span className={`call ${revealed && call ? (call === round.answer ? "ok" : "bad") : ""}`}>
                {p === "you" ? "" : !hasView ? "no view" : revealed && call ? `${arrow(call)} ${call === round.answer ? "✓" : "✗"}` : "?"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- finish */

function Podium({ rows }: { rows: Standing[] }) {
  const ranked = rows.filter((r) => r.played > 0).sort((a, b) => (accuracy(b) ?? 0) - (accuracy(a) ?? 0));
  const top = ranked.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter((r): r is Standing => r != null);
  const medal = (r: Standing) => ["🥇", "🥈", "🥉"][top.indexOf(r)] ?? "";
  return (
    <div className="podium">
      {order.map((r) => (
        <div key={r.player} className={`podium-slot place-${top.indexOf(r) + 1} ${r.player === "you" ? "me" : ""}`}>
          <span className="medal">{medal(r)}</span>
          <span className="p-name">{PLAYER_INFO[r.player].label}</span>
          <span className="p-acc">{pct(accuracy(r))}</span>
          <span className="p-rec">{r.right}/{r.played}</span>
        </div>
      ))}
    </div>
  );
}

function Finish({ plays, deck, onAgain }: { plays: Play[]; deck: GameDeck; onAgain: () => void }) {
  const rows = standings(plays);
  const baseline = deckStandings(deck.rounds);
  const you = rows.find((r) => r.player === "you")!;
  const rank = 1 + rows.filter((r) => (accuracy(r) ?? -1) > (accuracy(you) ?? -1)).length;
  const { best } = streaks(plays);
  const beatRate = deck.rounds.filter((r) => r.answer === "beat").length / deck.rounds.length;
  // The middle band of results a fair coin produces most of the time: 30% to 70% right.
  const luckLo = Math.ceil(plays.length * 0.3), luckHi = Math.floor(plays.length * 0.7);
  const score = points(plays);
  return (
    <div className="arena finish">
      <header className="finish-head">
        <div>
          <p className="eyebrow">FULL TIME</p>
          <h1 className="logo">{rank === 1 ? "TOP OF THE FIELD" : `YOU FINISHED #${rank}`}</h1>
          <p className="tagline">You called {you.right} of {plays.length} right.</p>
        </div>
        <button className="btn-start" onClick={onAgain} autoFocus>Play again</button>
      </header>

      <div className="finish-grid">
        <div className="finish-left">
          <Podium rows={rows} />
          <div className="stat-cards">
            <div className="glass stat-card"><span className="k">SCORE</span><span className="v">{score}/{plays.length}</span></div>
            <div className="glass stat-card"><span className="k">BEST STREAK</span><span className="v">{best >= 2 ? "🔥 " : ""}{best}</span></div>
          </div>
        </div>

        <div className="finish-right">
          <section className="glass table-card">
            <h2>Standings</h2>
            <table className="standings">
              <thead><tr><th>Player</th><th className="num">Right</th><th className="num">This game</th><th className="num">Whole deck</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const base = baseline.find((b) => b.player === r.player);
                  return (
                    <tr key={r.player} className={r.player === "you" ? "you" : undefined} title={PLAYER_INFO[r.player].rule}>
                      <td>{PLAYER_INFO[r.player].label}</td>
                      <td className="num">{r.played === 0 ? "–" : `${r.right}/${r.played}`}</td>
                      <td className="num">{pct(accuracy(r))}</td>
                      <td className="num muted">{base ? `${pct(accuracy(base))} of ${base.played}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="glass note">
            <p>
              <strong>How much to read into this.</strong> In {plays.length} rounds a coin flip lands {luckLo} to {luckHi} right about{" "}
              {Math.round(coinRangeChance(plays.length, luckLo, luckHi) * 100)}% of the time, so a small lead is luck.
              The <em>Whole deck</em> column is the fairer test: each signal over all {deck.rounds.length} rounds hovers around 50%, matching the research.
              The stock beat the S&amp;P 500 in {pct(beatRate)} of these rounds.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

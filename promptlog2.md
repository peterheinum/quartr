# Prompt Log 2 — freestyle

AI tool used: **Claude Code** (Sonnet 5) in the terminal.

`promptlog.md` covers the assignment itself, which is complete. This log covers
the extra, unscoped work built on top of it. Same rule: every prompt verbatim,
plus a summary of what the model did.

---

## 2026-09-28 — Prompt 1 — Start: 10-K analysis game

> Okay so we have a promptlog in this file which we need for all the prompts
> since this is a worktest and we need to log the prompts. Now i'm going to make
> a promptlog2 because this part is just me freestyling on top of the already
> complete thing. Lets begin.
>
> I want to analyze and download some k10 reports and make a little game to see
> if we can see the result of mentions of certain people or see if we can do
> some sort of sentiment analysis leading to forward predicting results

**Output:** Created this file and reviewed `promptlog.md`, `NOTES.md` and the
EDGAR client to see what can be reused (rate-limited `edgarFetch`, filings
normalization, `latestAnnualReport`). Asked scoping questions before building.

---

## 2026-09-28 — Prompt 2 — Scope answers; analysis first

Answers to the scoping questions:

- **Game:** the guess is whether the **stock went up or down** after the
  filing, not next-year revenue.
- **Target:** stock price move.
- **Sentiment:** both (dictionary as baseline, Claude as second opinion).
- **Location:** inside this app.
- "And lets start with analyzing we shouldn't make the whole game first."

> but lets start with only analyzing part then build the thing

**Output:** Analysis only, no game or UI yet. Working one validated step at a
time, as in the main log.

**Step 1 result (text extraction + people mentions), on the 11 downloaded
filings:**

- HTML → plain text works on all 11: Apple ~31k words per 10-K, Spotify 20-F
  ~100k, JPMorgan 10-K ~181k. (Scratch script, not yet in the repo.)
- **Finding: 10-Ks barely mention people.** Apple's FY2025 10-K names Tim Cook
  twice and Kevan Parekh five times, and nearly all of those are the signature
  block and power of attorney. Zero mentions of other executives. A "who is
  mentioned" signal from 10-K narrative text is close to empty; it would need a
  different source (earnings-call transcripts, 8-Ks, press releases).

---

## 2026-09-28 — Prompt 3 — What is the McDonald word list?

> what is the mcdonald word list thing you mentioned?

**Output:** Explained the Loughran-McDonald master dictionary (no code
changes).

---

## 2026-09-28 — Prompt 4 — Is it modern? Baseline framing

> So it's quite modern? Okay so we just use it to cross check basicly but it's
> still relatively blind since it lacks the context that a full claude analysis
> would do. Alright.

**Output:** Corrected "modern" (the method is old; the list is maintained) and
confirmed the framing: dictionary as a cheap, explainable baseline, Claude as
the context-aware second opinion.

---

## 2026-09-28 — Prompt 5 — Stock prices around filings

> I think this word list sounds relatively useless in todays terms but it's a
> fun thing to try anyhow. I think alot of speed algos just use that hard
> wordlist and just slam one direction. can we download the stock prices for 4
> of the stocks we have downloaded k10's for 5 days before and 5 days after +
> 30d after and 6m after so we can get some data points?

**Output:** Only three companies have downloaded filings (AAPL, SPOT, JPM), not
four, so I did those three and flagged it. Prices come from Yahoo's public
chart endpoint (no API key). Built `server/src/analysis/prices.ts` (pure
`windowAroundFiling` + `fetchDailyBars`) and `scripts/prices.ts`, which writes
daily bars and `windows.json` to the gitignored `.data/prices/`.

Design: the reference price is the close on the last trading day *before* the
filing date, since that is the last price that cannot reflect the filing.
-5d / 0d / +5d are trading-day offsets; +30d and +6m are calendar offsets,
rolled to the next trading day. Horizons past the last bar are reported
missing rather than invented.

Validated: spot-checked Apple closes against known values (144.80 on
2022-10-27, 270.37 on 2025-10-31). 6 new tests, 63 total pass, typecheck clean.
All 11 filings produced windows.

**Caveat found in the data:** the filing date is not the news date. Apple's
2022-10-28 10-K shows +7.6% on day 0, but that is the reaction to earnings
released the evening before. Spotify's 2022 20-F day-0 drop is likewise its
earnings reaction. A 10-K mostly repeats what earnings already said, so
price moves around it are dominated by earnings, not by the document's tone.

---

## 2026-09-28 — Prompt 6 — Score with Loughran-McDonald and correlate

> Yes please score them with the mcdonald thing and see how useful the
> correlation between returns and that one is

**Output:** Downloaded the Loughran-McDonald master dictionary (86,553 words;
2,355 negative, 354 positive, 297 uncertainty) from the official Notre Dame
link (hosted on Google Drive) into the gitignored `.data/lm/`. Confirmed it
behaves as the paper claims: `LIABILITY` and `TAX` are neutral, `LOSS` is
negative.

Built `server/src/analysis/sentiment.ts` (dictionary parser that rejects an
unexpected header, tokenizer, `scoreText`, `htmlToText`) and
`scripts/sentiment.ts`. 6 new tests; 69 pass, typecheck clean.

Returns are measured **relative to SPY**, so the test asks whether tone
mattered rather than whether the market rose.

**Result: no usable correlation.** 11 filings, four horizons, four ways of
slicing the tone score:

| test | best |r| | p |
|---|---|---|
| tone level vs excess return (n=11) | 0.21 | 0.54 |
| negative-word share vs excess return (n=11) | 0.24 | 0.48 |
| year-over-year change in tone (n=8) | 0.43 | 0.29 |
| year-over-year change in negative words (n=8) | 0.31 | 0.45 |

Nothing is anywhere near p < 0.05, and the signs flip between horizons. Why it
comes out flat, from the data:

- **The score barely moves.** Apple's net tone ranges only -0.546 to -0.572
  over five years; year-over-year changes are ~0.01. Boilerplate risk-factor
  language dominates a 10-K, so the tone is almost constant.
- **Level comparisons across companies are confounded by form type.** Spotify
  (20-F) sits near -0.42 and Apple/JPM (10-K) near -0.56, a house-style
  difference and not a sentiment one.
- **The returns are mostly earnings.** The biggest moves (Spotify 2022: -14% on
  day 0, -28% at 6m; Spotify 2026: +15%) come from earnings and the market
  around them, not from the filing's wording.
- **Power.** With n=8, |r| must exceed about 0.71 to reach p < 0.05, so this
  test could only have detected a very strong effect.

Interpreted honestly: this shows the dictionary has no strong effect at this
sample size, not that it has none. A "hit-rate" of 7/8 on one horizon appeared
and is exactly the kind of result to distrust at n=8 across 16 comparisons.


## 2026-09-28 — Prompt 7 — (mid-turn) 200 days of history for technicals

> I think we have to download more data actually, like 200 days before the
> reports aswell. I want to do some 200 moving avarage stuff and some technical
> stuff so can you start the download for that aswell? :)

**Output:** Extended the price download for technical analysis. Lookback is now
400 calendar days before the earliest filing (about 277 trading days, enough for
a 200-day moving average at every filing date), and bars keep open, high, low
and volume instead of just the close. SPY is downloaded as a benchmark. Verified
every ticker has 1,508 bars from 2020-09-24 with full OHLCV, and at least 277
bars before its first filing.


---

## 2026-09-28 — Prompt 8 — Does distance from the 200-day average help?

> Yep that makes sense, it's a weak correlation because the metric is too
> simple. It can only be used for the quick trade. Lets check if we also
> include the distance from the sma200 up or down into this mix, does that
> strengthen the correlation if we know the long term trend?

**Output:** Added `server/src/analysis/technical.ts` (`sma`, `distanceFromSma`,
using only bars up to the reference date so it is knowable before the filing),
and `stats.ts` (pearson, OLS, leave-one-out R²). 6 new tests; 75 pass, typecheck
clean. `scripts/technicals.ts` compares four models of excess-vs-SPY return:
tone alone, trend alone, tone + trend, and tone + trend + tone×trend. Tone is
taken relative to each company's own average to strip out 10-K vs 20-F house
style.

**Result: no, it does not strengthen anything that holds up.**

In-sample it looks like it does: at day 0, R² rises 0.25 (tone) -> 0.40 (tone +
trend) -> 0.62 (with interaction). But adding a predictor always raises
in-sample R², especially at n=11. The honest measure is leave-one-out R²
(predicting each filing from a model that never saw it), and that is **negative
for nearly every model at every horizon** (worse than guessing the average).
The single exception is tone alone at +5d, at 0.01 (i.e. no better than the
average). The best-looking fit, the +30d interaction model (adjusted R² 0.70),
scores -0.07 out of sample.

**The correlations are driven by two points.** Tone correlated *negatively*
with returns (-0.50 at day 0), opposite to the theory. Two Spotify filings
cause it: 2022 (highest relative tone, worst return, -14% at day 0) and 2026
(low tone, +15%). They are also the two most extreme trend readings (-20% and
-36% below the SMA200). Dropping just those two flips the tone correlation:
day 0 goes -0.50 -> +0.27 and +30d goes -0.33 -> +0.65. A relationship that
changes sign when two of eleven points are removed is not a relationship.

Trend alone (distance from SMA200) correlates weakly (-0.20 to +0.32) and its
sign changes with the horizon. So we cannot say from this data whether the
long-term trend helps; the sample is far too small to answer it either way.

---

## 2026-09-28 — Prompt 9 — Scale up to ~300 filings

> yeah I think it would be interesting with more data here.

**Output:** Built a corpus of 10-Ks: 30 large US companies, every original
(non-amended) 10-K filed 2016 to March 2026 (late enough for a 6-month return).
Reused the app's rate-limited EDGAR client and filing normalization; added
`edgarFetchText` for HTML documents (refactored `edgarFetch` onto a shared
request function). Each filing is scored in memory and only the scores are kept
(`.data/corpus/scores.jsonl`), so the ~450 MB of HTML never touched the disk.
`scripts/corpus.ts` is resumable. 320 filings scored, 0 download failures.

Data-quality checks turned up three real problems before any analysis:

1. **XOM resolved to the wrong entity.** EDGAR's ticker map now points `XOM` at
   a 2026 holding company (`ExxonMobil Holdings Corp`, CIK 2115436, 34
   filings); the history is under Exxon Mobil Corp (CIK 34088). Pinned XOM to
   the old CIK in the script. Same family of problem as Disney below.
2. **Exhibit-wrapper 10-Ks.** Some companies file a thin 10-K that incorporates
   the annual report from an exhibit: Wells Fargo's are ~12k words in every
   year, Pfizer's jump from ~32k to ~90k words in 2021, Walmart's from ~22k to
   ~50k in 2018. The tone of a wrapper is not comparable with a full document.
   Dropped 18 filings (WFC 11, PFE 5, WMT 2) with a rule: under 15k words or
   under 60% of the company's median.
3. **Disney has only 7 10-Ks** because a 2019 restructuring moved it to a new
   CIK; left as is.

Also moved the p-value and Spearman helpers into `stats.ts`, with tests
checked against t-table values (r=0.5, n=12 -> p=0.098). The earlier 11-filing
results reproduced exactly after the refactor. 83 tests pass.


## 2026-09-28 — Prompt 10 — (mid-turn) Include Fed sentiment

> I think what would be interesting to also take into consideration since we're
> doing sentiment, is also include the FED sentiment during this period

**Output:** Added the Fed in two forms, deliberately separating soft from hard:

- **Soft: FOMC statement tone.** Scraped all 92 FOMC statements 2016-01 to
  2026-09 from federalreserve.gov (article body only, voting list stripped) and
  scored them with the same Loughran-McDonald dictionary. Caveat: that
  dictionary measures financial-report tone, not hawkish vs dovish, so this is a
  crude proxy for "Fed sentiment".
- **Hard: the fed funds target rate**, daily, from FRED (`DFEDTARU`), giving the
  level and the 12-month change (hiking / flat / easing regime).

For each filing the Fed features are taken from the last statement strictly
before the filing date. `server/src/analysis/fed.ts` has 6 tests. A FRED
request hung with no timeout and blocked the script; killed it, added a 20 s
timeout and retries.

**Results, 284 filings across 29 companies, returns in excess of SPY.**

| feature | 0d | +5d | +30d | +6m |
|---|---|---|---|---|
| 10-K tone vs own average | +0.05 | +0.01 | -0.05 | -0.01 |
| 10-K tone change YoY | +0.03 | -0.02 | -0.06 | -0.05 |
| distance from SMA200 | -0.06 | -0.00 | -0.12 | **+0.29** |
| Fed statement tone | +0.05 | +0.02 | +0.08 | +0.00 |
| Fed tone change | +0.07 | -0.00 | +0.06 | +0.01 |
| Fed rate 12m change | +0.04 | -0.02 | -0.11 | +0.06 |

(Pearson r; every cell is non-significant except SMA200 distance at +6m,
p < 0.01, and marginally at +30d, p = 0.05.)

- **The dictionary tone has no relationship with returns at any horizon**
  (|r| <= 0.06, Spearman <= 0.03). With n=284 that is a clear null, not the
  "too little data" verdict of the 11-filing runs.
- **Fed tone adds nothing**, and neither does the rate level.
- **Trend is the one thing that holds up**, at +6m: stocks above their 200-day
  average went on to beat SPY. Out-of-sample (leave-one-out) R² is +0.042, in
  sample 0.087. Small but positive, and the only model whose out-of-sample
  score is above zero. Adding Fed rate change or Fed tone does not improve it
  (0.042 / 0.036).
- **Regime split:** tone vs 6-month excess return is -0.19 (p=0.04) when the Fed
  is hiking, +0.22 (p=0.06) when flat, ~0 when easing. A sign flip that fits
  the idea "the same tone means different things in different regimes", but it
  is 12 tests, two of them near p=0.05, which chance alone produces about half
  the time. Suggestive, not established.

**Caveats that matter for the trend result:**

- **Survivorship / hindsight selection.** The 30 companies were picked as
  today's giants (NVDA, TSLA, META, NFLX among them). A stock far above its
  200-day average that kept winning is the shape of that bias, so the +6m trend
  effect is probably overstated.
- **Overlapping observations.** Filings cluster in February and share market
  shocks (the 2022 hiking cycle is most of the "hiking" bucket), so the p-values
  assume more independence than there is.


---

## 2026-09-28 — Prompt 11 — Blend all three signals

> so if we add all 3, trying different weights with sma200 distance, fed
> sentiment and the mcdonald sentiment how would we land?

**Output:** Extracted the observation building from `analyze.ts` into
`server/src/analysis/dataset.ts` (results reproduced exactly), then wrote
`scripts/blend.ts`. It scores each filing as a weighted sum of three z-scored
signals (10-K tone, SMA200 distance, Fed statement tone), searches 124 weight
combinations (each weight in -1, -0.5, 0, 0.5, 1), and evaluates two ways:

- **In-sample:** best weights over all data. Optimistic by construction.
- **Walk-forward:** for each test year 2019-2026, choose weights using only
  filings whose outcome (filing date + horizon) was known before that year
  began, then score that year. Pooled out-of-sample result. This is the number
  that counts.

Baselines: equal weights, and each signal alone.

**Result: the tuned blend collapses to "trend only".**

| horizon | in-sample r | walk-forward r | hit rate | top-vs-bottom third |
|---|---|---|---|---|
| 0d | +0.09 | -0.01 | 43% | -0.1pp |
| +5d | +0.02 | -0.04 | 48% | -1.1pp |
| +30d | +0.15 (p=0.01) | +0.07 | 45% | -0.5pp |
| +6m | +0.30 | +0.31 | 51% | +4.5pp |

- **0d to +30d: nothing.** The +30d in-sample fit looks significant (p=0.01)
  and is pure overfitting: it falls to +0.07 out of sample, and the chosen
  weights flip sign from year to year (Fed weight goes -0.5, -1.0, +0.5, +1.0).
  Unstable weights are what noise looks like.
- **+6m: the search picks the same weights in nearly every year** - tone 0,
  trend +0.5, Fed 0. So the blend *is* the trend signal. Equal weights
  (r=0.22) do worse than trend alone (r=0.35): adding 10-K tone or Fed tone
  dilutes it. 10-K tone alone is -0.07, Fed tone alone +0.03.
- **Hit rate is ~50% even where correlation is 0.3.** That is a warning that the
  correlation is carried by magnitude, not by getting the direction right.

**Outlier check on the +6m trend signal** (trend distance vs 6-month excess):

| sample | Pearson | Spearman |
|---|---|---|
| all 284 | 0.29 | 0.11 |
| without NVDA, TSLA | 0.17 | 0.09 |
| without NVDA, TSLA, META, NFLX | 0.13 | 0.03 |

Most of the correlation is a handful of hindsight winners (NVDA averages +39pp
excess over 6 months). The rank correlation is close to zero without them. What
does survive is a directional split: filings from stocks below their SMA200 beat
SPY 36% of the time (n=83, median -4.2pp) versus 51% for stocks above it
(n=201, median +0.8pp), a difference of roughly two standard errors by my
back-of-envelope two-proportion check (not computed in the code). Still
suggestive only: overlapping observations and a hindsight-picked company list.


---

## 2026-09-28 — Prompt 12 — Close the sentiment angle; people across reports

> Interesting. So basicly, we can conclude this research angle at this stage,
> pretty useless then? I think it's fair because it's too simple and easy, so
> it's done already. Lets go to the next idea. Do we have any people mentioned
> showing up in multiple reports?

**Output:** Agreed to close the sentiment/trend/Fed angle for this form of the
idea. Open loose end noted, not pursued: the below-SMA200 directional split
needs a hindsight-free company list (e.g. the S&P 500 as of 2016) to confirm.
Moved to people mentions; see below.

**Result (people, 11 downloaded filings; scratch script, not in the repo):**
extracted the `/s/ Name` signature blocks, the one place 10-Ks reliably name
people. 36 distinct signatories, 17 of them appearing in more than one filing,
**all within Apple** (Cook, Levinson, Sugar, Wagner and Kondo in all five years).
**Zero cross-company overlap**, as expected with only two US filers on disk.
Spotify's 20-F has a single signatory (the company itself), so it names no
directors there.

Turnover is visible in the signatures: Luca Maestri appears FY2021-24 and is
gone in FY2025, replaced by Kevan Parekh; Al Gore signs 2021-22 only; James
Bell 2021-23. The regex is crude (it swallows trailing title words such as
"Director" or "Senior Vice"), so names would need cleaning before real use.

---

## 2026-09-28 — Prompt 13 — Executive options and payouts in the reports?

> Is there anything about the executives recieving options or payouts in these
> reports?

**Output (Prompts 13 and 14):** checked the three latest filings on disk
rather than answering from general knowledge. Whether per-executive pay is in
the report depends on the form:

| filing | executive pay in the document? |
|---|---|
| Apple 10-K | **No.** Item 11 reads "included in the 2026 Proxy Statement, and is incorporated herein by reference". Only company-wide stock-comp totals (35 mentions of RSUs) and a Rule 10b5-1 reference. |
| JPMorgan 10-K | **Mostly no.** Item 11 says "Refer to Item 10". But Item 9B carries a table of Rule 10b5-1 trading plans adopted by named officers in Q4 2025 (e.g. the Chief Risk Officer and the CFO, each planning to sell 50% of net shares from PSUs vesting 2026-03-25). Named people, dates, and share amounts. |
| Spotify 20-F | **Yes, in full.** A foreign private issuer's 20-F must include compensation (Item 6): named executives' base salaries, an aggregate long-term-incentive dollar value per executive split across at-the-money options, out-of-the-money options, RSUs and cash, plus a Summary Compensation Table and severance terms. 78 mentions of "stock option", 46 of "named executive". Example: Daniel Ek takes no salary; Alex Norstrom's 2025 long-term award is $12.5M. |

So for US filers the details live elsewhere: the **proxy statement (DEF 14A)**
holds the Summary Compensation Table, option grants and payouts, and **Form 4**
filings report each executive's actual option exercises, RSU vesting and share
sales within two business days. Both are ordinary EDGAR filings the app already
indexes (the UI labels Form 4 as a structured "form", per Prompt 15 of the
main log). The 10-K itself contributes the 10b5-1 plan disclosures (required
since 2023) and the exhibit list of compensation agreements.

Turnover (Prompt 14) and pay sit in the same sources: an executive's departure
appears as an 8-K (Item 5.02) the day it happens, well before the 10-K
signature block shows the change.


## 2026-09-28 — Prompt 14 — (mid-turn) Turnover is also interesting

> turnover is also interesting

**Output:** Noted: executive turnover joins the list of people-based ideas
(it is also where pay-related events like severance and departures show up).
Answered together with Prompt 13; see Prompt 13 above.

---

## 2026-09-28 — Prompt 15 — Do insider buys/sells predict returns?

> lets look at the forward predicting ability to insiders buying or selling
> their stock then

**Output:** Built the insider-data pipeline and ran a first analysis; see the sections below (Progress, Scale, Results).


**Progress (insider data):** Form 4 detail is not in the app's EDGAR index
(only the filing metadata), and downloading tens of thousands of individual
Form 4 XML files is too heavy. Used the SEC's quarterly *Insider Transactions
Data Sets* instead (bulk TSVs of every Form 3/4/5, 9-14 MB per quarter).
`scripts/insider.ts` downloads one quarter at a time, extracts the three tables
it needs, aggregates to one row per filing and code, appends to
`.data/insider/events.jsonl` and deletes the archive (disk was down to 1.5 GB).
Kept: Form 4 open-market purchases (code P, >= $25k) and sales (code S, >= $100k)
of common stock by officers and directors. Excluded pure 10%-owner filers, which
dominate the raw purchase list (funds, PIPEs, holding companies such as a $68M
Liberty purchase) and are not insider conviction. Sales carry the filing's
10b5-1 flag, since about 45% are pre-scheduled and carry little information.

Two bugs on the way: the SEC's link path differs by quarter (2026q2 sits under a
different directory), and the `tar` on Git Bash's PATH is GNU tar, which cannot
read zip archives; the script calls Windows' own `tar.exe` by path. My first
version also leaked temp files on failure; now cleaned in a `finally`.

Design for the forward test: entry is the close of the first trading day
*strictly after* the filing date (a Form 4 filed after the close is not
tradable that day), excess return is vs SPY, offsets are trading days, and rows
are clustered into one event per issuer per 90 days so events are closer to
independent. `server/src/analysis/insider.ts` with 7 tests.

**Scale.** Processed all 42 quarters (2016Q1-2026Q2): 297,700 officer/director
Form 4 rows (54,448 purchases, 243,252 sales), clustered to 24,238 buy events
across 6,198 tickers and 45,918 unplanned-sale events across 5,207 tickers.
Prices for the 7,221 tickers are downloading in the background (about 65 per
minute, random order, resumable), so the results below are on a random partial
sample and will move.

**Survivorship gap, measured, not assumed.** About 40% of tickers (527 of the
first 1,300) are unavailable on Yahoo: acquired (Akero, Scripps Networks, WNS),
merged away, or delisted. Those are the outcomes that matter most for insider
signals (buyouts at a premium, bankruptcies), and they are missing from every
number below.

**Data problems found while checking numbers:**

1. **One glitchy ticker wrecked the means.** A random-date control gave a mean
   excess of +3.9% against a median of -0.4%. Cause: one micro-cap (CAUD) with a
   +9,900% "return" and a -101% (impossible) value. Fixed by winsorizing every
   horizon at its 1st/99th percentile and reporting medians too. The first
   "vs control" table was garbage for this reason and is not used.
2. **Two controls, because one was not enough.** (A) the same ticker on random
   other dates removes survivorship and stock drift, but not *timing*: insiders
   sell heavily before a downturn in the *stock's own* history. (B) other stocks
   on the *same date* removes market regime and style. They disagree, and the
   disagreement is informative (below).
3. Junk tickers (`NYSE: N`), a mutual fund filing Form 4, and trade prices that
   do not match the ticker's price (reused symbols). Filtered with a
   plausibility check plus a Form 4 price vs Yahoo close comparison that accepts
   clean split factors.

**Results** (excess vs SPY, winsorized; ~6.8k events, ~625 tickers, t clustered by
filing month; "vs B" = event minus other stocks on the same date):

| group | 1m | 6m | 1y |
|---|---|---|---|
| BUY, all | +0.8 (t 2.4) | +2.7 (2.1) | +4.8 (2.4) |
| BUY, price >= $10 | +0.8 (1.8) | +1.6 (1.9) | +1.4 (1.4) |
| BUY, price < $5 | +1.5 (0.1) | +7.7 (1.4) | +17.7 (1.8) |
| SELL unplanned, price >= $10 | +0.1 (1.4) | -0.8 (-2.1) | -0.9 (-1.9) |

- **Purchases: the apparent edge is a penny-stock effect.** Overall buys beat
  same-date peers, but for stocks at $10 or more the excess is small and
  insignificant at every horizon; nearly all of it comes from stocks under $5
  (+17.7 at one year), which are thinly traded and cannot be bought at the
  quoted price at any size. Buys by multiple insiders show more at 1y (+10 in
  the first 496-ticker cut) but that did not hold as the sample grew.
- **Sales: nothing vs peers.** Against the same ticker's random dates, unplanned
  sales look terrible (-10.7% at one year, t = -8.0). Against other stocks on
  the same date it is ~0. The first number is a timing artifact (the same
  ticker's other dates include its rebounds), and a fair reading of the second
  is "insider selling does not predict anything once the market and period are
  controlled". This is the exact trap the two-control design was built to catch.
- Median stock in every group underperforms SPY (%>SPY 39-49%), so a rule
  "buy what insiders bought" would lose more often than it wins.

---

## 2026-09-28 — Prompt 16 — Wait, all buys, not just our companies?

> wait so we now checked all the buys from the executives not only the companies
> we look for now? lol

**Output:** Yes, and it was a deliberate but under-announced change. The bulk
insider data set covers every issuer, and the original 30 companies barely
trade their own stock: across 2016-2026 they account for 6,201 of 297,700
officer/director rows, only **243 of them purchases** (Apple, Alphabet, Meta,
P&G and PepsiCo have none at all; Intel alone has 48). Before clustering that is
far too few to test anything, so the analysis widened to every ticker with
insider trades (7,221 tickers). Consequence: the results describe *US-listed
stocks in general*, weighted heavily to small caps, not the mega-cap set used for
the tone and Fed analysis. The price >= $10 split is the closest thing to a
"tradable, larger company" view, and that is where the buy signal disappears.

---

## 2026-09-28 — Prompt 17 — Only the big companies we look at

> nah we dont need to do all of this just for the big companies we look at not
> other ones.

**Output:** Dropped the wide universe. Stopped the background price download
(about 1,900 of 7,221 tickers), deleted its partial price files and the
`insider-prices.ts` script, and pointed `insider-analyze.ts` at the 30 companies
whose 10-Ks we scored, using the price files already on disk.

831 usable events (907 clustered, 76 dropped by the trade-price check): 135 buys
and 563+ unplanned sales at the 30 large companies.

**Result: no signal, and the controls do not work at this size.** Plain excess
return vs SPY: after insider purchases the mean is about 0 (-0.4% at 3m, -1.8% at
6m), the median is negative (-3.6% at 6m) and only 42-50% of stocks beat SPY.
Unplanned sales: mean about 0, 45-52% beat SPY. The two comparison controls
produced nonsense here (e.g. "-49.9% vs same-ticker control at 1 year"): hyper-
growth names like NVDA and TSLA make same-ticker control dates hugely positive
and leave few dates far from any insider sale, and the same-date peer pool is 30
hindsight-picked winners, so anything looks bad against it. The controls were
built for a broad universe and are not valid on 30 names; those columns are not
findings. Bugs on the way: my edit again broke a string escape in the script and
used a constant before defining it.


## 2026-09-28 — Prompt 18 — (mid-turn) Which reports to download for technical analysis

> Okay so I am going to analyze some technical stuff on my other computer,
> apple jpmorgan spotify and nvidia, what k10 reports should I download on it?
> can you give me a list so i can just copy paste it over and do my technical
> analysis magic?

**Output:** Generated the annual-report list from EDGAR for the four companies:
AAPL 10 reports (FY2016-25), JPM 11 (FY2015-25), NVDA 11 (FY2016-26, fiscal
year ends late January), SPOT 8. **Spotify files a 20-F, not a 10-K** (it has
never filed a 10-K; see the main log), so its list is 20-Fs from 2019, when it
first filed one after its 2018 listing. 40 reports total, saved with filing and
period dates to `.data/download-list.tsv` (gitignored). SEC requires a
User-Agent with contact info on downloads.

---

## 2026-09-28 — Prompt 19 — Executive turnover, then wrap up

> yes lets do turnover aswell and then i'll do the technical analysis on my
> other computer and we will combine it all for the wrap up

**Output:** Built the turnover pipeline for the 30 companies in four validated
steps.

1. **List.** The app's filing index records 8-K item numbers, so
   `scripts/turnover-list.ts` found 869 8-Ks carrying Item 5.02 (departure or
   appointment of directors and officers) since 2016. No company's history was
   partial.
2. **Text.** `scripts/turnover-fetch.ts` downloaded all 869 (0 failures) and kept
   only the Item 5.02 text (a few KB each), so classification can be reworked
   without re-downloading. `extractItem` in `sentiment.ts` (2 tests). Bug: the
   first run stored empty sections because a regex inside a template string lost
   its backslashes (`\s` became `s`); caught by a failing test, run redone.
3. **Classify.** `server/src/analysis/turnover.ts`: sentence-level rules, a role
   (CEO, CFO, other officer, director) and an action verb close together, with
   the boilerplate item heading stripped first (it contains every action word).
   Two rounds of tightening from reading flagged sentences: pay and governance
   language does not count ("retention award", "mandatory retirement policy"),
   and CEO/CFO must be the filer's OWN. Segment heads ("CEO, Walmart
   International", "Boeing Defense, Space & Security", "PepsiCo Beverages North
   America"), other firms' CEOs in a director biography, and "reporting to the
   CEO" are rejected. 20 tests, built from the real false positives.
4. **Measure.** `scripts/turnover-analyze.ts`.

**Validation.** Recall 11 of 11 on events known to have happened (Gelsinger
resigns, Calhoun steps down, Iger returns, Maestri/Parekh, Hastings, Witty,
Stumpf, Taneja, Barnum and others). Precision from reading all 31 CEO-departure
flags: about 24 real changes at the top, 7 false (biographies, a division CEO,
"its CEO" of a subsidiary), roughly 75%. Filtering CEO departures from 66 down
to 31 flags is what cost recall risk for precision.

**Results** (excess vs SPY, event minus the same company's random other dates):

| group | n | 2-day reaction | 3m | 6m | 1y |
|---|---|---|---|---|---|
| CEO leaves | 31 | -1.1 (t -1.7) | -2.1 | -3.9 | -1.1 |
| CEO appointed | 66 | -0.4 | -2.0 | -1.2 | -0.1 |
| CFO leaves | 36 | -0.8 | -3.5 | -4.2 | -4.6 |
| CFO appointed | 65 | +0.1 | -4.7 (t -2.1) | -5.4 | -8.6 |
| CEO or CFO, any | 133 | -0.1 | -2.0 | -1.8 | -3.8 |
| other officer leaves | 88 | +0.4 | +0.3 | +3.1 | +10.5 (t 1.7) |

No group is significant once you allow for the number of tests (7 groups x 6
windows = 42; about two would reach |t| > 2 by chance, and exactly two nearly
do). The only consistent-looking pattern is a small negative reaction when a CEO
leaves (-1.1pp over two days, 45% beat SPY). Large companies barely move on
turnover, and the 8-K often lags the press release by up to four days, so the
reaction window can miss the announcement day. Tests: 114 pass.


---

## 2026-09-28 — Prompt 20 — Clean up; put research scripts in their own folder

> Cool. Lets clean up this research part and put the research scripts into a
> folder that we can call reserach scripts or something

**Output:** Moved all research code out of the assignment's `server/` into a
new top-level `research/` folder:

- `research/src/` the analysis modules (moved from `server/src/analysis/`),
- `research/test/` their tests (moved from `server/test/`),
- `research/scripts/` the runnable pipelines, with the 11-filing pilot scripts in
  `research/scripts/pilot/` (superseded by the 30-company versions),
- `research/README.md` a map: findings table, run order, data layout, caveats.

Scripts renamed to say what they do (`insider.ts` to `insider-events.ts`,
`fed.ts` to `fed-download.ts`, `corpus.ts` to `tenk-corpus.ts`, `analyze.ts` to
`tone-analyze.ts`, `blend.ts` to `tone-blend.ts`), because a script and a module
sharing a name (`insider.ts`, `fed.ts`) was confusing. Root `package.json` test
script now covers `research`; the main README layout section points to it.

**What the cleanup found.** `research/tsconfig.json` type-checks the scripts for
the first time (they had sat outside any config) with unused-code checks on. It
found three leftovers (two unused variables, one unused import/parameter), fixed.
Every script was then re-run from its new location and reproduced its earlier
numbers exactly (284 tone observations, the same blend table, 907 insider events,
31 CEO departures). The download scripts were not re-run (rate-limited, slow);
they type-check and only their import paths changed. Tests: server 57, web 13,
research 57 = 127, all pass.

**One correction to an earlier statement.** I had said the price files run from
2020-09 for all four of AAPL/JPM/NVDA/SPOT. Actually AAPL, JPM and NVDA go back to
2014-11 (the 30-company download rewrote them). Spotify was the exception: only
from 2020-09, because it is not one of the 30, which left its 2019 and early-2020
20-F filings with no price window. Downloaded Spotify from its 2018-04-03
listing (2,133 bars, opening price about $149 as expected).

The only change to the assignment's own code is `server/src/edgar/client.ts`:
`edgarFetch` now shares a private request function with a new `edgarFetchText`
(for HTML documents). Behaviour of `edgarFetch` is unchanged.


## 2026-09-28 — Prompt 21 — (mid-turn) "tidy tidy"

> tidy tidy

**Output:** Acknowledged; continuing the Prompt 20 cleanup.

---

## 2026-09-28 — Prompt 22 — Something interactive for the demo

> Okay, so, since we did not find any strong correlations or anything like that.
> I still want something interactive for our demo later. So I think, what we
> could do is perhaps, see if we can rank correlations and play a game of that?
> or do you have any other ideas for games we can play?

**Output:** Offered four games grounded in the research: (1) Call It: up or
down, real hidden-company events with the signals as bots on a live leaderboard,
(2) Signal or Noise, real vs shuffled scatter plots, (3) a p-hacking simulator,
(4) Guess the Chart. Noted that ranking the correlations directly is a poor game
because they are all near zero, so the ranking would be noise. Recommended (1),
which turns "rank the signals" into a scoreboard that emerges from play.

> (answer to the follow-up question: **Call It: up or down**)

Next: build the round data in `research/`, then a new tab in the web app.

**Build (Prompt 22 continued).** Built Call It end to end.

- **Data.** `research/src/game.ts` (price window, 200-day average, rebasing, the
  four signals' rules, wording helpers) and `research/scripts/game-rounds.ts`.
  Output: `web/public/game-rounds.json`, 240 rounds (80 each of 10-K, insider,
  turnover), 556 KB, 52% of rounds where the stock beat SPY. Contract types in
  `shared/src/game.ts`.
- **Checks before any UI.** No company name, ticker or year appears in any
  pre-guess text (0 leaks of 240). 6 of 6 random rounds recomputed independently
  from the raw price files matched to the cent. A test rewrites all post-decision
  prices and asserts everything shown before the decision is unchanged.
- **Fairness decisions.** Chart y-axis scaled from visible data only (a scale
  including the hidden future would hint at the outcome). Insider facts use only
  the filings made on the decision day: the research clusters aggregate 90 days of
  later filings, which would leak. At most 6 rounds per company per kind (Intel
  alone has 48 insider buys).
- **UI.** A hash-routed second tab (`#/call-it`) so the existing URL-state code
  and its tests are untouched. `web/src/game.ts` holds the pure logic (dealing a
  balanced hand, scoring, standings, deck baseline), 15 tests. `PriceChart` is
  plain SVG, `CallIt` is the game. Verified in a browser: chart, hidden future
  window, reveal with the S&P line, live standings, results screen, and that the
  Filings tab and back button still work.
- **The result the game shows.** Across the whole deck the signals score: trend
  50% (240 rounds), turnover 49% (80), tone 48% (80), insider 48% (80), coin flip
  51%. In one test hand the trend bot went 7/10 and the player 4/10, while the
  whole-deck column still said 50%: exactly the point of showing it, and why the
  end screen states that a coin flip lands 3 to 7 right of 10 about 89% of the
  time.
- Production build passes (55 KB gzipped). 157 tests: server 57, web 28, research 72.
- Cost of the browser check: two screenshot timeouts that were the capture tool,
  not the page (the page tree and text were readable both times). Left the
  already-running dev server alone; closed the tab I opened.

---

## 2026-09-28 — Prompt 23 — (mid-turn) Add the user's SMA200 + ADX backtest

> I did this backtest with sma200 and adx, compared to always buying the report
> earnings_rule_backtest.png can we include this backtest in the research files?
> :)

**Output:** Found `earnings_rule_backtest.png` in `~/Downloads`, copied it to
`research/results/earnings_rule_backtest.png` (223 KB) and added a section to
`research/README.md` with the chart, the setup as printed on it (21-trading-day
hold from the last close before each earnings report, October 2020 to August 2026,
no costs, rules chosen in-sample), a results table, and how to read it. The
script that produced it is not in the repo; only the image was provided.

Checked the chart's own arithmetic: the equal-weight portfolio equals the average
of the four stocks' end values (buy and hold: (3.01 + 4.12 + 2.04 + 16.62) / 4 =
6.45x = +545%; every report 1.58x = +58%; filtered 1.57x = +57%). All three match.

What it shows: both rules trail buy and hold on every stock, but they are invested
far fewer days (about 34% for "every report", 7-14% for the trend-filtered rule),
so the comparison is not like for like. The trend filter (above SMA200 and
ADX >= 25) helped SPOT and NVDA, hurt AAPL and JPM, and left the portfolio level
(+58% vs +57%), consistent with the main finding that the 200-day trend has at
best a small, unstable effect. 5-10 trades per stock is too few to separate a
rule from a lucky path, and NVDA is about 64% of the buy-and-hold portfolio.


---

## 2026-09-28 — Prompt 24 — Open the game in my browser

> can you open up the link in my browser so i can play it?

**Output:** Opened http://localhost:5173/#/call-it in the connected Chrome and left the tab open for playing.

---

## 2026-09-28 — Prompt 25 — Gamify the UI: candles that play out against the S&P 500

> Okay it looks functionally cool but it looks UI wise, really boring. Lets
> gamify this one to be more interactive and stuff! Perhaps the candles could
> play out and compare to sp500 candles after we guess to deliver the answer?

**Output:** Rebuilt Call It as a night-mode game with candlesticks that play out
against the S&P 500, on a log scale (Prompts 26 and 27 arrived mid-turn and are
folded in).

- **Data.** The deck now carries real OHLC candles for the stock and for SPY, 90
  days before and 21 after, each rebased to 100 at its own decision-day close
  (`research/src/game.ts`, `shared/src/game.ts`). 1.6 MB (was 0.56 MB). Same 240
  rounds and answers as before; signal accuracies unchanged (trend 50%, turnover
  49%, tone 48%, insider 48%).
- **Checked.** 8 random rounds recomputed independently from the raw price files, all
  four candle series (stock and S&P, before and after), matched; 0 malformed
  candles; 0 name/ticker/year leaks in pre-call text; 19 tests including one that
  rewrites the future and asserts the past is unchanged.
- **Log scale, fair comparison (Prompt 26).** `web/src/chartScale.ts`: both panels use
  the same span in log units and the same panel height, each centred on its own
  prices, so a +10% move is the same number of pixels in the stock panel as in the
  S&P panel. There is a test for exactly that property. Gridlines are round
  percentage moves from the decision-day price, not raw prices.
- **Night mode and a new look (Prompt 27).** Deep navy with a faint chart-paper
  grid, neon mint/pink candles, glass panels, gradient logo, glowing buttons; the
  tab bar goes dark with the game. Scoped under `.arcade-page`, so the light filings
  explorer is unchanged.
- **Game mechanics.** Stakes (x1/x2/x3: right wins the stake, wrong loses it; a coin
  flip nets zero on average), streaks with a fire marker, round pips, a HUD score.
  After the call the month plays out one candle per tick in both panels with a live
  race meter (stock vs S&P, and who leads by how many points), then a verdict card
  (NAILED IT / MISSED, with confetti on a hit) and the company reveal. The four
  signals become opponent cards with their running records that flip to a tick or a
  cross on the reveal. A podium and stat cards at the end, plus the "whole deck"
  column and the honesty note. Keyboard: Up/B, Down/L, 1/2/3, Space to skip, Enter
  for next. Hover a candle for open/high/low/close. `prefers-reduced-motion` gets the
  result instantly with no confetti.
- **Fairness kept.** The vertical scale includes the outcome only after the call and is
  then fixed for the whole playback; score, streak and opponent records only move
  after the playback finishes, so they cannot spoil a round.
- **Verified in a browser.** Intro, a round, the mid-animation state ("day 8/21"), the
  reveal, a full 10-round game to the finish screen with the podium, the hover
  tooltip (hidden for the future before a call), the keyboard controls, and the
  reduced-motion path (42 outcome candles and the verdict immediately). A screenshot
  of the reveal showed the chart and race meter as intended.
- **Bugs found by looking.** The first version's game styles were still in
  `styles.css` and fought the new ones: an old `.call` rule put stray borders in the
  opponent rows, the app's global `section { margin-bottom: 32px }` opened gaps
  between every panel, and the explorer's own `.field` class collided with mine. Removed
  the old block, renamed mine to `.opponents`, reset the section margin under the
  game, deleted the now-unused `PriceChart.tsx`.
- 180 tests (server 57, web 47, research 76), typechecks clean, production build
  59 KB gzipped JS + 5.8 KB CSS.


## 2026-09-28 — Prompt 26 — (mid-turn) Log-scale candles for a fair comparison

> log scale candlees to give fair comparisson

**Output:** Candle charts use a logarithmic price axis, and the stock and S&P 500
panels share the same percent-per-pixel span so equal percentage moves are drawn
the same height in both. See Prompt 25.

## 2026-09-28 — Prompt 27 — (mid-turn) Night mode and a cooler UI

> and color scheme is boring af lets make night mode and way cooler ui

**Output:** The game gets a dark night-mode trading-desk theme with neon accents.
See Prompt 25.

---

## 2026-09-28 — Prompt 28 — Fit on one screen; no fireworks

> Cool stuff but make it all fit into one screen and no explosion of fireworks when its done lol

**Output:** Two changes: the confetti is gone, and every screen now fits one
window without scrolling.

- **No fireworks.** Removed the confetti component, its three uses (the hit verdict
  and the results screen) and its CSS. Nothing else about the celebration changed;
  the verdict card still pops and a miss still shakes.
- **One screen.** The arcade page is now exactly the window height below the tab bar
  (which got a fixed 44px so that arithmetic is exact) and every screen is laid out
  inside it: the round screen is a HUD plus a two-column grid where the chart takes
  whatever height is left and the side column is compact; the intro is a compact hero,
  a row of three steps and a row of four signals; the results screen is two columns
  (podium and stat cards left, standings and the note right, Play again in the header).
  Once the outcome is in, the verdict card carries the reveal so the briefing is
  dropped, which frees the room the verdict needs.
- **The chart fills its box.** Measuring showed the first version scaled a fixed 2:1
  drawing, leaving ~200px of dead space on a tall window. It now measures its own box
  (ResizeObserver) and sets the SVG viewBox to the pixel size, so panels, candles and
  text fill it exactly and stay crisp. The equal-span log scale and equal panel heights
  are unchanged. The race meter's space is reserved (dimmed, "starts when you lock in")
  before the call so the chart is the same size before and after locking in; measured
  identical at every state.
- **Short windows.** Detail is trimmed in steps rather than scrolling: at <=800px tall
  the legend, opponent bars and risk note go; at <=720px "the field" becomes two
  columns and the buttons shrink; at <=680px the signal preview and briefing labels go.
  The "how much to read into this" note stays visible at every height, because it is
  what keeps the result honest. Below 980px wide the columns stack and the page scrolls.
- **Measured, not eyeballed.** Loading the game in same-origin iframes at exact sizes and
  reading overflow (document, page, side column) on all five screens: 1440x800 and
  1280x720 and 1920x950 (before the width cap change) had zero overflow on every screen;
  1366x650 first had the side column 81px too tall on the call screen, fixed by the
  two-column field and tighter buttons, then 0 on every screen. The chart stayed 927x546
  (1440x800) and 927x397 (1366x650) through call, playback and reveal.
- **Then a wider cap.** Raised the game's max width from 1320px to 1600px so big
  monitors use their width now that the chart adapts. That final change was verified only
  by tests, types and the build, not re-measured, because of the tool problems below.
- **Bugs found and fixed.** A leftover `.note {display:none}` hid the honesty note on
  short screens (removed). My first two-frame test runs deadlocked because I fired them
  in parallel and each removed the other's frame. A test URL with the cache-buster inside
  the hash did not match the route.
- **Tooling, not the app.** The browser tab is in the background, so Chrome throttles its
  timers and animation frames (a probe drew 0 animation frames in 2.6s and 4 of ~15
  expected candles), which made long scripted runs time out or "detach". The chart's
  viewBox changed 0 times during playback, so there is no render loop; the app is fine,
  the automation was slow. The session also crashed once mid-task; on resume the code was
  intact, the dev server had died and was restarted, and 180 tests passed.
- 180 tests, typechecks clean, production build 58.6 KB gzipped JS + 6.1 KB CSS.


---

## 2026-09-28 — Prompt 29 — Wrap up

> Neat, lets wrap this all up then and call it done. For now

**Output:** Final check (180 tests pass, web/research/server typecheck clean, production
build passes) and a summary of where everything is. Nothing committed: committing was
not asked for, so it is left as the user's call.

---

## 2026-09-29 — Prompt 30 — How do I run this myself?

> Great, so one last question, how do I run this myself?

**Output:** see below.

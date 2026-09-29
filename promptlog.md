# Prompt Log

AI tool used: **Claude Code** (Opus 5, 1M context) in the terminal.
This log records every prompt I gave, plus a summary of what the model did in
response. Timestamps are local (Europe/Stockholm).

---

## 2026-09-23 — Prompt 1 — Setup & alignment

> Hello dear sir ai overlord, I'm going to do this interview thing for quartr,
> ai is permitted. It's a work interview process thing. They want me to give
> them a prompt log, so, for this conversation, lets log each prompt in a
> promptlog.md Data_Tooling_-_Coding_Assignment.pdf contains the assignment.
> Read it so you have an understanding. Lets align on the plan first.

**Output:** Located the PDF in `~/Downloads`, read it, and checked the local
toolchain (Node v22.14.0, npm 10.9.2, git 2.34.0; no Bun installed). Created
this `promptlog.md` and drafted a plan for review.

---

## 2026-09-23 — Prompt 2 — Plan decisions (answers to clarifying questions)

Claude asked three questions before writing any code. My answers:

- **Backend stack:** Bun + Elysia (matches Quartr's own stack; Bun not yet
  installed on this machine, so install it).
- **Scope:** Core only. "I am going to include the extra features based on what
  I think excites me" — extensions decided by me later, not up front.
- **Frontend styling:** "Honestly I have no clue about frontend styling make it
  as generic and plain but informative as possible." → plain CSS, dense and
  legible, no design framework.

**Output:** Final plan below, agreed before implementation.

---

## 2026-09-23 — Prompt 3 — Incremental, validate-as-we-go

> but, lets start with doing one of the backend things at the time, so we can
> see that we get the correct data etc and validate everything alright?

**Output:** Switched to an incremental workflow: build one backend capability
at a time, call the real EDGAR API, inspect the actual response, and confirm it
before moving on. Step order: (1) ticker → CIK resolution, (2) fetch
submissions, (3) columnar → row normalization, (4) `/companies/:ticker/filings`,
(5) `/filings/summary`, then the UI.

**Step 1 result (ticker → CIK), validated against live EDGAR:**

| input | resolved |
|---|---|
| `AAPL` | `0000320193` Apple Inc. |
| `SPOT` | `0001639920` Spotify Technology S.A. |
| `JPM` | `0000019617` JPMORGAN CHASE & CO |
| `brk.b` | `0001067983` BRK-B (case + `.`→`-` normalization) |
| `  msft ` | `0000789019` (whitespace tolerated) |
| `NOTAREALTICKER` | `null` → 404 |

Findings: the 10-digit zero-pad is mandatory for the submissions URL;
ticker→CIK is many-to-one (JPM, JPM-PC, JPM-PD, VYLD, AMJB all resolve to CIK
0000019617), so the company picker dedupes by CIK.

Decisions: use a real SEC `User-Agent` (`Quartr Assignment Peter Heinum
peter.heinum@gmail.com`) kept in a gitignored `.env`; review step 1's code
before continuing to step 2.

---

## 2026-09-23 — Prompt 4 — Why a `packages/` folder?

> Okay, why do we put the things into "packages" folder?

**Output:** Explained the tradeoff: a workspace buys shared TypeScript types
between server and web (rename a field → frontend fails to compile instead of
rendering `undefined`); the `packages/` nesting itself buys nothing. Offered to
flatten.

---

## 2026-09-23 — Prompt 5 — Flatten the layout

> Yeah, I don't like "packages", i'd rather have server / web and a shared
> folder, because of simplicity. After we've done that lets move on.

**Output:** Flattened to `server/`, `shared/` (and `web/` to come). Root
`package.json` declares Bun workspaces. Moved the `Company` type into
`shared/src/index.ts` and had the server import it from `@quartr/shared`.
Reinstalled, typecheck clean, ticker resolution re-verified against live EDGAR.

---

## 2026-09-23 — Prompt 6 — Show me the raw shape

> Cool stuff. thnak you. Yes please show me the raw shape and how the data looks
> if that is important for me.

**Output:** Fetched the submissions JSON for Apple, Spotify and JPMorgan and
dumped the structure. `filings.recent` is 16 parallel arrays (row *i* of a
filing = element *i* of each array), all verified equal-length and sorted
newest-first.

Findings that changed the design:

1. **`recent` is not capped at 1000.** It holds *at least* the last 12 months
   *and* at least 1000 filings.

   | | rows in `recent` | span | overflow chunks | total |
   |---|---|---|---|---|
   | Apple | 1,000 | 2015→2026 (11y) | 1 file, 1,249 | 2,249 |
   | Spotify | 374 | everything | 0 | 374 |
   | JPMorgan | 26,229 | exactly 12 months | 70 files, 141,172 | 167,401 |

   Consequence: the `/filings/summary` 12-month window is always fully inside
   `recent`, so that endpoint needs exactly one request per company and never
   touches the overflow files.

2. **Spotify has no 10-K, ever** — it's a foreign private issuer and files
   20-F / 6-K instead. The assignment names Spotify as a test company and asks
   for "date of latest 10-K", so `latestTenK: null` is the correct answer and
   must render gracefully. Added a `latestAnnualReport` fallback (20-F/40-F)
   labelled with its real form type.

3. `primaryDocument` is empty for 109/1,249 pre-2001 Apple filings → document
   URLs need a fallback to the filing index page.

4. EDGAR's form names are internally inconsistent (`SC 13G/A` vs
   `SCHEDULE 13G/A`).

5. Form filtering is load-bearing: 22,787 of JPMorgan's 26,229 last-12-month
   filings are `424B2` pricing supplements.

**Decision (deep history):** seed from `recent` immediately, fetch overflow
chunks progressively in the background, cache so nothing is fetched twice.

---

## 2026-09-23 — Prompt 7 — Don't hand me solutions, show me the problem

> I'm not sure, I think I need to look at the data more at hand to decide what
> the actual problem is rather than you just giving me the solutions here.

**Output:** Dumped every distinct form value with counts for all three
companies plus Apple's 1994–2015 history. Four concrete problems fell out:
amendments as separate values (`10-K` vs `10-K/A`), the 13G rename, retired /
look-alike forms (`10-K405`, `NT 10-K`), and hyphenation of user input.
Each company has a different form vocabulary (Apple 34 distinct, Spotify 28,
JPM 26), so the UI's filter list must be derived per company, not hardcoded.

---

## 2026-09-23 — Prompt 8 — Prove the aliases before applying them

> I'd argue we could alias them together if they seem to be the same type of
> report, I think we need to look at the data first to make sure they are the
> same before we alias them together.

**Output:** Verified empirically rather than assumed.

*`SC 13G` ≡ `SCHEDULE 13G`* — five pieces of evidence: identical metadata
signature (`act=34`, file numbers in the `005-` series); the old HTML document
titles itself "SCHEDULE 13G (Rule 13d-102)"; EDGAR self-contradicts within a
single row (`form: "SC 13G/A"`, `primaryDocDescription: "SCHEDULE 13G/A"`); the
new filings declare `xmlns="http://www.sec.gov/edgar/schedule13g"`; and the
date split is clean with zero overlap, explained by the SEC's late-2024
structured-data mandate moving 13D/G from HTML to XML.

*Amendments* — `10-K/A` shares `reportDate` with the `10-K` it amends
(fiscal 1997 and 2009 confirmed), so counting both double-counts the period.
Excluded by default, `?includeAmendments=true` to opt in.

*`10-K405` ≡ `10-K`* — Apple filed an annual report every year 1994–2025
unbroken, but a literal `form === "10-K"` filter shows gaps in fiscal 1998 and
2001, both filed as `10-K405` (the 1996–2002 Rule 405 variant, retired 2003).
`NT 10-K` deliberately excluded: it is a notification of late filing, not a
report.

Every filing retains EDGAR's literal string as `rawForm`, so aliasing adds
information without destroying any.

**Step 3 result (normalization), validated:**

Wrote `server/src/edgar/forms.ts` (form canonicalization + alias table),
`server/src/edgar/normalize.ts` (pure columnar → row transform, no I/O), and
the API contract types in `shared/src/index.ts`.

20 unit tests pass, one per rule derived from the data above. Live validation:

- Apple → 1,000 filings normalized; latest 10-K resolves to 2025-10-31.
- Spotify → 374 normalized; `latest 10-K: NONE`, `latest annual: 20-F
  2026-02-10` — the foreign-private-issuer case handled as intended.
- URL liveness: sampled generated URLs across 1994–2015, both the primary-
  document path and the index fallback. **All returned HTTP 200.**

```
200  2015-07-24  FWP    primary-doc     .../d95725dfwp.htm
200  2000-07-31  10-Q   primary-doc     .../a10-q.txt
200  2000-05-15  S-8    index-fallback  .../0000912057-00-024086-index.htm
200  1994-01-26  10-Q   index-fallback  .../0000320193-94-000002-index.htm
```

---

## 2026-09-23 — Prompt 9 — Verify the index URLs are correctly formatted

> Okay but that's great then we seem to have the correct URL [...] Can you
> verify that all of the filings we can get hits a 200 on the filingIndexUrl so
> we haven't formatted things wrong or something like that?

**Output:** Checking literally all of them is not possible politely — JPMorgan
alone has 167,401 filings, ~4.6 hours at the SEC's 10 req/s ceiling. Ran a
spread sample instead: 160 URLs covering every distinct form type per company
across 1994→2026.

First pass: 146/160 returned 200. **All 14 failures were `503`, none were
`404`** — the distinction that answers the question. Retried exactly those 14
at ~1.6 req/s: 13 passed immediately, the last on a second retry.
**160/160 confirmed, zero formatting errors.** Each retried page was also
checked to contain its own accession number, so a 200 from a generic error page
would not have counted.

Two takeaways: URL construction is correct across both code paths (primary
document and index fallback), across the `.htm` and `.txt` eras; and EDGAR
signals throttling with `503`, not just `429`, which `client.ts` already
retries with backoff.

*Process note:* my first verification script had a rate-limiting bug — 8 workers
sleeping 125ms each is ~64 req/s, well over the SEC's ceiling. Killed it before
it earned an IP block and rewrote with a single global gate. A second run
stalled on 6 concurrent connections with no timeout; fixed with
`AbortSignal.timeout` and lower concurrency.

---

## 2026-09-23 — Prompt 10 — Sample instead, and download some reports

> Okay we dont need to fetch all of it that's okay just some spread samples here
> and there. Can you also download some of the reports, for fun, i'm going to
> use it later. If we have space on my computer for that.

**Output:** Checked disk first — only 3.5 GB free of 236 GB, so kept the
download deliberately small. Downloaded 11 annual reports, 41 MB, to
`.data/filings/` (gitignored): Apple 5 × 10-K (FY2021–25), Spotify 5 × 20-F
(FY2021–25), JPMorgan 1 × 10-K (FY2025). Wrote `manifest.json` alongside them
mapping each file back to its CIK, accession number and source URL.

---

## 2026-09-23 — Prompt 11 — Is task 3 done?

> Okay but that's great then we seem to have the correct URL so we should be
> able to complete task 3 then? [...] or would you say that one is done?

**Output:** Not done — all the pieces existed but no HTTP endpoint did. Built
the remainder: `routes/query.ts` (parameter parsing with one consistent 400
shape), `filings-query.ts` (pure filter/sort/paginate), `routes/companies.ts`,
`routes/summary.ts`, and `index.ts` (Elysia app, CORS, error mapping).

Verified against the running server:

- `?form=10K`, `10-K`, `10k` → identical results (total 32).
- Apple's annual series 1997–2003 returns **seven consecutive years** with
  1998 and 2001 shown as `10-K` while `rawForm` preserves `10-K405` — the gap
  a naive filter would leave.
- `includeAmendments` false→true takes the 10-K total from 32 to 34.
- Spotify: `10-K` → 0 results, `20-F` → 8, available forms derived per company.
- Spotify `SC 13G` → 10 results spanning 2018–2025, unifying the rename; the
  2025-08-08 filing would have been missed without the alias.
- JPMorgan: `partial: true` with the total climbing 26,107 → 74,967 → 76,993
  as background chunks landed — progressive loading working end to end.
- `/filings/summary?tickers=AAPL,SPOT,JPM,FAKETICKER` → three summaries plus a
  per-ticker error entry; Spotify's `latestTenK` is null with
  `latestAnnualReport` = 20-F 2026-02-10.
- Errors: unknown ticker 404, bad page/pageSize/sort/date 400, unknown route
  404, all one `{error}` shape.

52 unit tests pass.

---

## 2026-09-23 — Prompt 12 — What does the 405 in 10-K405 mean?

> And also, I think we should find out why spotify has never filed A K10. /
> What is the K405 now again? what does that 405 mean?

**Output (10-K405):** Fetched Apple's fiscal-2001 annual report and showed the
cover-page checkbox that produced the form type:

> "Indicate by check mark if disclosure of delinquent filers pursuant to
> **Item 405 of Regulation S-K** is not contained herein… **/x/**"
> `CONFORMED SUBMISSION TYPE: 10-K405`

EDGAR encoded that one checkbox into the form type: checked → `10-K405`,
unchecked → `10-K`. Item 405 requires naming insiders who filed their Section
16(a) ownership reports (Forms 3/4/5) late; checking the box asserts there is
no such disclosure. So `10-K405` is bookkeeping about a checkbox, not a
different kind of report — which is what makes aliasing it to `10-K` correct
rather than a fudge. Discontinued by the SEC in 2003.

---

## 2026-09-23 — Prompt 13 — Why has Spotify never filed a 10-K?

**Output:** Established from data, in four steps.

1. **Entity metadata** — `stateOfIncorporation: "N4"` (Luxembourg),
   `ein: "000000000"` (no US EIN), `entityType: "other"`, versus Apple's
   `CA` / real EIN / `operating`.
2. **Spotify's own words**, from the 20-F already downloaded: *"risks related
   to our status as a **foreign private issuer** and a Luxembourg company."*
3. **The 20-F is the same statutory filing**, not a lesser one — its cover page
   reads "ANNUAL REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES
   EXCHANGE ACT OF 1934", identical to a 10-K's. The XBRL uses `ifrs-full:`
   tags and `iso4217:EUR`: IFRS in euros, not US GAAP in dollars.
4. **It is a class, not a quirk** — checked 12 companies:

   | | incorporated | entityType | annual | periodic |
   |---|---|---|---|---|
   | AAPL / MSFT / JPM | CA / WA / DE | operating | 10-K | 10-Q, 8-K |
   | SPOT | Luxembourg | other | 20-F | 6-K |
   | SAP / ASML / TM / TSM / BABA / NVO | DE / NL / JP / TW / HK | other | 20-F | 6-K |
   | RY | Ontario | other | 40-F | 6-K |

**And a genuine edge case: filer status can change.** Shopify's annual reports
run 20-F (2016) → 40-F (2017–2024) → **10-K (2025, 2026)**, with 6-K ending
2024-12-03 and 8-K/10-Q beginning 2025-02-11. It lost foreign-private-issuer
status and became a domestic filer.

Implications, all of which the current design already handles:
`latestTenK: null` is a correct answer for a large permanent class of
companies, not an error; a company's annual-report history can span form types,
so `latestAnnualReport` unions 10-K/20-F/40-F (Shopify's 11-year run is only
unbroken that way); and 20-F/40-F are deliberately *not* aliased into 10-K,
since unlike 10-K405 they are genuinely different documents under different
accounting standards.

---

## 2026-09-23 — Prompt 14 — Careful with aliasing; all companies; start the frontend; can we parallelise?

> I mean it makes sense that a 20f and a 40f is not a 10k lol. Different letters
> and completely different numbers. I think we should be very carefull with too
> much aliasing. I think we should probably have as many companies as possible
> to demo (if not all of them listed in the original link). Yes. I think we
> could start with the fronted. Are you loggin every prompt so far? It's
> important we do.
>
> For the frontend. I wish to speed things up. Could we work on multiple things
> at once using sonnet subagents without risk of mayhem?

**Output:**

*Aliasing.* Applying the user's own test ("different letters, different
numbers") caught an over-reach of mine: I had aliased `10-KSB`/`10-QSB` onto
`10-K`/`10-Q`. Those were the Regulation S-B small-business forms — a reduced
disclosure regime with fewer years of financials, so genuinely different
documents, unlike `10-K405` which differed only by a checkbox. Removed both
aliases, leaving only the 13D/G rename and `10-K405`. Test added asserting the
SB forms are *not* aliased. 53 tests pass.

*Companies.* Already full coverage: `company_tickers.json` has 10,461 tickers
across 8,049 distinct CIKs, and `/companies?q=` searches all of them,
deduplicated by CIK.

*Prompt log.* Confirmed — all 14 prompts logged verbatim with outcomes.

*Parallelism.* Yes, with structure: parallel agents are safe when they do not
share files. Built the shared surface sequentially myself (Vite scaffold,
`api.ts`, `useFetch.ts`, `styles.css`, `App.tsx`), then fanned out three Sonnet
subagents on one leaf component each — `FilingsTable`, `SummaryPanel`,
`Controls` — with exact prop contracts and a rule not to touch any other file.
All three returned compiling code; the whole app typechecks clean and builds
(50 KB gzipped).

---

## 2026-09-23 — Prompt 15 — Link labels: forms are not documents

> okay, but maybe we should not call the forms for documents then?

**Output:** Agreed, and building it surfaced a real bug.

Added `documentKind: "document" | "form" | "index"` to the `Filing` contract,
derived in `normalize.ts` from the shape of `primaryDocument` — a rule read off
the data rather than guessed:

| shape | count | classified as |
|---|---|---|
| `*.htm`, `*.txt`, `*.pdf` | 26,941 | `document` |
| `xsl*/*.xml` | 2,210 | `form` — structured XML rendered by EDGAR's stylesheet |
| *(empty)* or `*.paper` | 120 | `index` |

For Apple that yields `document` → 10-K, 10-Q, 8-K, 424B2, DEF 14A, S-8, SD…
and `form` → 4, 3, 144, 25-NSE, SC 13G. The UI labels the link accordingly,
with a tooltip explaining each.

**The bug:** `.paper` filings (paper rather than electronic submissions, e.g.
Apple's `NO ACT` and `CERTNYS`) name a key that does not exist in EDGAR's
archive. **`HEAD` returns 200 but `GET` returns 404 `NoSuchKey`** — the archive
is S3-backed and HEAD is not a reliable existence check. Those were dead links.
They now classify as `index` and point at the filing index, which does exist.

That also invalidated the *method* behind the earlier "160/160 URLs verified"
claim, which used HEAD. Re-verified with GET over 70 filings spread across
every form type and 2018→2026, checking both URL kinds:

```
filingIndexUrl : 70/70 → 200, each page containing its own accession number
documentUrl    : 70/70 → 200
```

(7 initially returned `503`; all passed on retry.) The conclusion stands, now
on sound evidence.

Also fixed: number formatting pinned to `en-US` (it was following the browser's
Swedish locale and rendering `1 344` instead of `1,344`); the summary's
"files 20-F" cell no longer clips, having inherited `white-space: nowrap`; and
the controls now share one baseline. 57 tests pass.

---

## 2026-09-23 - Prompt 16 - Deduct the breaks

> can we deduct a bit of time between the breaks i've taken? not sure if they
> make sense to you to see where they are but i did have a couple of "breaks"

**Output:** Reconstructed the idle periods from file modification timestamps -
eleven gaps of 2.5 minutes or more across the session. Presented all eleven
rather than guessing, noting that a gap mixes reading, deciding and typing with
actual time away, and that one 4.5-minute gap was the tool's own download job.
Confirmed the three long gaps as real breaks and deducted them. See the time
log below.

---

## 2026-09-23 - Prompt 17 - End of day one

> thank you. Now i'm off for today. See you tomorrow. wrap up all prompts etc
> and we'll continue tomorrow.

**Output:** Finalised this log, stopped the dev servers, and recorded the
resume point below.

---

## State at the end of day one

**Complete:**

- All four backend requirements: ticker to CIK resolution, columnar to row
  normalization, `GET /companies/:ticker/filings` (paginated, form-filterable,
  date-sortable, linking to sec.gov), and `GET /filings/summary`. Plus
  `GET /companies?q=` for the picker and `GET /health`.
- React frontend: filings list with company typeahead over all 8,049 companies,
  per-company form filters, date sort, pagination, and the summary matrix.
- 57 unit tests, passing. Typecheck clean on server and web. Production build
  succeeds (50 KB gzipped).
- `README.md`, `NOTES.md`, and this log.

**Not yet done:**

1. `git init`, initial commit, push to GitHub. Deliberately left undone rather
   than guessing at commit structure.
2. URL state in the frontend - the selected company and filters are not in the
   address bar, so a filtered view cannot be shared or reached with the back
   button. Identified in NOTES.md as the highest-value remaining frontend work,
   roughly 20 lines.
3. Optional: a walkthrough script for the review session. Four companies cover
   every interesting behaviour - `AAPL` (the 10-K405 gap in its annual series),
   `SPOT` (never filed a 10-K), `JPM` (progressive loading, 167,401 filings),
   `SHOP` (changed filer status, 20-F to 40-F to 10-K).

**To resume:**

```bash
bun install          # if needed
bun run dev:server   # http://localhost:3001
bun run dev:web      # http://localhost:5173
bun test
```

`.env` already holds a valid `SEC_USER_AGENT` and is gitignored. The 11
downloaded annual reports live in `.data/filings/` with a `manifest.json`, also
gitignored.

---

# Day two - 2026-09-24

## Prompt 18 - What is left?

> Hello again, it's time to continue. So what do we have left from the
> assignment?

**Output:** Checked the state on disk rather than relying on memory: 57 tests
passing, both packages typechecking, not yet a git repository, no URL state.
All four backend requirements and both frontend requirements were already met;
the only unmet *submission* requirement was committing to a GitHub repo.

Decisions: commit locally now (not ready to push yet), install the GitHub CLI
for later, and spend remaining budget on URL state.

## Prompt 19 - Commit locally, and handle the GitHub setup

> We can commit locally because I am not done yet. / You fix that stuff for
> me :-)

**Output:** Inspected what would be committed *before* committing: 40 files,
224 KB, no `.env`, no `.data/`, no `node_modules`, no `dist/`. Added
`.gitattributes` (`* text=auto eol=lf`) so the repo does not arrive full of
CRLF noise on macOS. Made the initial commit on `main`, with a message
documenting the non-obvious decisions so `git log` carries the reasoning.

`gh` was not installed and `winget` was unavailable, so installed the GitHub
CLI 2.101.0 as a portable extract to `~/.local/gh` (14.8 MB, no admin rights
needed, appropriate given ~3.5 GB free disk) and added it to the user PATH.
`gh auth login` is interactive and browser-based, so that step is the user's.

## Prompt 20 - URL state

**Output:** Added `web/src/urlState.ts`: pure `parseQuery` / `serializeQuery`
plus a `useUrlState` hook. Company, form filters, amendments toggle, sort, page
and the summary's companies now live in the query string.

Design points:

- Parsing is defensive — `?sort=sideways`, `?page=0`, `?page=abc` all fall back
  to defaults rather than throwing, because a URL is user input.
- Defaults are omitted when serialising, so the common case is a bare URL.
- An explicitly empty `?summary=` is distinguished from an absent one;
  otherwise emptying the summary would resurrect the defaults on reload.
- The first sync uses `replaceState` rather than `pushState`, so normalising a
  hand-typed URL does not leave a dead entry behind the user's first Back.

13 new unit tests, including `parse(serialize(x)) === x` round trips. Verified
in the browser: `?ticker=SPOT&form=20-F&sort=asc` restores company, chip
selection and ascending sort; clicking a second form chip updates the URL to
`form=20-F,6-K`; and Back reverts both the URL and the rendered state.

*Aside:* the browser automation had been connecting to the user's **home**
computer's Chrome rather than this laptop, which explains the "error page"
failures on day one. Resolved by listing connected browsers and using the local
one.

**70 tests pass.** NOTES.md and README.md updated: URL state moved out of the
"missing" list, and the remaining frontend gap restated honestly as the absence
of component tests.

---

## Prompt 21 - What is the x button in the summary?

> What is the x button in the summary?

**Output:** It removes that company from the summary comparison - and the fact
that the question had to be asked was the bug.

Two real problems, the second found only by looking at the rendered page:

1. The button carried an `aria-label` but no `title`, so screen-reader users
   were told what it did and sighted users were not. Added a tooltip and a
   hover state that makes it read as a button.
2. **It was off-screen.** It sat in a trailing column of a table that scrolls
   horizontally for filers with many form types, so it was invisible until you
   scrolled right. Moved it beside the company name in the first column, where
   it is visible by default, and dropped the empty trailing header.

Verified in the browser: the control is now visible without scrolling,
removing Spotify updates the URL to `?summary=AAPL,JPM`, and the matrix
columns correctly recompute to the union of forms across the remaining
companies.

---

## Prompt 22 - Selected buttons lose their text on hover

> When I hover over the selected buttons the text disapears. Not super nice?
> I think it's because the bg color turns white and text is also white :p

**Output:** Correct diagnosis. A CSS specificity problem, and a general one
rather than a single broken rule:

```css
button:hover:not(:disabled) { background: var(--panel); }          /* (0,2,1) */
.chip[aria-pressed="true"]  { background: var(--accent); color: #fff; }  /* (0,2,0) */
button.primary              { background: var(--accent); color: #fff; }  /* (0,1,1) */
```

The generic hover rule outranks both, so any button that sets its own colours
had its background replaced with near-white on hover while keeping white text.

Fixed by restating the background in each hover rule, with a comment
explaining the trap so it is not reintroduced. The primary "Add to summary"
button had the identical latent bug - unnoticed only because it is disabled
for the three default summary companies. Swept the remaining buttons: the
typeahead options and the summary's remove control are unaffected.

Verified by hovering both in the browser.

---

## Time log

Measured from file modification timestamps, not self-reported.

| | |
|---|---|
| Project directory created | 15:20 |
| First code written | 15:26 |
| Last edit before the pause | 17:02 |
| Pause taken at | 17:09 |
| Wall-clock span | ~1 h 42 m |

**Breaks deducted.** Eleven gaps of 2.5 minutes or more show up in the file
timeline. Three of them are long enough to be actual time away from the desk
(hallway conversations and a snack break), confirmed by me:

| gap | length | resumed with |
|---|---|---|
| 16:01 → 16:12 | 11.0 min | the 10-K405 question |
| 16:13 → 16:23 | 9.6 min | the aliasing / subagents message |
| 16:34 → 16:56 | 21.9 min | after browsing the running app |

**~42 minutes deducted → roughly 1 hour of engaged working time** to this
point, against the assignment's ~4 hour budget.

The remaining gaps (~35 min) are reading output, deciding, and composing
messages, plus one 4.5-minute stretch that was the tool downloading filings
rather than any pause of mine. Those are counted as working time.

Against the budget, the backend, frontend, tests, README and NOTES are
complete; what remains is `git init`, a commit, and a final read-through.

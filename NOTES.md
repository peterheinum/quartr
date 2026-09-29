# Notes

What I decided, why, and what I would do next.

## Approach

I built one capability at a time and checked each against the live API before
moving on, rather than writing the whole thing and debugging at the end. Most
of the decisions below came out of looking at the actual bytes EDGAR returns —
several of them contradicted what I assumed at the start. The full working log
is in [promptlog.md](promptlog.md).

## What EDGAR's data actually looks like

**`filings.recent` is not capped at 1,000.** It holds *at least* the last 12
months *and* at least 1,000 filings, whichever is more:

| | rows in `recent` | span | overflow chunks | total filings |
|---|---|---|---|---|
| Apple | 1,000 | 11 years | 1 file, 1,249 | 2,249 |
| Spotify | 374 | everything | 0 | 374 |
| JPMorgan | 26,229 | exactly 12 months | 70 files, 141,172 | **167,401** |

That has a useful consequence: **`/filings/summary` never needs the overflow
chunks**, because the 12-month window is inside `recent` by construction. It is
one upstream request per company even for a filer with 167,000 filings.

**Spotify has never filed a 10-K.** It is a foreign private issuer incorporated
in Luxembourg, so it files 20-F and 6-K instead of 10-K, 10-Q and 8-K. The
assignment names Spotify as a test company *and* asks for the date of the latest
10-K, so `latestTenK: null` is the correct answer, not a bug. I added
`latestAnnualReport` (10-K / 20-F / 40-F, whichever is most recent) so the UI
can show something true rather than an empty cell. This is a whole class of
company — SAP, ASML, Toyota, TSMC, Alibaba, Novo Nordisk all file 20-F; Royal
Bank of Canada files 40-F.

**Filer status can change.** Shopify filed 20-F (2016), then 40-F (2017–2024),
then **10-K** (2025, 2026), with 6-K stopping and 8-K/10-Q starting on the same
date. A company's annual-report history can span form types.

**`primaryDocument` is empty on older filings** — 109 of Apple's 1,249 pre-2015
filings. Every filing therefore carries both `documentUrl` and
`filingIndexUrl`, with `documentUrl` falling back to the index page rather than
constructing a URL that 404s.

**EDGAR signals throttling with `503`, not just `429`.** Worth knowing, because
a `503` looks like a missing document if you do not check.

## Form-type normalization

EDGAR's `form` column is not a clean enum, so filtering on it naively gives
wrong answers. I aliased exactly two things, and deliberately left everything
else alone:

| aliased | evidence |
|---|---|
| `SCHEDULE 13G` → `SC 13G` (and 13D, and `/A`) | Same schedule, renamed during the SEC's late-2024 move to structured XML filings. The new filings declare `xmlns=".../edgar/schedule13g"`; the old documents title themselves "SCHEDULE 13G (Rule 13d-102)"; some rows carry one spelling in `form` and the other in `primaryDocDescription`. The date ranges have **zero overlap** — `SC 13G` runs 1994–2021, `SCHEDULE 13G` 2025–2026 — so no single filter string returns a company's complete history without this. |
| `10-K405` → `10-K` | Differed from a 10-K only by a cover-page checkbox (Item 405 of Regulation S-K, on delinquent Section 16(a) filers). Same document, same accounting. Without it, Apple's unbroken 1994–2025 annual series shows gaps in fiscal 1998 and 2001. |

**Not aliased, on purpose:**

- `20-F` / `40-F` — annual reports, but under different accounting regimes.
  Spotify reports in IFRS and euros; the numbers are not comparable to a 10-K's.
- `10-KSB` / `10-QSB` — the small-business forms under Regulation S-B, a
  reduced disclosure regime with fewer years of financials. Different
  requirements, so a different document.
- `NT 10-K` — a notification that the 10-K will be late. Not a report.
- **Amendments** (`10-K/A`) are kept distinct and excluded by default. An
  amendment carries the same `reportDate` as the filing it corrects, so folding
  it in reports two annual reports for one fiscal year.
  `?includeAmendments=true` opts in.

Every filing keeps EDGAR's literal string as `rawForm`, so normalization only
ever adds information. The UI shows it whenever it differs from the canonical
form.

## Design decisions

**Progressive backfill rather than eager or lazy loading.** A request is served
from `filings.recent` immediately with `partial: true`, while overflow chunks
load in the background, newest first, three at a time. Fetching all of
JPMorgan's 70 chunks up front would make a cold request take ~9 seconds;
serving only `recent` would silently truncate history. The UI polls while
`partial` is true, so the count climbs on screen.

**Caching is per CIK with a 1-hour TTL, and concurrent callers share one
fetch.** The ticker map (10,461 tickers) is cached for 24 hours. Cold-start
requests are deduplicated through an in-flight promise, so ten simultaneous
requests for the same company cause one upstream call.

**All EDGAR access goes through one function** that enforces the `User-Agent`
and spaces requests at 8/second, under the SEC's 10/second ceiling, retrying
`429` and `5xx` with exponential backoff.

**Available form types are derived per company, not hardcoded.** A fixed
`10-K / 10-Q / 8-K` dropdown would be entirely wrong for Spotify. Counts respect
the date range and amendment toggle but *not* the current form filter —
otherwise selecting a form would collapse the list and strand the user.

**Query state lives in the URL.** Company, form filters, sort, page and the
summary's companies are all in the query string, so a filtered view can be
shared or bookmarked and the back button undoes each step. Parsing is
defensive — a malformed parameter falls back to its default rather than
throwing, because a URL is user input. Defaults are omitted when serialising,
so the common case stays a clean URL.

**Pagination sorts by filing date with accession number as a tiebreak.**
Without a tiebreak, filings sharing a date can reorder between requests and a
row can appear on two pages or on none.

## Verification

70 unit tests cover the pure logic: the columnar transform, form
canonicalization, filtering, pagination, the summary window, and URL
parse/serialize round trips.

Separately, I checked generated URLs against the live site: 160 URLs spread
across every distinct form type per company and 1994–2026. All 160 return 200.
14 initially returned `503`; retried at ~1.6 req/s, all passed, and each page
was checked to contain its own accession number so a generic error page could
not pass as a success.

## What is missing, and what I would do next

- **No caching layer beyond process memory.** A restart re-fetches. Redis, or
  even SQLite, would make cold starts cheap and let the ticker map and overflow
  chunks survive deploys. This is the first thing I would add.
- **No request coalescing across instances.** Two servers both fetch JPMorgan's
  70 chunks. A shared cache fixes this too.
- **The backfill is unbounded in memory.** JPMorgan's 167,401 filings sit in
  the process. Fine for one or two companies, not for hundreds. With a
  persistent store I would page from disk instead of holding everything.
- **No integration tests against the HTTP layer.** The pure logic is well
  covered and I exercised the endpoints by hand, but there is no automated test
  that boots the app and asserts on a response. I would add those next, with
  recorded EDGAR fixtures so they run offline.
- **Frontend component tests are missing.** The URL-state logic is unit
  tested, but the components themselves are not; I verified them by hand in a
  browser. Component tests would need a DOM environment, which is a dependency
  I did not want to add late.
- **`availableForms` is computed from all of a company's filings on every
  request.** For JPMorgan that is a 167k-element pass. Measurable but not yet
  slow; it should be memoized per cache entry.
- **No rate limiting on our own API**, only on our calls to EDGAR.
- **Full-text search within filings** is not attempted. EDGAR has a separate
  full-text search API; joining it to this data would be the natural next
  feature.

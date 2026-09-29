# EDGAR Filings

Fetches company filing history from the SEC's EDGAR API and exposes it through a
small TypeScript API and a React UI. Works for any of the ~8,000 companies that
file with the SEC.

- **Backend:** Bun + Elysia
- **Frontend:** Vite + React, plain CSS
- **Shared:** one package of types, so the API contract is checked at compile
  time on both sides

## Running it

**Prerequisites:** [Bun](https://bun.sh) 1.4 or later. Nothing else — no
database, no Docker.

```bash
bun install

cp .env.example .env     # then edit it, see below
```

The SEC **requires** a `User-Agent` header identifying you with real contact
information and returns `403` without one, so fill in `.env`:

```ini
SEC_USER_AGENT="Your Name your.email@example.com"
PORT=3001
```

Then start everything with one command:

```bash
bun start                # or: npm start
```

Open http://localhost:5173. That runs the API (port 3001) and the web app (port
5173) together; press Ctrl+C to stop both. The Vite dev server proxies `/api/*`
to the backend, so there is no CORS configuration or absolute URL in the
frontend. (To run them separately, use `bun run dev:server` and
`bun run dev:web` in two terminals.)

The **Call It** tab is a game that needs only the web app; the **Filings** tab
needs the API and an internet connection to reach sec.gov.

The UI keeps its state in the address bar, so a filtered view is shareable and
the back button works:

```
http://localhost:5173/?ticker=SPOT&form=20-F&sort=asc
http://localhost:5173/?ticker=JPM&form=424B2&page=3
```

Tests:

```bash
bun test
```

## API

### `GET /companies/:ticker/filings`

A paginated list of a company's filings, each linking to its original document
on sec.gov.

| parameter | default | notes |
|---|---|---|
| `form` | *(all)* | Repeatable or comma-separated. `10-K`, `10K` and `10k` are equivalent. |
| `includeAmendments` | `false` | Whether `10-K/A` is returned alongside `10-K`. |
| `sort` | `desc` | `asc` or `desc`, on `filingDate`. |
| `page` | `1` | |
| `pageSize` | `25` | Max 200. |
| `from`, `to` | *(none)* | Inclusive ISO date bounds on `filingDate`. |

```bash
curl 'localhost:3001/companies/AAPL/filings?form=10-K&pageSize=3'
```

```jsonc
{
  "company": { "cik": "0000320193", "ticker": "AAPL", "name": "Apple Inc." },
  "filings": [
    {
      "accessionNumber": "0000320193-25-000079",
      "form": "10-K",           // canonical
      "rawForm": "10-K",        // exactly what EDGAR said
      "isAmendment": false,
      "filingDate": "2025-10-31",
      "reportDate": "2025-09-27",
      "acceptanceDateTime": "2025-10-31T10:01:26.000Z",
      "items": null,
      "description": "10-K",
      "size": 9392337,
      "isXBRL": true,
      "documentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      "filingIndexUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm"
    }
  ],
  "page": 1, "pageSize": 3, "total": 32, "totalPages": 11,
  "partial": false,              // true while older filings are still loading
  "availableForms": [{ "form": "4", "count": 591 }]   // this company's own vocabulary
}
```

### `GET /filings/summary?tickers=AAPL,SPOT,JPM`

Per company: filings per form type over the last 12 months, and the date of the
latest 10-K.

```jsonc
{
  "companies": [{
    "company": { "cik": "0001639920", "ticker": "SPOT", "name": "Spotify Technology S.A." },
    "countsByForm": [{ "form": "4", "count": 49 }, { "form": "6-K", "count": 15 }],
    "totalLast12Months": 94,
    "window": { "from": "2025-09-23", "to": "2026-09-23" },
    "latestTenK": null,                       // Spotify has never filed one
    "latestAnnualReport": { "form": "20-F", "filingDate": "2026-02-10", "...": "..." }
  }],
  "errors": [{ "ticker": "FAKETICKER", "reason": "Unknown ticker \"FAKETICKER\"" }]
}
```

An unresolvable ticker lands in `errors` rather than failing the whole request.

### `GET /companies?q=spotify`

Typeahead over all 10,461 tickers, deduplicated by CIK.

### `GET /health`

## Layout

```
server/     Bun + Elysia API
  src/edgar/     client (rate limit, retry), tickers, normalize, forms, store
  src/           summary, filings-query, routes
  test/          57 unit tests
shared/     API contract types, imported by both sides
web/        Vite + React UI: the filings explorer, plus a "Call It" tab (a small game built from the research)
research/   exploratory analysis on top of the app (not used by it), see research/README.md
```

## Try it with

| | why it is interesting |
|---|---|
| `AAPL` | The straightforward case. Its 1998 and 2001 annual reports are `10-K405`. |
| `SPOT` | Foreign private issuer — has **never** filed a 10-K, files 20-F and 6-K. |
| `JPM` | 167,401 filings. Watch the progressive-loading banner; 87% of its last year is one form type. |
| `SHOP` | Filed 20-F, then 40-F, then 10-K — it changed filer status in 2025. |

See [NOTES.md](NOTES.md) for the design decisions and what is missing.

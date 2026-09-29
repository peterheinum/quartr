/**
 * GET /filings/summary?tickers=AAPL,SPOT,JPM
 *
 * Per company: filings per form type over the last 12 months, and the date of
 * its latest 10-K.
 *
 * Only `filings.recent` is needed for the counts -- EDGAR guarantees that
 * block spans at least the last 12 months -- so this is one upstream request
 * per company even for a filer with 167,000 filings.
 *
 * A ticker that cannot be resolved does not fail the whole request: it is
 * reported in `errors` so the UI can show the companies that did work.
 */
import { Elysia } from "elysia";
import type { SummaryResponse } from "@quartr/shared";
import { getFilings } from "../edgar/store";
import { resolveTicker } from "../edgar/tickers";
import { summarize } from "../summary";
import { BadRequest, parseList } from "./query";

const MAX_TICKERS = 20;

export const summaryRoutes = new Elysia().get(
  "/filings/summary",
  async ({ query }): Promise<SummaryResponse> => {
    const tickers = [...new Set(parseList(query.tickers).map((t) => t.toUpperCase()))];
    if (tickers.length === 0) {
      throw new BadRequest("Provide at least one ticker, e.g. ?tickers=AAPL,SPOT");
    }
    if (tickers.length > MAX_TICKERS) {
      throw new BadRequest(`At most ${MAX_TICKERS} tickers per request, got ${tickers.length}`);
    }

    const asOf = new Date();
    const settled = await Promise.all(
      tickers.map(async (ticker) => {
        const company = await resolveTicker(ticker);
        if (!company) return { ticker, error: `Unknown ticker "${ticker}"` };
        const stored = await getFilings(company.cik);
        return {
          ticker,
          summary: summarize(
            { ...company, name: stored.name || company.name },
            stored.filings,
            asOf,
          ),
        };
      }),
    );

    return {
      companies: settled.flatMap((r) => ("summary" in r && r.summary ? [r.summary] : [])),
      errors: settled.flatMap((r) =>
        "error" in r && r.error ? [{ ticker: r.ticker, reason: r.error }] : [],
      ),
    };
  },
);

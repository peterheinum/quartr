/**
 * Company-scoped routes.
 */
import { Elysia } from "elysia";
import type { FilingsPage } from "@quartr/shared";
import { EdgarError } from "../edgar/client";
import { resolveTicker, searchCompanies } from "../edgar/tickers";
import { getFilings } from "../edgar/store";
import { queryFilings, type FilingsQuery } from "../filings-query";
import { parseBoolean, parseDate, parseInteger, parseList, parseSort } from "./query";

const MAX_PAGE_SIZE = 200;

export class NotFound extends Error {
  readonly status = 404;
}

export const companies = new Elysia()
  /**
   * Company lookup for the UI's picker.
   *
   * Results are deduped by CIK: JPM, JPM-PC, JPM-PD, VYLD and AMJB all resolve
   * to CIK 0000019617, and showing the same company five times is noise.
   */
  .get("/companies", async ({ query }) => {
    const q = typeof query.q === "string" ? query.q : "";
    const limit = parseInteger(query.limit, { name: "limit", fallback: 10, min: 1, max: 50 });
    const found = await searchCompanies(q, limit * 5);
    const byCik = new Map<string, (typeof found)[number]>();
    for (const company of found) {
      const existing = byCik.get(company.cik);
      // Prefer the shortest ticker, which is the common-stock listing.
      if (!existing || company.ticker.length < existing.ticker.length) {
        byCik.set(company.cik, company);
      }
    }
    return { companies: [...byCik.values()].slice(0, limit) };
  })

  /**
   * GET /companies/:ticker/filings
   *
   * A paginated, form-filterable, date-sortable list of a company's filings,
   * each linking to its original document on sec.gov.
   */
  .get("/companies/:ticker/filings", async ({ params, query }): Promise<FilingsPage> => {
    const company = await resolveTicker(params.ticker);
    if (!company) throw new NotFound(`Unknown ticker "${params.ticker}"`);

    const parsed: FilingsQuery = {
      forms: parseList(query.form),
      includeAmendments: parseBoolean(query.includeAmendments, false),
      sort: parseSort(query.sort),
      page: parseInteger(query.page, { name: "page", fallback: 1, min: 1, max: 100_000 }),
      pageSize: parseInteger(query.pageSize, {
        name: "pageSize", fallback: 25, min: 1, max: MAX_PAGE_SIZE,
      }),
      from: parseDate(query.from, "from"),
      to: parseDate(query.to, "to"),
    };

    // Resolves as soon as `filings.recent` has loaded; older filings continue
    // arriving in the background and are picked up by later requests.
    const stored = await getFilings(company.cik);
    const result = queryFilings(stored.filings, parsed);

    return {
      company: { ...company, name: stored.name || company.name },
      filings: result.filings,
      page: parsed.page,
      pageSize: parsed.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      partial: stored.partial,
      availableForms: result.availableForms,
    };
  });

export { EdgarError };

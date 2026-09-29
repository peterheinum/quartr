/**
 * EDGAR filings API.
 *
 * Routes:
 *   GET /companies?q=apple                 company lookup for the UI picker
 *   GET /companies/:ticker/filings         paginated, filterable filing list
 *   GET /filings/summary?tickers=AAPL,SPOT 12-month counts + latest 10-K
 *   GET /health
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { EdgarError } from "./edgar/client";
import { companies, NotFound } from "./routes/companies";
import { summaryRoutes } from "./routes/summary";
import { BadRequest } from "./routes/query";

const port = Number(process.env.PORT ?? 3001);

if (!process.env.SEC_USER_AGENT) {
  console.warn(
    "[warn] SEC_USER_AGENT is not set. The SEC requires a User-Agent with real\n" +
      "       contact info and will reject requests without one. Copy .env.example\n" +
      "       to .env and fill it in.",
  );
}

export const app = new Elysia()
  .use(cors())
  /**
   * One error shape for every failure, so the client never has to guess.
   * Upstream EDGAR failures become 502 rather than leaking as a 500, except
   * for a 404, which means the CIK genuinely has no submissions.
   */
  .onError(({ error, code, set }) => {
    if (error instanceof NotFound || error instanceof BadRequest) {
      set.status = error.status;
      return { error: error.message };
    }
    if (error instanceof EdgarError) {
      set.status = error.status === 404 ? 404 : 502;
      return {
        error: error.status === 404 ? "No filings found for that company" : "EDGAR request failed",
        upstreamStatus: error.status,
      };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "No such route" };
    }
    set.status = 500;
    console.error("[error]", error);
    return { error: "Internal server error" };
  })
  .get("/health", () => ({ ok: true }))
  .use(companies)
  .use(summaryRoutes)
  .listen(port);

console.log(`EDGAR API listening on http://localhost:${port}`);

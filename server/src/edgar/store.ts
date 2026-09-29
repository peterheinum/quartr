/**
 * Per-company filing store: fetches, caches, and progressively backfills.
 *
 * EDGAR splits a company's history into `filings.recent` plus zero or more
 * overflow chunks. `recent` is generous -- at least the last 12 months and at
 * least 1000 filings -- so it alone answers the common case, while JPMorgan's
 * remaining 141,172 filings live in 70 separate JSON documents.
 *
 * Fetching all of those before responding would make a cold JPMorgan request
 * take ~9 seconds. Instead:
 *
 *   1. Fetch `recent` and serve it immediately, flagged `partial`.
 *   2. Backfill the overflow chunks in the background, newest first, so the
 *      filings a user is most likely to page into arrive earliest.
 *   3. Cache everything per CIK. Concurrent callers share one fetch rather
 *      than racing, and a reload during backfill picks up whatever has landed.
 */
import type { Filing } from "@quartr/shared";
import { edgarFetch } from "./client";
import { normalizeFilings, type SubmissionsResponse } from "./normalize";

/** How long a company's filings stay cached. EDGAR updates a few times daily. */
const TTL_MS = 60 * 60 * 1000;

/** Overflow chunks fetched concurrently during backfill. */
const BACKFILL_CONCURRENCY = 3;

export type CompanyFilings = {
  cik: string;
  name: string;
  filings: Filing[];
  /** True while overflow chunks are still loading; `filings` may still grow. */
  partial: boolean;
  /** Set when the background backfill failed; the served data is still valid. */
  backfillError?: string;
};

type Entry = {
  loadedAt: number;
  data: CompanyFilings;
  /** Resolves once `recent` has been fetched. */
  ready: Promise<void>;
  /** Resolves once every overflow chunk has landed (or failed). */
  complete: Promise<void>;
};

const cache = new Map<string, Entry>();

/** Newest filings first; ties broken by accession number for a stable order. */
function byFilingDateDesc(a: Filing, b: Filing): number {
  return (
    b.filingDate.localeCompare(a.filingDate) ||
    b.accessionNumber.localeCompare(a.accessionNumber)
  );
}

async function backfill(
  cik: string,
  files: SubmissionsResponse["filings"]["files"],
  data: CompanyFilings,
): Promise<void> {
  // `files` is ordered newest-first, which is the order we want to load in.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const file = files[i];
      if (!file) return;
      const chunk = await edgarFetch<SubmissionsResponse["filings"]["recent"]>(
        `https://data.sec.gov/submissions/${file.name}`,
      );
      // Publish each chunk as it arrives so in-flight requests see progress.
      data.filings.push(...normalizeFilings(cik, chunk));
      data.filings.sort(byFilingDateDesc);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(BACKFILL_CONCURRENCY, files.length) }, worker),
    );
  } catch (error) {
    // A failed chunk must not invalidate the filings we already serve.
    data.backfillError = error instanceof Error ? error.message : String(error);
  } finally {
    data.partial = false;
  }
}

function load(cik: string): Entry {
  const data: CompanyFilings = { cik, name: "", filings: [], partial: true };
  let resolveComplete!: () => void;
  const complete = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });

  const ready = (async () => {
    const submissions = await edgarFetch<SubmissionsResponse>(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
    );
    data.name = submissions.name;
    data.filings = normalizeFilings(cik, submissions.filings.recent);
    data.filings.sort(byFilingDateDesc);

    const files = submissions.filings.files ?? [];
    if (files.length === 0) {
      data.partial = false;
      resolveComplete();
      return;
    }
    // Deliberately not awaited: `recent` is servable now.
    void backfill(cik, files, data).finally(resolveComplete);
  })();

  // A failed initial fetch must not leave a poisoned entry behind.
  ready.catch(() => {
    cache.delete(cik);
    resolveComplete();
  });

  return { loadedAt: Date.now(), data, ready, complete };
}

function entryFor(cik: string): Entry {
  const existing = cache.get(cik);
  if (existing && Date.now() - existing.loadedAt < TTL_MS) return existing;
  const entry = load(cik);
  cache.set(cik, entry);
  return entry;
}

/**
 * Filings for a company, available as soon as `recent` has loaded.
 * The returned object is the live cache entry: `filings` grows and `partial`
 * flips to false as background chunks land.
 */
export async function getFilings(cik: string): Promise<CompanyFilings> {
  const entry = entryFor(cik);
  await entry.ready;
  return entry.data;
}

/**
 * Filings for a company once every overflow chunk has loaded.
 * Only worth awaiting when completeness matters more than latency.
 */
export async function getAllFilings(cik: string): Promise<CompanyFilings> {
  const entry = entryFor(cik);
  await entry.ready;
  await entry.complete;
  return entry.data;
}

/** Testing and operational escape hatch. */
export function clearCache(): void {
  cache.clear();
}

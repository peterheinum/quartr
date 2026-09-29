/**
 * Low-level HTTP access to EDGAR.
 *
 * Two things the SEC insists on and will punish you for ignoring:
 *  - a User-Agent header identifying you with real contact info (else 403)
 *  - no more than 10 requests/second (else 403 and eventually a block)
 *
 * Everything that talks to sec.gov goes through `edgarFetch` so those rules
 * are enforced in exactly one place.
 */

const USER_AGENT =
  process.env.SEC_USER_AGENT ?? "Quartr Assignment contact@example.com";

/** SEC allows 10 req/s. We stay comfortably under it. */
const MIN_INTERVAL_MS = 125;

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serialises requests and spaces them out, so we never burst past the limit. */
function scheduled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this request rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export class EdgarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "EdgarError";
  }
}

async function edgarRequest<T>(
  url: string,
  retries: number,
  accept: string,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  return scheduled(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Encoding": "gzip, deflate",
          Accept: accept,
        },
      });

      if (res.ok) return read(res);

      // 429/5xx are worth retrying with backoff; 403/404 are not.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new EdgarError(
          `EDGAR request failed (${res.status} ${res.statusText})`,
          res.status,
          url,
        );
      }
      await Bun.sleep(500 * 2 ** attempt);
    }
  });
}

export function edgarFetch<T>(url: string, retries = 2): Promise<T> {
  return edgarRequest(url, retries, "application/json", async (res) => (await res.json()) as T);
}

/** For filing documents (HTML/text) rather than the JSON APIs. Same rate limit and retries. */
export function edgarFetchText(url: string, retries = 2): Promise<string> {
  return edgarRequest(url, retries, "text/html,*/*", (res) => res.text());
}

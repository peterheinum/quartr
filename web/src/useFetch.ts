/**
 * Minimal data-fetching hook.
 *
 * Three things it has to get right, which is why it exists rather than a bare
 * useEffect at each call site:
 *
 *  - Aborts the previous request when its inputs change. Without this, a slow
 *    response for the company you just navigated away from can land after the
 *    fast one and overwrite it.
 *  - Keeps the last successful data visible while refetching, so the table
 *    does not blank out on every keystroke or page change.
 *  - Supports polling, used while the server reports `partial: true` and is
 *    still loading a company's older filings in the background.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type FetchState<T> = {
  data: T | null;
  error: string | null;
  /** True during the first load, when there is nothing to show yet. */
  loading: boolean;
  /** True while refreshing with data already on screen. */
  refreshing: boolean;
  refetch: () => void;
};

export function useFetch<T>(
  /** Runs the request. Must forward `signal` so cancellation works. */
  request: ((signal: AbortSignal) => Promise<T>) | null,
  /** Values that should trigger a refetch when they change. */
  deps: unknown[],
  /** Poll interval in ms while this returns true for the current data. */
  pollWhile?: (data: T) => boolean,
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so changing the request function does not restart the effect.
  const requestRef = useRef(request);
  requestRef.current = request;

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const run = requestRef.current;
    if (!run) {
      setData(null);
      setError(null);
      setPending(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setPending(true);

    run(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        // An abort is an expected consequence of the inputs changing.
        if (cancelled || (cause instanceof Error && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  // Poll while the server says more data is still arriving.
  useEffect(() => {
    if (!data || !pollWhile?.(data)) return;
    const timer = setTimeout(refetch, 2500);
    return () => clearTimeout(timer);
  }, [data, pollWhile, refetch]);

  return {
    data,
    error,
    loading: pending && data === null,
    refreshing: pending && data !== null,
    refetch,
  };
}

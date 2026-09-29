/**
 * Query-parameter parsing shared by the routes.
 *
 * Kept separate from the route handlers so the parsing rules are testable and
 * so malformed input produces one consistent error shape.
 */

export class BadRequest extends Error {
  readonly status = 400;
}

/** A query value Elysia may hand us as a string, a repeated array, or nothing. */
type Raw = string | string[] | undefined | null;

/**
 * Collects a repeatable, comma-separatable parameter.
 * `?form=10-K&form=8-K` and `?form=10-K,8-K` are equivalent.
 */
export function parseList(raw: Raw): string[] {
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return parts
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseBoolean(raw: Raw, fallback: boolean): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return fallback;
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  throw new BadRequest(`Expected a boolean, got "${value}"`);
}

export function parseInteger(
  raw: Raw,
  { name, fallback, min, max }: { name: string; fallback: number; min: number; max: number },
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequest(`${name} must be an integer, got "${value}"`);
  }
  if (parsed < min || parsed > max) {
    throw new BadRequest(`${name} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

export function parseSort(raw: Raw): "asc" | "desc" {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  if (!value) return "desc";
  if (value === "asc" || value === "desc") return value;
  throw new BadRequest(`sort must be "asc" or "desc", got "${value}"`);
}

/** ISO date (YYYY-MM-DD), the format EDGAR uses throughout. */
export function parseDate(raw: Raw, name: string): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequest(`${name} must be an ISO date (YYYY-MM-DD), got "${value}"`);
  }
  return value;
}

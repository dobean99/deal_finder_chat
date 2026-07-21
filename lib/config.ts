// Central config. Ranking weights live here (PRD §7 — tunable, never hardcoded
// at call sites). Env access is centralized so missing vars fail loudly once.

export const RANKING_WEIGHTS = {
  price: 0.45,
  voucher: 0.35,
  quality: 0.2,
} as const;

/** Saturation constant for voucherScore = 1 − e^(−n/K). */
export const VOUCHER_SATURATION_K = 2;

/** Attribution cookie name + lifetime; maxAge is re-armed on every /go hit. */
export const ATTRIBUTION_COOKIE = "df_click";
export const ATTRIBUTION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

/** Result set size bounds (PRD F1: 3–8 items). */
export const MIN_RESULTS = 3;
export const MAX_RESULTS = 8;

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function envOptional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

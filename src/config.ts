import type { FitConfig } from "./fit.js";
import { CAUSE_AREAS } from "./ntee.js";

export interface Config {
  apiKey: string;
  filingTtlMs: number;
  propublicaBaseUrl: string;
  /** Local convenience: let the dashboard fetch the key from loopback clients. */
  devPrefillKey: boolean;
  fit: FitConfig;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseMoney(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

// Accepts names case-insensitively and returns the canonical cause-area names.
function parseCauses(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  const byLower = new Map(Object.values(CAUSE_AREAS).map((n) => [n.toLowerCase(), n]));
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const canonical = byLower.get(s.toLowerCase());
      if (!canonical) {
        throw new Error(
          `FIT_TARGET_CAUSES: unknown cause area "${s}". Valid: ${[...byLower.values()].join(", ")}`,
        );
      }
      return canonical;
    });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SCOUT_API_KEY;
  if (!apiKey) {
    throw new Error("SCOUT_API_KEY is required (see .env.example)");
  }
  const ttlDays = Number(env.FILING_TTL_DAYS ?? 30);
  if (!Number.isFinite(ttlDays) || ttlDays < 0) {
    throw new Error("FILING_TTL_DAYS must be a non-negative number");
  }
  const minRevenue = parseMoney(env.FIT_MIN_REVENUE, 250_000, "FIT_MIN_REVENUE");
  const maxRevenue = parseMoney(env.FIT_MAX_REVENUE, 5_000_000, "FIT_MAX_REVENUE");
  if (minRevenue > maxRevenue) throw new Error("FIT_MIN_REVENUE must not exceed FIT_MAX_REVENUE");
  return {
    apiKey,
    filingTtlMs: ttlDays * DAY_MS,
    propublicaBaseUrl:
      env.PROPUBLICA_BASE_URL ??
      "https://projects.propublica.org/nonprofits/api/v2",
    devPrefillKey: env.SCOUT_DEV_PREFILL === "true",
    fit: { minRevenue, maxRevenue, targetCauses: parseCauses(env.FIT_TARGET_CAUSES) },
  };
}

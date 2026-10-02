export interface Config {
  apiKey: string;
  filingTtlMs: number;
  propublicaBaseUrl: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SCOUT_API_KEY;
  if (!apiKey) {
    throw new Error("SCOUT_API_KEY is required (see .env.example)");
  }
  const ttlDays = Number(env.FILING_TTL_DAYS ?? 30);
  if (!Number.isFinite(ttlDays) || ttlDays < 0) {
    throw new Error("FILING_TTL_DAYS must be a non-negative number");
  }
  return {
    apiKey,
    filingTtlMs: ttlDays * DAY_MS,
    propublicaBaseUrl:
      env.PROPUBLICA_BASE_URL ??
      "https://projects.propublica.org/nonprofits/api/v2",
  };
}

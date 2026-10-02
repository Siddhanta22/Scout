import { AppError } from "./errors.js";

export interface SearchParams {
  q?: string;
  state?: string;
  /** ProPublica NTEE major group id, 1-10 */
  ntee?: number;
  /** 0-indexed */
  page?: number;
}

export interface SearchOrg {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  nteeCode: string | null;
}

export interface SearchResult {
  total: number;
  page: number;
  numPages: number;
  results: SearchOrg[];
}

export interface FilingData {
  taxYear: number;
  totalRevenue: number | null;
  totalExpenses: number | null;
  totalAssets: number | null;
}

export interface OrgDetail {
  organization: Omit<SearchOrg, "ein"> & { ein: string };
  filings: FilingData[];
}

export interface PropublicaClient {
  search(params: SearchParams): Promise<SearchResult>;
  /** Resolves null when ProPublica has no such EIN. */
  getOrganization(ein: string): Promise<OrgDetail | null>;
}

export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Minimum gap between upstream requests; ProPublica is free, not unlimited. */
  minIntervalMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ProPublica returns numbers or nulls inconsistently; coerce defensively.
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const ein9 = (v: unknown): string => String(v).padStart(9, "0");

export function createPropublicaClient(opts: ClientOptions): PropublicaClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.maxRetries ?? 2;
  const minInterval = opts.minIntervalMs ?? 250;

  // Serialize requests through a simple gate so bursts can't hammer upstream.
  let gate: Promise<void> = Promise.resolve();
  let lastStart = 0;
  function throttle(): Promise<void> {
    const turn = gate.then(async () => {
      const wait = lastStart + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
    });
    gate = turn.catch(() => undefined);
    return turn;
  }

  async function getJson(url: string): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      let res: Response;
      try {
        res = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/json" },
        });
      } catch (err: any) {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw timedOut
          ? new AppError(504, "UPSTREAM_TIMEOUT", "ProPublica did not respond in time")
          : new AppError(502, "UPSTREAM_ERROR", "Could not reach ProPublica");
      }

      if (res.status === 404) return { status: 404, body: null };
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 10_000)
              : backoff(attempt),
          );
          continue;
        }
        throw new AppError(
          res.status === 429 ? 503 : 502,
          res.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_ERROR",
          `ProPublica responded ${res.status}`,
        );
      }
      if (!res.ok) {
        throw new AppError(502, "UPSTREAM_ERROR", `ProPublica responded ${res.status}`);
      }
      try {
        return { status: res.status, body: await res.json() };
      } catch {
        throw new AppError(502, "UPSTREAM_ERROR", "ProPublica returned invalid JSON");
      }
    }
  }

  const backoff = (attempt: number) => 500 * 2 ** attempt;

  return {
    async search({ q, state, ntee, page }) {
      const url = new URL(`${opts.baseUrl}/search.json`);
      if (q) url.searchParams.set("q", q);
      if (state) url.searchParams.set("state[id]", state);
      if (ntee) url.searchParams.set("ntee[id]", String(ntee));
      if (page) url.searchParams.set("page", String(page));
      const { body } = await getJson(url.toString());
      // A 404 from search just means no results.
      const orgs: any[] = Array.isArray(body?.organizations) ? body.organizations : [];
      return {
        total: num(body?.total_results) ?? 0,
        page: num(body?.cur_page) ?? page ?? 0,
        numPages: num(body?.num_pages) ?? 0,
        results: orgs.map((o) => ({
          ein: ein9(o.ein),
          name: str(o.name) ?? "(unnamed)",
          city: str(o.city),
          state: str(o.state),
          nteeCode: str(o.ntee_code),
        })),
      };
    },

    async getOrganization(ein) {
      const { status, body } = await getJson(`${opts.baseUrl}/organizations/${ein}.json`);
      if (status === 404 || !body?.organization) return null;
      const o = body.organization;
      const rows: any[] = Array.isArray(body.filings_with_data)
        ? body.filings_with_data
        : [];
      // Keep one row per tax year (amended filings can repeat a year); the API
      // lists newest first, so first wins.
      const byYear = new Map<number, FilingData>();
      for (const f of rows) {
        const taxYear = num(f.tax_prd_yr);
        if (taxYear === null || byYear.has(taxYear)) continue;
        byYear.set(taxYear, {
          taxYear,
          totalRevenue: num(f.totrevenue),
          totalExpenses: num(f.totfuncexpns),
          totalAssets: num(f.totassetsend),
        });
      }
      return {
        organization: {
          ein: ein9(o.ein),
          name: str(o.name) ?? "(unnamed)",
          city: str(o.city),
          state: str(o.state),
          nteeCode: str(o.ntee_code),
        },
        filings: [...byYear.values()].sort((a, b) => b.taxYear - a.taxYear),
      };
    },
  };
}

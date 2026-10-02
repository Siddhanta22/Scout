import type { Db } from "./db.js";
import { AppError } from "./errors.js";
import { causeAreaFor } from "./ntee.js";
import type { PropublicaClient } from "./propublica.js";

export interface OrgView {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  nteeCode: string | null;
  causeArea: string | null;
  fetchedAt: string;
}

export interface FilingView {
  taxYear: number;
  totalRevenue: number | null;
  totalExpenses: number | null;
  totalAssets: number | null;
}

export interface OrgResult {
  organization: OrgView;
  filings: FilingView[];
  /** true when served from the local cache without calling ProPublica */
  cached: boolean;
  /** true when the cache was past its TTL but upstream failed, so we served it anyway */
  stale: boolean;
}

export interface OrgServiceOptions {
  db: Db;
  client: PropublicaClient;
  ttlMs: number;
  now?: () => Date;
}

export function createOrgService({ db, client, ttlMs, now = () => new Date() }: OrgServiceOptions) {
  async function readCache(ein: string) {
    return db.organization.findUnique({
      where: { ein },
      include: { filings: { orderBy: { taxYear: "desc" } } },
    });
  }

  function toResult(
    row: NonNullable<Awaited<ReturnType<typeof readCache>>>,
    flags: { cached: boolean; stale: boolean },
  ): OrgResult {
    return {
      organization: {
        ein: row.ein,
        name: row.name,
        city: row.city,
        state: row.state,
        nteeCode: row.nteeCode,
        causeArea: causeAreaFor(row.nteeCode),
        fetchedAt: row.fetchedAt.toISOString(),
      },
      filings: row.filings.map((f) => ({
        taxYear: f.taxYear,
        totalRevenue: f.totalRevenue,
        totalExpenses: f.totalExpenses,
        totalAssets: f.totalAssets,
      })),
      ...flags,
    };
  }

  /**
   * Cache-first lookup. Within the TTL we never call upstream. Past the TTL
   * we refetch; if that fails and we hold older data, we serve it flagged stale
   * rather than failing the request.
   */
  async function getOrganization(ein: string): Promise<OrgResult> {
    const cached = await readCache(ein);
    const fresh = cached && now().getTime() - cached.fetchedAt.getTime() < ttlMs;
    if (cached && fresh) return toResult(cached, { cached: true, stale: false });

    let detail;
    try {
      detail = await client.getOrganization(ein);
    } catch (err) {
      if (cached) return toResult(cached, { cached: true, stale: true });
      throw err;
    }
    if (!detail) {
      throw new AppError(404, "ORG_NOT_FOUND", `No organization with EIN ${ein}`);
    }

    const fetchedAt = now();
    const { organization: o, filings } = detail;
    // Replace the whole filing set atomically so a partial write can't leave
    // the cache half-updated.
    await db.$transaction([
      db.organization.upsert({
        where: { ein },
        create: { ein, name: o.name, city: o.city, state: o.state, nteeCode: o.nteeCode, fetchedAt },
        update: { name: o.name, city: o.city, state: o.state, nteeCode: o.nteeCode, fetchedAt },
      }),
      db.filingSnapshot.deleteMany({ where: { ein } }),
      db.filingSnapshot.createMany({
        data: filings.map((f) => ({ ein, ...f, fetchedAt })),
      }),
    ]);
    const row = await readCache(ein);
    return toResult(row!, { cached: false, stale: false });
  }

  return { getOrganization };
}

export type OrgService = ReturnType<typeof createOrgService>;

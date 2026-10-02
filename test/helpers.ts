import { PrismaClient } from "@prisma/client";
import type { Config } from "../src/config.js";
import type { OrgDetail, PropublicaClient, SearchResult } from "../src/propublica.js";

export const API_KEY = "test-key";

export const testConfig: Config = {
  apiKey: API_KEY,
  filingTtlMs: 30 * 24 * 60 * 60 * 1000,
  propublicaBaseUrl: "http://upstream.invalid",
  devPrefillKey: false,
};

export function makeOrg(ein: string, overrides: Partial<OrgDetail["organization"]> = {}): OrgDetail {
  return {
    organization: {
      ein,
      name: "Helping Hands",
      city: "Austin",
      state: "TX",
      nteeCode: "P20",
      ...overrides,
    },
    filings: [
      { taxYear: 2023, totalRevenue: 2_000_000, totalExpenses: 1_800_000, totalAssets: 900_000 },
      { taxYear: 2022, totalRevenue: 1_500_000, totalExpenses: 1_400_000, totalAssets: 800_000 },
      { taxYear: 2021, totalRevenue: null, totalExpenses: null, totalAssets: null },
    ],
  };
}

/** In-memory ProPublica stand-in that counts calls. */
export function fakeClient(orgs: Record<string, OrgDetail> = {}) {
  const calls = { search: 0, getOrganization: 0 };
  const state = { fail: null as Error | null, searchResult: null as SearchResult | null };
  const client: PropublicaClient = {
    async search() {
      calls.search++;
      if (state.fail) throw state.fail;
      return (
        state.searchResult ?? {
          total: 1,
          page: 0,
          numPages: 1,
          results: [{ ein: "123456789", name: "Helping Hands", city: "Austin", state: "TX", nteeCode: "P20" }],
        }
      );
    },
    async getOrganization(ein) {
      calls.getOrganization++;
      if (state.fail) throw state.fail;
      return orgs[ein] ?? null;
    },
  };
  return { client, calls, state, orgs };
}

export const db = new PrismaClient();

export async function resetDb() {
  await db.prospect.deleteMany();
  await db.filingSnapshot.deleteMany();
  await db.organization.deleteMany();
}

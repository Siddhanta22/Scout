import { describe, expect, it, vi } from "vitest";
import { createPropublicaClient } from "../src/propublica.js";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function client(fetchImpl: typeof fetch, extra = {}) {
  const sleeps: number[] = [];
  const c = createPropublicaClient({
    baseUrl: "http://x",
    fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    minIntervalMs: 0,
    ...extra,
  });
  return { c, sleeps };
}

describe("ProPublica client", () => {
  it("maps search params and trims the response, padding EINs", async () => {
    const f = vi.fn(async (_url: any) =>
      json({
        total_results: 1,
        num_pages: 1,
        cur_page: 0,
        organizations: [
          { ein: 1234567, name: "Tiny Org", city: "Reno", state: "NV", ntee_code: null, score: 9, strein: "x" },
        ],
      }),
    );
    const { c } = client(f as any);
    const r = await c.search({ q: "tiny", state: "NV", ntee: 5, page: 2 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("tiny");
    expect(url.searchParams.get("state[id]")).toBe("NV");
    expect(url.searchParams.get("ntee[id]")).toBe("5");
    expect(url.searchParams.get("page")).toBe("2");
    expect(r.results[0]).toEqual({
      ein: "001234567",
      name: "Tiny Org",
      city: "Reno",
      state: "NV",
      nteeCode: null,
    });
  });

  it("tolerates missing fields and de-duplicates amended filings per year", async () => {
    const f = vi.fn(async () =>
      json({
        organization: { ein: 530196605, name: "Org" },
        filings_with_data: [
          { tax_prd_yr: 2023, totrevenue: 10, totfuncexpns: null },
          { tax_prd_yr: 2023, totrevenue: 99 },
          { tax_prd_yr: 2021, totrevenue: "oops" },
          { totrevenue: 5 },
        ],
      }),
    );
    const { c } = client(f as any);
    const r = await c.getOrganization("530196605");
    expect(r!.organization).toMatchObject({ ein: "530196605", city: null, nteeCode: null });
    expect(r!.filings).toEqual([
      { taxYear: 2023, totalRevenue: 10, totalExpenses: null, totalAssets: null },
      { taxYear: 2021, totalRevenue: null, totalExpenses: null, totalAssets: null },
    ]);
  });

  it("returns null on upstream 404", async () => {
    const { c } = client((async () => new Response("{}", { status: 404 })) as any);
    expect(await c.getOrganization("111111111")).toBeNull();
  });

  it("retries 429 honoring Retry-After, then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(json({ organizations: [] }));
    const { c, sleeps } = client(f as any);
    await c.search({ q: "a" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2000);
  });

  it("gives up after max retries with a mapped error", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    const { c, sleeps } = client(f as any, { maxRetries: 2 });
    await expect(c.search({ q: "a" })).rejects.toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]); // exponential backoff
  });

  it("maps persistent 429 to 503 rate-limited", async () => {
    const f = vi.fn(async () => new Response("", { status: 429 }));
    const { c } = client(f as any, { maxRetries: 0 });
    await expect(c.search({ q: "a" })).rejects.toMatchObject({ status: 503, code: "UPSTREAM_RATE_LIMITED" });
  });

  it("maps timeouts to 504", async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    const { c } = client(f as any, { maxRetries: 0 });
    await expect(c.search({ q: "a" })).rejects.toMatchObject({ status: 504, code: "UPSTREAM_TIMEOUT" });
  });

  it("maps invalid JSON to 502", async () => {
    const { c } = client((async () => new Response("<html>", { status: 200 })) as any);
    await expect(c.search({ q: "a" })).rejects.toMatchObject({ status: 502 });
  });
});

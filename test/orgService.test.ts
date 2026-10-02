import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { createOrgService } from "../src/orgService.js";
import { db, fakeClient, makeOrg, resetDb } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const EIN = "123456789";

describe("org cache / TTL", () => {
  let clock = new Date("2026-01-01T00:00:00Z");
  const now = () => clock;

  beforeEach(async () => {
    await resetDb();
    clock = new Date("2026-01-01T00:00:00Z");
  });
  afterAll(() => db.$disconnect());

  function setup() {
    const fake = fakeClient({ [EIN]: makeOrg(EIN) });
    const svc = createOrgService({ db, client: fake.client, ttlMs: 30 * DAY, now });
    return { ...fake, svc };
  }

  it("fetches upstream on a cold cache and persists every year", async () => {
    const { svc, calls } = setup();
    const r = await svc.getOrganization(EIN);
    expect(calls.getOrganization).toBe(1);
    expect(r.cached).toBe(false);
    expect(r.filings.map((f) => f.taxYear)).toEqual([2023, 2022, 2021]);
    expect(await db.filingSnapshot.count({ where: { ein: EIN } })).toBe(3);
  });

  it("does NOT call upstream again within the TTL", async () => {
    const { svc, calls } = setup();
    await svc.getOrganization(EIN);
    clock = new Date(clock.getTime() + 29 * DAY);
    const r = await svc.getOrganization(EIN);
    expect(calls.getOrganization).toBe(1);
    expect(r.cached).toBe(true);
    expect(r.stale).toBe(false);
  });

  it("refetches once the TTL has expired", async () => {
    const { svc, calls } = setup();
    await svc.getOrganization(EIN);
    clock = new Date(clock.getTime() + 31 * DAY);
    const r = await svc.getOrganization(EIN);
    expect(calls.getOrganization).toBe(2);
    expect(r.cached).toBe(false);
    // replaced, not duplicated
    expect(await db.filingSnapshot.count({ where: { ein: EIN } })).toBe(3);
  });

  it("serves stale data when the refresh fails", async () => {
    const { svc, state } = setup();
    await svc.getOrganization(EIN);
    clock = new Date(clock.getTime() + 31 * DAY);
    state.fail = new AppError(502, "UPSTREAM_ERROR", "boom");
    const r = await svc.getOrganization(EIN);
    expect(r.stale).toBe(true);
    expect(r.filings).toHaveLength(3);
  });

  it("propagates upstream failure when there is nothing cached", async () => {
    const { svc, state } = setup();
    state.fail = new AppError(504, "UPSTREAM_TIMEOUT", "slow");
    await expect(svc.getOrganization(EIN)).rejects.toMatchObject({ status: 504 });
  });

  it("throws 404 for an unknown EIN and caches nothing", async () => {
    const { svc } = setup();
    await expect(svc.getOrganization("999999999")).rejects.toMatchObject({
      status: 404,
      code: "ORG_NOT_FOUND",
    });
    expect(await db.organization.count()).toBe(0);
  });
});

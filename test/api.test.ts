import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/errors.js";
import { API_KEY, db, fakeClient, makeOrg, resetDb, testConfig } from "./helpers.js";

const EIN = "123456789";
const EIN2 = "987654321";

function build() {
  const fake = fakeClient({
    [EIN]: makeOrg(EIN),
    [EIN2]: makeOrg(EIN2, { name: "Zeta Arts", state: "CA", nteeCode: "A20" }),
  });
  const app = createApp({ config: testConfig, db, client: fake.client });
  return { app, ...fake };
}
const auth = { "x-api-key": API_KEY };

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("end-to-end flow", () => {
  it("search -> save -> update status -> list -> history -> delete", async () => {
    const { app, calls } = build();

    // search is open (no key)
    const search = await request(app).get("/api/search").query({ q: "hands", state: "tx" });
    expect(search.status).toBe(200);
    expect(search.body.results[0]).toMatchObject({ ein: EIN, causeArea: "Human Services" });
    const ein = search.body.results[0].ein;

    // save
    const saved = await request(app).post("/api/prospects").set(auth).send({ ein });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      ein,
      name: "Helping Hands",
      status: "New",
      latestTaxYear: 2023,
      latestRevenue: 2_000_000,
    });
    const id = saved.body.id;

    // update status + notes
    const patched = await request(app)
      .patch(`/api/prospects/${id}`)
      .set(auth)
      .send({ status: "Contacted", notes: "Emailed ED on Monday" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ status: "Contacted", notes: "Emailed ED on Monday" });

    // list
    const list = await request(app).get("/api/prospects").query({ status: "Contacted" });
    expect(list.body.total).toBe(1);
    expect(list.body.prospects[0].id).toBe(id);

    // history is served from cache: saving populated it
    const before = calls.getOrganization;
    const hist = await request(app).get(`/api/prospects/${id}/history`);
    expect(hist.status).toBe(200);
    expect(hist.body.history.map((h: any) => h.taxYear)).toEqual([2021, 2022, 2023]);
    expect(hist.body.cached).toBe(true);
    expect(calls.getOrganization).toBe(before);

    // delete
    expect((await request(app).delete(`/api/prospects/${id}`).set(auth)).status).toBe(204);
    expect((await request(app).get("/api/prospects")).body.total).toBe(0);
  });
});

describe("auth", () => {
  it("rejects writes without a valid key but allows reads", async () => {
    const { app } = build();
    expect((await request(app).post("/api/prospects").send({ ein: EIN })).status).toBe(401);
    expect(
      (await request(app).post("/api/prospects").set("x-api-key", "nope").send({ ein: EIN })).status,
    ).toBe(401);
    expect((await request(app).patch("/api/prospects/x").send({ status: "Signed" })).status).toBe(401);
    expect((await request(app).delete("/api/prospects/x")).status).toBe(401);
    expect((await request(app).get("/api/prospects")).status).toBe(200);
    expect((await request(app).get("/api/search").query({ q: "a" })).status).toBe(200);
  });
});

describe("error handling", () => {
  it("returns a consistent JSON shape for invalid and unknown EINs", async () => {
    const { app } = build();
    const bad = await request(app).get("/api/organizations/abc");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const missing = await request(app).get("/api/organizations/111111111");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: "ORG_NOT_FOUND" });
  });

  it("accepts dashed EINs", async () => {
    const { app } = build();
    const r = await request(app).get("/api/organizations/12-3456789");
    expect(r.status).toBe(200);
    expect(r.body.organization.ein).toBe(EIN);
  });

  it("survives upstream failure without crashing or leaking internals", async () => {
    const { app, state } = build();
    state.fail = new AppError(504, "UPSTREAM_TIMEOUT", "ProPublica did not respond in time");
    const s = await request(app).get("/api/search").query({ q: "x" });
    expect(s.status).toBe(504);
    expect(s.body.error.code).toBe("UPSTREAM_TIMEOUT");
    const o = await request(app).get(`/api/organizations/${EIN}`);
    expect(o.status).toBe(504);

    state.fail = new Error("kaboom: secret internal detail");
    const u = await request(app).get("/api/search").query({ q: "x" });
    expect(u.status).toBe(500);
    expect(JSON.stringify(u.body)).not.toContain("secret");
    expect(u.body.error.code).toBe("INTERNAL");
  });

  it("validates search params and bodies", async () => {
    const { app } = build();
    expect((await request(app).get("/api/search")).status).toBe(400);
    expect((await request(app).get("/api/search").query({ q: "a", state: "Texas" })).status).toBe(400);
    expect((await request(app).post("/api/prospects").set(auth).send({})).status).toBe(400);
    const badJson = await request(app)
      .post("/api/prospects")
      .set(auth)
      .set("content-type", "application/json")
      .send("{nope");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe("INVALID_JSON");
  });

  it("404s unknown routes and prospects, 409s duplicates", async () => {
    const { app } = build();
    expect((await request(app).get("/api/nope")).body.error.code).toBe("NOT_FOUND");
    expect((await request(app).patch("/api/prospects/zzz").set(auth).send({ status: "Signed" })).status).toBe(404);
    expect((await request(app).post("/api/prospects").set(auth).send({ ein: "111111111" })).status).toBe(404);
    await request(app).post("/api/prospects").set(auth).send({ ein: EIN });
    expect((await request(app).post("/api/prospects").set(auth).send({ ein: EIN })).status).toBe(409);
  });

  it("rejects invalid status values", async () => {
    const { app } = build();
    const { body } = await request(app).post("/api/prospects").set(auth).send({ ein: EIN });
    const r = await request(app).patch(`/api/prospects/${body.id}`).set(auth).send({ status: "Won" });
    expect(r.status).toBe(400);
  });
});

describe("prospect list filters and sorting", () => {
  it("filters by status, state, cause and sorts by revenue", async () => {
    const { app, orgs } = build();
    orgs[EIN2].filings[0].totalRevenue = 5_000_000;
    // a prospect with no revenue data should sort last in both directions
    const EIN3 = "555555555";
    orgs[EIN3] = { ...makeOrg(EIN3, { name: "No Numbers", state: "TX" }), filings: [] };

    const ids: Record<string, string> = {};
    for (const ein of [EIN, EIN2, EIN3]) {
      ids[ein] = (await request(app).post("/api/prospects").set(auth).send({ ein })).body.id;
    }
    await request(app).patch(`/api/prospects/${ids[EIN2]}`).set(auth).send({ status: "Signed" });

    const names = (q: object) =>
      request(app)
        .get("/api/prospects")
        .query(q)
        .then((r) => r.body.prospects.map((p: any) => p.name));

    expect(await names({ status: "Signed" })).toEqual(["Zeta Arts"]);
    expect(await names({ state: "tx", sort: "name" })).toEqual(["Helping Hands", "No Numbers"]);
    expect(await names({ cause: "Human Services", sort: "name" })).toEqual(["Helping Hands", "No Numbers"]);
    expect(await names({ sort: "-revenue" })).toEqual(["Zeta Arts", "Helping Hands", "No Numbers"]);
    expect(await names({ sort: "revenue" })).toEqual(["Helping Hands", "Zeta Arts", "No Numbers"]);
  });
});

describe("CSV export", () => {
  it("exports the filtered shortlist as CSV, with no auth needed", async () => {
    const { app } = build();
    const a = await request(app).post("/api/prospects").set(auth).send({ ein: EIN, notes: 'Call "Sam", then =cmd' });
    await request(app).post("/api/prospects").set(auth).send({ ein: EIN2 });
    await request(app).patch(`/api/prospects/${a.body.id}`).set(auth).send({ status: "Contacted" });

    const all = await request(app).get("/api/prospects/export.csv").query({ sort: "name" });
    expect(all.status).toBe(200);
    expect(all.headers["content-type"]).toContain("text/csv");
    expect(all.headers["content-disposition"]).toContain("scout-shortlist.csv");
    const lines = all.text.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "Name,EIN,Status,City,State,Cause area,Latest tax year,Latest revenue,Website,Notes,Saved at,Updated at",
    );
    expect(lines).toHaveLength(3);
    // timestamps are "YYYY-MM-DD HH:MM:SS" so spreadsheets parse them as dates
    expect(lines[1]).toMatch(/,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(lines[1]).toContain("Helping Hands,12-3456789,Contacted,Austin,TX,Human Services,2023,2000000");
    expect(lines[1]).toContain('"Call ""Sam"", then =cmd"');

    const filtered = await request(app).get("/api/prospects/export.csv").query({ status: "New" });
    expect(filtered.text).toContain("Zeta Arts");
    expect(filtered.text).not.toContain("Helping Hands");

    expect((await request(app).get("/api/prospects/export.csv").query({ status: "Bogus" })).status).toBe(400);
  });
});

describe("dev key prefill", () => {
  it("is a 404 unless explicitly enabled", async () => {
    const { app } = build();
    const r = await request(app).get("/api/dev-key");
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(API_KEY);
  });

  it("returns the key to loopback clients when enabled", async () => {
    const fake = fakeClient();
    const app = createApp({ config: { ...testConfig, devPrefillKey: true }, db, client: fake.client });
    const r = await request(app).get("/api/dev-key"); // supertest connects via 127.0.0.1
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ apiKey: API_KEY });
  });
});

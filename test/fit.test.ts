import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { formatMoney, scoreFit, type FitConfig } from "../src/fit.js";

const cfg: FitConfig = { minRevenue: 250_000, maxRevenue: 5_000_000, targetCauses: [] };
const rev = (...vals: number[]) => vals.map((totalRevenue, i) => ({ taxYear: 2023 - i, totalRevenue }));
const byCriterion = (r: ReturnType<typeof scoreFit>, c: string) => r.reasons.find((x) => x.criterion === c)!;

describe("size", () => {
  it("full points inside the band, boundaries inclusive", () => {
    expect(byCriterion(scoreFit({ causeArea: null, revenues: rev(250_000) }, cfg), "size").points).toBe(40);
    expect(byCriterion(scoreFit({ causeArea: null, revenues: rev(5_000_000) }, cfg), "size").points).toBe(40);
  });

  it("half points when within 2x of the band, zero beyond", () => {
    expect(byCriterion(scoreFit({ causeArea: null, revenues: rev(130_000) }, cfg), "size").points).toBe(20);
    expect(byCriterion(scoreFit({ causeArea: null, revenues: rev(9_000_000) }, cfg), "size").points).toBe(20);
    const tiny = byCriterion(scoreFit({ causeArea: null, revenues: rev(20_000) }, cfg), "size");
    expect(tiny.points).toBe(0);
    expect(tiny.text).toContain("too small");
    const huge = byCriterion(scoreFit({ causeArea: null, revenues: rev(3_200_000_000) }, cfg), "size");
    expect(huge.points).toBe(0);
    expect(huge.text).toContain("own consultants");
  });

  it("states the reason with real numbers", () => {
    const r = scoreFit({ causeArea: null, revenues: rev(1_200_000) }, cfg);
    expect(byCriterion(r, "size").text).toBe("Revenue $1.2M (2023) is inside your target range of $250K-$5M");
  });
});

describe("cause", () => {
  it("is not scored when no target causes are configured", () => {
    const r = scoreFit({ causeArea: "Education", revenues: rev(1_000_000, 1_000_000) }, cfg);
    expect(r.reasons.map((x) => x.criterion)).toEqual(["size", "trend"]);
    expect(r.score).toBe(100); // 70/70, scaled
  });

  it("scores match, mismatch and unknown", () => {
    const withCause = { ...cfg, targetCauses: ["Education", "Health"] };
    const pts = (causeArea: string | null) =>
      byCriterion(scoreFit({ causeArea, revenues: rev(1_000_000) }, withCause), "cause").points;
    expect(pts("Education")).toBe(30);
    expect(pts("Human Services")).toBe(0);
    expect(pts(null)).toBe(0);
  });
});

describe("trend", () => {
  const pts = (...v: number[]) => byCriterion(scoreFit({ causeArea: null, revenues: rev(...v) }, cfg), "trend");

  it("rewards growth and steady revenue", () => {
    expect(pts(1_200_000, 1_000_000).points).toBe(30);
    expect(pts(1_200_000, 1_000_000).text).toBe("Revenue grew 20% from 2022 to 2023");
    expect(pts(950_000, 1_000_000).points).toBe(30); // -5% is steady
    expect(pts(950_000, 1_000_000).text).toContain("held steady");
  });

  it("penalizes decline in tiers", () => {
    expect(pts(800_000, 1_000_000).points).toBe(15); // -20%
    expect(pts(500_000, 1_000_000).points).toBe(0); // -50%
  });

  it("scores zero, with a reason, when it can't be computed", () => {
    expect(pts(1_000_000).text).toContain("Only one year");
    expect(pts(1_000_000).points).toBe(0);
    expect(pts(1_000_000, 0).text).toContain("trend is unknown");
  });
});

describe("overall label", () => {
  it("is Not enough data when there is no revenue at all", () => {
    const r = scoreFit({ causeArea: "Education", revenues: [] }, { ...cfg, targetCauses: ["Education"] });
    expect(r.label).toBe("Not enough data");
    expect(r.reasons[0].text).toContain("No revenue on file");
  });

  it("maps scores to labels", () => {
    const strong = scoreFit({ causeArea: null, revenues: rev(1_000_000, 900_000) }, cfg);
    expect(strong).toMatchObject({ score: 100, label: "Strong fit" });
    // in band (40) + steady/growing (30) = 70/70 -> 100; in band + revenue collapse (0) = 40/70 -> 57
    const possible = scoreFit({ causeArea: null, revenues: rev(500_000, 1_500_000) }, cfg);
    expect(possible).toMatchObject({ score: 57, label: "Possible fit" });
    const weak = scoreFit({ causeArea: null, revenues: rev(10_000, 12_000) }, cfg);
    expect(weak.label).toBe("Weak fit");
  });

  it("reasons always sum to the score", () => {
    const r = scoreFit({ causeArea: "Health", revenues: rev(800_000, 1_000_000) }, { ...cfg, targetCauses: ["Health"] });
    const earned = r.reasons.reduce((s, x) => s + x.points, 0);
    const possible = r.reasons.reduce((s, x) => s + x.max, 0);
    expect(Math.round((earned / possible) * 100)).toBe(r.score);
  });
});

describe("formatMoney", () => {
  it("formats compactly", () => {
    expect(formatMoney(250_000)).toBe("$250K");
    expect(formatMoney(1_250_000)).toBe("$1.3M");
    expect(formatMoney(3_200_000_000)).toBe("$3.2B");
    expect(formatMoney(900)).toBe("$900");
  });
});

describe("fit config from env", () => {
  const base = { SCOUT_API_KEY: "k" };
  it("has defaults", () => {
    expect(loadConfig(base).fit).toEqual({ minRevenue: 250_000, maxRevenue: 5_000_000, targetCauses: [] });
  });
  it("parses causes case-insensitively into canonical names", () => {
    const c = loadConfig({ ...base, FIT_TARGET_CAUSES: "education, human services", FIT_MIN_REVENUE: "100000" });
    expect(c.fit.targetCauses).toEqual(["Education", "Human Services"]);
    expect(c.fit.minRevenue).toBe(100_000);
  });
  it("rejects bad values loudly", () => {
    expect(() => loadConfig({ ...base, FIT_TARGET_CAUSES: "Puppies" })).toThrow(/unknown cause area/);
    expect(() => loadConfig({ ...base, FIT_MIN_REVENUE: "9000000" })).toThrow(/must not exceed/);
    expect(() => loadConfig({ ...base, FIT_MAX_REVENUE: "lots" })).toThrow(/non-negative/);
  });
});

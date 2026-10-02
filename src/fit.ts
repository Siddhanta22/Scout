// A transparent fit heuristic. Every point comes from a stated criterion with a
// plain-English reason, so a BD lead can see (and argue with) why a prospect
// scored the way it did. It is deliberately not a model.

export interface FitConfig {
  /** Target annual revenue band, in dollars */
  minRevenue: number;
  maxRevenue: number;
  /** Cause-area names the club cares about (see ntee.ts). Empty = any cause. */
  targetCauses: string[];
}

export interface FitInput {
  causeArea: string | null;
  /** Years that report revenue, newest first */
  revenues: { taxYear: number; totalRevenue: number }[];
}

export interface FitReason {
  criterion: "size" | "cause" | "trend";
  points: number;
  max: number;
  text: string;
}

export type FitLabel = "Strong fit" | "Possible fit" | "Weak fit" | "Not enough data";

export interface FitResult {
  /** 0-100 */
  score: number;
  label: FitLabel;
  reasons: FitReason[];
}

const WEIGHTS = { size: 40, cause: 30, trend: 30 } as const;
// An org within 2x of the band edge is "close", not a miss.
const NEAR_FACTOR = 2;

export function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) => `$${Number(v.toFixed(1)).toString()}${suffix}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "K");
  return `$${Math.round(n)}`;
}

const pct = (x: number) => `${Math.abs(Math.round(x * 100))}%`;

function scoreSize(input: FitInput, cfg: FitConfig): FitReason & { known: boolean } {
  const max = WEIGHTS.size;
  const latest = input.revenues[0];
  if (!latest) {
    return { criterion: "size", points: 0, max, known: false, text: "No revenue on file, so size can't be judged" };
  }
  const { totalRevenue: rev, taxYear } = latest;
  const band = `${formatMoney(cfg.minRevenue)}-${formatMoney(cfg.maxRevenue)}`;
  const label = `Revenue ${formatMoney(rev)} (${taxYear})`;
  if (rev >= cfg.minRevenue && rev <= cfg.maxRevenue) {
    return { criterion: "size", points: max, max, known: true, text: `${label} is inside your target range of ${band}` };
  }
  const below = rev < cfg.minRevenue;
  const near = below ? rev >= cfg.minRevenue / NEAR_FACTOR : rev <= cfg.maxRevenue * NEAR_FACTOR;
  if (near) {
    return {
      criterion: "size",
      points: max / 2,
      max,
      known: true,
      text: `${label} is slightly ${below ? "below" : "above"} your target range of ${band}`,
    };
  }
  return {
    criterion: "size",
    points: 0,
    max,
    known: true,
    text: `${label} is well ${below ? "below" : "above"} your target range of ${band}${
      below ? " (likely too small to use consulting help)" : " (likely has its own consultants)"
    }`,
  };
}

function scoreCause(input: FitInput, cfg: FitConfig): FitReason | null {
  if (cfg.targetCauses.length === 0) return null; // not scored when no preference is set
  const max = WEIGHTS.cause;
  if (!input.causeArea) {
    return { criterion: "cause", points: 0, max, text: "Cause area unknown (the IRS has no category on file)" };
  }
  if (cfg.targetCauses.includes(input.causeArea)) {
    return { criterion: "cause", points: max, max, text: `Cause area "${input.causeArea}" is one of your targets` };
  }
  return { criterion: "cause", points: 0, max, text: `Cause area "${input.causeArea}" is not one of your targets` };
}

function scoreTrend(input: FitInput): FitReason {
  const max = WEIGHTS.trend;
  const [latest, prev] = input.revenues;
  if (!latest || !prev) {
    return { criterion: "trend", points: 0, max, text: "Only one year of revenue on file, so the trend is unknown" };
  }
  if (prev.totalRevenue <= 0) {
    return { criterion: "trend", points: 0, max, text: `No revenue reported in ${prev.taxYear}, so the trend is unknown` };
  }
  const change = (latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue;
  const span = `${prev.taxYear} to ${latest.taxYear}`;
  if (change >= 0.05) {
    return { criterion: "trend", points: max, max, text: `Revenue grew ${pct(change)} from ${span}` };
  }
  if (change >= -0.1) {
    return { criterion: "trend", points: max, max, text: `Revenue held steady (${change < 0 ? "-" : "+"}${pct(change)}) from ${span}` };
  }
  if (change >= -0.3) {
    return { criterion: "trend", points: max / 2, max, text: `Revenue declined ${pct(change)} from ${span}` };
  }
  return { criterion: "trend", points: 0, max, text: `Revenue fell sharply, down ${pct(change)} from ${span}` };
}

export function scoreFit(input: FitInput, cfg: FitConfig): FitResult {
  const size = scoreSize(input, cfg);
  const { known, ...sizeReason } = size;
  const reasons: FitReason[] = [sizeReason, scoreCause(input, cfg), scoreTrend(input)].filter(
    (r): r is FitReason => r !== null,
  );
  const earned = reasons.reduce((s, r) => s + r.points, 0);
  const possible = reasons.reduce((s, r) => s + r.max, 0);
  const score = Math.round((earned / possible) * 100);

  let label: FitLabel;
  if (!known) label = "Not enough data";
  else if (score >= 75) label = "Strong fit";
  else if (score >= 45) label = "Possible fit";
  else label = "Weak fit";

  return { score, label, reasons };
}

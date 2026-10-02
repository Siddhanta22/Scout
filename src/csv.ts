export interface ProspectCsvRow {
  name: string;
  ein: string;
  status: string;
  city: string | null;
  state: string | null;
  causeArea: string | null;
  latestTaxYear: number | null;
  latestRevenue: number | null;
  website: string | null;
  notes: string;
  savedAt: string;
  updatedAt: string;
  fit: { label: string; score: number; reasons: { text: string }[] };
}

type Cell = string | number | null;

// Excel turns a bare 9-digit EIN into a number and drops leading zeros
// (030531535 -> 30531535). The IRS display form NN-NNNNNNN stays text.
const formatEin = (ein: string) => (/^\d{9}$/.test(ein) ? `${ein.slice(0, 2)}-${ein.slice(2)}` : ein);

// ISO "2026-10-02T19:13:22.244Z" stays text in Excel; "2026-10-02 19:13:22" (UTC)
// is parsed as a real date-time so the column sorts.
const formatTimestamp = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$/, "");

const COLUMNS: [label: string, get: (r: ProspectCsvRow) => Cell][] = [
  ["Name", (r) => r.name],
  ["EIN", (r) => formatEin(r.ein)],
  ["Status", (r) => r.status],
  ["Fit", (r) => r.fit.label],
  ["Fit score", (r) => r.fit.score],
  ["Fit reasons", (r) => r.fit.reasons.map((x) => x.text).join(" | ")],
  ["City", (r) => r.city],
  ["State", (r) => r.state],
  ["Cause area", (r) => r.causeArea],
  ["Latest tax year", (r) => r.latestTaxYear],
  ["Latest revenue", (r) => r.latestRevenue],
  ["Website", (r) => r.website],
  ["Notes", (r) => r.notes],
  ["Saved at", (r) => formatTimestamp(r.savedAt)],
  ["Updated at", (r) => formatTimestamp(r.updatedAt)],
];

// RFC 4180 quoting, plus defence against spreadsheet formula injection: notes
// and org names are user/external text, so a cell starting with = + - @ would
// otherwise be evaluated when opened in Excel or Sheets.
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function prospectsToCsv(rows: ProspectCsvRow[]): string {
  const lines = [
    COLUMNS.map(([label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([, get]) => csvCell(get(r))).join(",")),
  ];
  // BOM so Excel opens UTF-8 (accented names) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

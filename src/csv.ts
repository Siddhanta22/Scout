const COLUMNS = [
  ["name", "Name"],
  ["ein", "EIN"],
  ["status", "Status"],
  ["city", "City"],
  ["state", "State"],
  ["causeArea", "Cause area"],
  ["latestTaxYear", "Latest tax year"],
  ["latestRevenue", "Latest revenue"],
  ["website", "Website"],
  ["notes", "Notes"],
  ["savedAt", "Saved at"],
  ["updatedAt", "Updated at"],
] as const;

type Row = Record<(typeof COLUMNS)[number][0], string | number | null>;

// RFC 4180 quoting, plus defence against spreadsheet formula injection: notes
// and org names are user/external text, so a cell starting with = + - @ would
// otherwise be evaluated when opened in Excel or Sheets.
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Excel turns a bare 9-digit EIN into a number and drops leading zeros
// (030531535 -> 30531535). The IRS display form NN-NNNNNNN stays text.
const formatEin = (ein: string) => (/^\d{9}$/.test(ein) ? `${ein.slice(0, 2)}-${ein.slice(2)}` : ein);

// ISO "2026-10-02T19:13:22.244Z" stays text in Excel; "2026-10-02 19:13:22" (UTC)
// is parsed as a real date-time so the column sorts.
const formatTimestamp = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$/, "");

function display(key: (typeof COLUMNS)[number][0], value: string | number | null) {
  if (typeof value !== "string") return value;
  if (key === "ein") return formatEin(value);
  if (key === "savedAt" || key === "updatedAt") return formatTimestamp(value);
  return value;
}

export function prospectsToCsv(rows: Row[]): string {
  const lines = [
    COLUMNS.map(([, label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([key]) => csvCell(display(key, r[key]))).join(",")),
  ];
  // BOM so Excel opens UTF-8 (accented names) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

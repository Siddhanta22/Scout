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

export function prospectsToCsv(rows: Row[]): string {
  const lines = [
    COLUMNS.map(([, label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([key]) => csvCell(r[key])).join(",")),
  ];
  // BOM so Excel opens UTF-8 (accented names) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

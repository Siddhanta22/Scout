import { describe, expect, it } from "vitest";
import { csvCell, prospectsToCsv } from "../src/csv.js";

describe("csvCell", () => {
  it("leaves plain values alone and blanks nulls", () => {
    expect(csvCell("Helping Hands")).toBe("Helping Hands");
    expect(csvCell(null)).toBe("");
    expect(csvCell(2000000)).toBe("2000000");
    expect(csvCell(-5)).toBe("-5"); // numbers are not formulas
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });
});

describe("prospectsToCsv", () => {
  it("emits BOM, header and CRLF rows", () => {
    const out = prospectsToCsv([]);
    expect(out.startsWith("﻿Name,EIN,Status")).toBe(true);
    expect(out.endsWith("\r\n")).toBe(true);
  });
});

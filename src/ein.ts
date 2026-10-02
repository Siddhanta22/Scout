import { z } from "zod";

// Accepts "53-0196605" or "530196605"; normalizes to 9 digits.
export const einSchema = z
  .string()
  .trim()
  .transform((s) => s.replace("-", ""))
  .pipe(z.string().regex(/^\d{9}$/, "EIN must be 9 digits (e.g. 53-0196605)"));

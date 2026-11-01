import { z } from "zod";

// PostgreSQL text/JSON cannot retain nulls or unpaired UTF-16 surrogates.
// The Unicode flag treats valid surrogate pairs (including emoji) as one code point.
export const validUnicode = (value: string) =>
  !/[\u0000\uD800-\uDFFF]/u.test(value);
export const unicodeMessage = "Use valid Unicode text without null characters.";
export const storedText = (max = 2000) =>
  z.string().trim().max(max).refine(validUnicode, unicodeMessage);

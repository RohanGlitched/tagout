/**
 * The number of units a recall covers, from CPSC's free-text NumberOfUnits: "About 1.2 million" → 1200000,
 * "About 255,000" → 255000, "Approximately 31,200 (in addition to …)" → 31200. The first number counts, with a
 * "million" or "thousand" right after it; undefined when there's no number.
 */
export function parseUnits(s: string | undefined | null): number | undefined {
  const m = (s ?? "").match(/(\d[\d,]*(?:\.\d+)?)\s*(million|thousand)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const mult = /^m/i.test(m[2] ?? "") ? 1e6 : /^t/i.test(m[2] ?? "") ? 1e3 : 1;
  return Math.round(n * mult);
}

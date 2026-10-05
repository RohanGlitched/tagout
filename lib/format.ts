import type { Notice, Source } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-04" → "4 Jun 2026". Unknown dates read as an empty string. */
export function fmtDate(iso: string | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const AGENCY: Record<Source, string> = {
  nhtsa: "NHTSA",
  cpsc: "CPSC",
  fda: "FDA",
  fsis: "USDA FSIS",
  web: "Web",
};

export const AGENCY_LONG: Record<Source, string> = {
  nhtsa: "National Highway Traffic Safety Administration",
  cpsc: "Consumer Product Safety Commission",
  fda: "Food and Drug Administration",
  fsis: "USDA Food Safety and Inspection Service",
  web: "Found on the web by Tavily",
};

/** How a notice names itself on a tag: "CPSC recall 26-532" or the site it came from. */
export function noticeRef(n: Notice): string {
  if (n.source === "web") return n.id;
  if (n.source === "nhtsa") return `NHTSA campaign ${n.id}`;
  return `${AGENCY[n.source]} recall ${n.id}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function fmtUnits(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} million units`;
  return `${n.toLocaleString("en-US")} ${n === 1 ? "unit" : "units"}`;
}

import "server-only";
import { unstable_cache } from "next/cache";
import { cpscFeed, latestCpsc } from "./sources/cpsc";
import type { Notice } from "./types";

/** Hazard families, each in its ANSI Z535 safety colour on the wall. */
export type Hazard = "fire" | "ingest" | "breath" | "injury" | "shock" | "other";

export type WallTag = { t: string; d: string; u: string; h: Hazard; n?: string };
export type WallMonth = { key: string; tags: WallTag[] };
export type Wall = { months: WallMonth[]; total: number; counts: Record<Hazard, number>; at: string; year: number };

const RULES: [Hazard, RegExp][] = [
  ["fire", /fire|burn|overheat|flame|explo/],
  ["ingest", /ingest|chok|swallow|magnet|button cell|coin batter|aspiration/],
  ["breath", /entrap|suffocat|strangulat|asphyx|drown|tip-over|tip over/],
  ["shock", /shock|electrocut/],
  ["injury", /injur|fall|lacerat|crash|impact|head|cut|crush|amputat/],
];

/** The first family whose words appear in the title or hazard text; fire wins ties because it's checked first. */
export function hazardOf(n: Pick<Notice, "title" | "hazard">): Hazard {
  const t = `${n.title} ${n.hazard ?? ""}`.toLowerCase();
  return RULES.find(([, re]) => re.test(t))?.[0] ?? "other";
}

/** "Vornado Air Recalls SRTH Small Room Tower Heaters Due to Fire Hazard" → "SRTH Small Room Tower Heaters". */
function shortTitle(title: string): string {
  const m = title.match(/recalls?\s+(.*?)(?:\s+(?:due to|because)\b|;|$)/i);
  const t = (m?.[1] || title).replace(/\s+recalled$/i, "").trim();
  return t.length > 70 ? `${t.slice(0, 68).trimEnd()}…` : t;
}

/**
 * Every CPSC recall this year, by month, for the home page's tag wall. The API plus the newsroom feed (which runs
 * about a week ahead). Cached for six hours; on failure the wall is simply left out.
 */
async function load(): Promise<Wall> {
  const year = new Date().getUTCFullYear();
  const [api, feed] = await Promise.all([latestCpsc(`${year}-01-01`), cpscFeed().catch(() => [] as Notice[])]);
  const titles = new Set(api.map((n) => n.title.toLowerCase()));
  const all = [...api, ...feed.filter((n) => n.date.startsWith(String(year)) && !titles.has(n.title.toLowerCase()))];
  const counts: Record<Hazard, number> = { fire: 0, ingest: 0, breath: 0, injury: 0, shock: 0, other: 0 };
  const byMonth = new Map<string, WallTag[]>();
  for (const n of all.sort((a, b) => a.date.localeCompare(b.date))) {
    const h = hazardOf(n);
    counts[h]++;
    const key = n.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push({ t: shortTitle(n.title), d: n.date, u: n.url, h, ...(/^\d{2}-\d{3}$/.test(n.id) ? { n: n.id } : {}) });
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, tags]) => ({ key, tags }));
  return { months, total: all.length, counts, at: new Date().toISOString(), year };
}

export const yearWall = unstable_cache(load, ["year-wall-v1"], { revalidate: 6 * 3600 });

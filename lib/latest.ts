import "server-only";
import { unstable_cache } from "next/cache";
import type { Notice } from "./types";
import { cpscFeed, latestCpsc } from "./sources/cpsc";
import { latestFda } from "./sources/fda";

/**
 * The newest recalls across agencies, for the home page and /recalls: the CPSC newsroom feed (a week ahead of
 * its API) merged with the API, and FDA's newest drug, food and device enforcement reports. Cached for an hour;
 * a source that fails is left out rather than failing the page.
 */
async function load(): Promise<{ notices: Notice[]; at: string; failed: string[] }> {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const failed: string[] = [];
  const safe = <T,>(name: string, p: Promise<T[]>) =>
    p.catch((e) => {
      console.error(`[latest] ${name}:`, (e as Error).message);
      failed.push(name);
      return [] as T[];
    });
  const [feed, api, drug, food, device] = await Promise.all([
    safe("CPSC feed", cpscFeed()),
    safe("CPSC", latestCpsc(since)),
    safe("FDA drugs", latestFda("drug", 12)),
    safe("FDA food", latestFda("food", 12)),
    safe("FDA devices", latestFda("device", 8)),
  ]);
  // The feed and the API describe the same recalls; prefer the API's record (it has hazards and images).
  const apiTitles = new Set(api.map((n) => n.title.toLowerCase()));
  const cpsc = [...api, ...feed.filter((n) => !apiTitles.has(n.title.toLowerCase()))];
  const strip = (n: Notice): Notice => ({ ...n, text: undefined });
  const notices = [...cpsc, ...drug, ...food, ...device].map(strip).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { notices, at: new Date().toISOString(), failed };
}

export const latestRecalls = unstable_cache(load, ["latest-recalls-v2"], { revalidate: 3600 });

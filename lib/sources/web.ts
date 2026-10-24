import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Notice } from "../types";
import { clean } from "./http";
import { isListing } from "./listing";

/**
 * Tavily: the web half of the search. The agency APIs trail their own newsrooms by one to six weeks, and some
 * (USDA FSIS) block automated clients, so Tavily searches the official recall sites and manufacturers' recall
 * pages for anything newer, and Extract reads a recall page in full when its model or lot list matters.
 */
const API = "https://api.tavily.com";

export const OFFICIAL_DOMAINS = ["cpsc.gov", "nhtsa.gov", "fda.gov", "fsis.usda.gov", "recalls.gov", "foodsafety.gov"];

const KEYLESS = { "x-tavily-access-mode": "keyless", "content-type": "application/json" };

function headers(): Record<string, string> {
  const key = process.env.TAVILY_API_KEY;
  return key ? { authorization: `Bearer ${key}`, "content-type": "application/json" } : KEYLESS;
}

/**
 * One Tavily call. 429 is the rate limit, 432 and 433 mean the key's plan or pay-as-you-go limit is spent: the
 * demo then falls back to Tavily's keyless mode (slower, smaller quota) rather than lose the web half of a check.
 */
/** Tavily calls inside one sweep or check: basic searches cost a credit each, basic extracts a credit per five URLs. */
export type TavilyTally = { searches: number; extracts: number; extractUrls: number; credits: number };
export const tavilyScope = new AsyncLocalStorage<TavilyTally>();

async function tavily(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const tally = tavilyScope.getStore();
  if (tally) {
    if (path === "/search") {
      tally.searches++;
      tally.credits += body.search_depth === "advanced" ? 2 : 1;
    } else {
      const n = Array.isArray(body.urls) ? body.urls.length : 1;
      tally.extracts++;
      tally.extractUrls += n;
      tally.credits += Math.ceil(n / 5);
    }
  }
  const r = await fetch(`${API}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!process.env.TAVILY_API_KEY || ![429, 432, 433].includes(r.status)) return r;
  console.error(`[tavily] HTTP ${r.status} with the key; retrying keyless`);
  return fetch(`${API}${path}`, { method: "POST", headers: KEYLESS, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
}

const SITE: Record<string, string> = {
  "cpsc.gov": "CPSC newsroom",
  "nhtsa.gov": "NHTSA website",
  "fda.gov": "FDA website",
  "fsis.usda.gov": "USDA FSIS",
};

type SearchResult = { url: string; title: string; content: string; score: number; raw_content?: string | null; published_date?: string };

export type WebQuery = { query: string; domains?: string[]; days?: number; max?: number };

export async function webSearch(q: WebQuery): Promise<{ notices: Notice[]; answerMs: number }> {
  const t = Date.now();
  const body: Record<string, unknown> = {
    query: q.query,
    search_depth: "basic",
    max_results: q.max ?? 6,
    include_domains: q.domains ?? OFFICIAL_DOMAINS,
    include_answer: false,
  };
  if (q.days) body.time_range = q.days <= 7 ? "week" : q.days <= 31 ? "month" : "year";
  const r = await tavily("/search", body, 15_000);
  if (!r.ok) throw new Error(`Tavily search failed (HTTP ${r.status}).`);
  const j = (await r.json()) as { results: SearchResult[] };
  const notices = (j.results ?? [])
    .filter((x) => /recall|alert|warning|safety/i.test(`${x.url} ${x.title}`) && !isListing(x.url))
    .map((x): Notice => {
      const host = new URL(x.url).hostname.replace(/^www\./, "");
      return {
        source: "web",
        id: SITE[host] ?? host,
        title: clean(x.title).replace(/\s*\|\s*[^|]+$/, ""),
        // CPSC's URLs carry its fiscal year, not the date, so a date is only taken when Tavily gives one.
        date: x.published_date ? x.published_date.slice(0, 10) : "",
        url: x.url,
        firm: undefined,
        models: [],
        lots: [],
        upcs: [],
        text: `${clean(x.title)}\n${clean(x.content)}`,
      };
    });
  return { notices, answerMs: Date.now() - t };
}

/** Read whole pages (up to 5) as text, for model and lot lists that the search snippet cut off. */
export async function webExtract(urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!urls.length) return out;
  const r = await tavily("/extract", { urls: urls.slice(0, 5), extract_depth: "basic", format: "text" }, 20_000);
  if (!r.ok) return out;
  const j = (await r.json()) as { results: { url: string; raw_content: string }[] };
  for (const x of j.results ?? []) out.set(x.url, mainText(clean(x.raw_content)));
  return out;
}

/** Where a press release's own text starts: its dateline ("WASHINGTON, Oct. 17, 2026 –") or announcement header. */
const BODY_START = /\b(?:FSIS Announcement|Company Announcement Date|FOR IMMEDIATE RELEASE|[A-Z]{4,}(?:,\s[A-Z][A-Za-z.]+)?,\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s\d{1,2},\s\d{4})/;

/**
 * Up to 16,000 characters of a page, from where its recall text starts. Most recall pages fit whole; some (FSIS
 * pages) print 28,000 characters of menus before the announcement, which a plain cut lost entirely, so a reader saw
 * only navigation. A long page whose dateline sits past the middle of the window is read from a little before the
 * dateline (the recall number, class and title sit just above it).
 */
export function mainText(page: string, max = 16_000): string {
  if (page.length <= max) return page;
  const m = BODY_START.exec(page);
  if (!m || m.index < max / 2) return page.slice(0, max);
  const start = page.lastIndexOf("\n", m.index - 600) + 1;
  return page.slice(start, start + max);
}

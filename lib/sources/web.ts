import "server-only";
import type { Notice } from "../types";
import { clean } from "./http";

/**
 * Tavily: the web half of the search. The agency APIs trail their own newsrooms by one to six weeks, and some
 * (USDA FSIS) block automated clients, so Tavily searches the official recall sites and manufacturers' recall
 * pages for anything newer, and Extract reads a recall page in full when its model or lot list matters.
 */
const API = "https://api.tavily.com";

export const OFFICIAL_DOMAINS = ["cpsc.gov", "nhtsa.gov", "fda.gov", "fsis.usda.gov", "recalls.gov", "foodsafety.gov"];

function headers(): Record<string, string> {
  const key = process.env.TAVILY_API_KEY;
  return key ? { authorization: `Bearer ${key}`, "content-type": "application/json" } : { "x-tavily-access-mode": "keyless", "content-type": "application/json" };
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
  const r = await fetch(`${API}/search`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Tavily search failed (HTTP ${r.status}).`);
  const j = (await r.json()) as { results: SearchResult[] };
  const notices = (j.results ?? [])
    .filter((x) => /recall|alert|warning|safety/i.test(`${x.url} ${x.title}`))
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
  const r = await fetch(`${API}/extract`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ urls: urls.slice(0, 5), extract_depth: "basic", format: "text" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return out;
  const j = (await r.json()) as { results: { url: string; raw_content: string }[] };
  for (const x of j.results ?? []) out.set(x.url, clean(x.raw_content).slice(0, 16_000));
  return out;
}

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Notice } from "../types";
import { noteSpend, tavilyModeNow } from "../budget";
import { clean } from "./http";
import { isListing } from "./listing";
import { PRODUCT_LIST_MARK } from "../match";

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
/** Tavily calls inside one sweep or check, and the credits Tavily bills for them: a basic search is 1 credit
 *  (advanced 2); a basic extract is 1 credit per 5 URLs it read successfully (advanced 2 per 5), so an extract call
 *  of up to five URLs is at most 1 credit, and one that read nothing is free. `extractUrls` counts URLs read. */
export type TavilyTally = { searches: number; extracts: number; extractUrls: number; credits: number };
export const tavilyScope = new AsyncLocalStorage<TavilyTally>();

/** Credits for one call, as Tavily bills it (docs.tavily.com, API credits page, checked Oct 25 2026). */
export function creditsFor(path: string, body: Record<string, unknown>, urlsRead: number): number {
  if (path === "/search") return body.search_depth === "advanced" ? 2 : 1;
  return Math.ceil(urlsRead / 5) * (body.extract_depth === "advanced" ? 2 : 1);
}

function count(path: string, body: Record<string, unknown>, urlsRead: number, keyless = false): void {
  // The demo's daily allowance (lib/budget.ts): credits on the key, calls in keyless mode.
  noteSpend(keyless ? { keyless: 1 } : { credits: creditsFor(path, body, urlsRead) });
  const tally = tavilyScope.getStore();
  if (!tally) return;
  if (path === "/search") tally.searches++;
  else {
    tally.extracts++;
    tally.extractUrls += urlsRead;
  }
  tally.credits += creditsFor(path, body, urlsRead);
}

/** Thrown when today's Tavily allowance (credits on the key, then keyless calls) is spent: the check goes on with
 *  the agency databases only, and its search step says why. */
export class WebAllowanceSpent extends Error {
  constructor() {
    super("today's web-search allowance is spent; the agency databases were searched");
  }
}

/** A Tavily call and whether it went out in keyless mode. */
async function tavily(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<{ r: Response; keyless: boolean }> {
  const mode = await tavilyModeNow();
  if (mode === "off") throw new WebAllowanceSpent();
  const keyed = Boolean(process.env.TAVILY_API_KEY) && mode === "keyed";
  const r = await fetch(`${API}${path}`, { method: "POST", headers: keyed ? headers() : KEYLESS, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!keyed || ![429, 432, 433].includes(r.status)) return { r, keyless: !keyed };
  console.error(`[tavily] HTTP ${r.status} with the key; retrying keyless`);
  return { r: await fetch(`${API}${path}`, { method: "POST", headers: KEYLESS, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }), keyless: true };
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
  const { r, keyless } = await tavily("/search", body, 15_000);
  if (!r.ok) throw new Error(`Tavily search failed (HTTP ${r.status}).`);
  count("/search", body, 0, keyless);
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
  const body = { urls: urls.slice(0, 5), extract_depth: "basic", format: "text" };
  const { r, keyless } = await tavily("/extract", body, 20_000);
  if (!r.ok) return out;
  const j = (await r.json()) as { results: { url: string; raw_content: string }[] };
  count("/extract", body, (j.results ?? []).length, keyless);
  for (const x of j.results ?? []) out.set(x.url, mainText(clean(x.raw_content)));
  // A USDA FSIS recall page names its products only in a linked PDF product list (SKU, UPC, lot, dates,
  // establishment). Tavily Extract reads PDFs, so the list is read too and appended to the page's text.
  await Promise.all(
    [...out].map(async ([url, text]) => {
      const list = await fsisProductList(url, text).catch(() => null);
      if (list) out.set(url, `${text}${PRODUCT_LIST_MARK}${list.url}\n${list.rows}`);
    }),
  );
  return out;
}

/**
 * The product list FSIS links from a recall page, as `Recall_<number>-productlist.pdf` under the site's documents
 * folder, read with Tavily Extract. Its table comes back as one run of text, so it is cut into rows where a row
 * starts (an item number followed by a 10-14 digit UPC): a UPC and a lot then count together only when they share
 * a row (lib/match.ts). Capped at 12,000 characters. Null when the page isn't an FSIS recall or there is no list.
 */
export async function fsisProductList(pageUrl: string, pageText: string): Promise<{ url: string; rows: string } | null> {
  if (!/^https?:\/\/(www\.)?fsis\.usda\.gov\/recalls-alerts\/[^?#]+$/i.test(pageUrl)) return null;
  const id = pageText.match(/\bRecall_(\d{3}-\d{4})\b/)?.[1] ?? pageText.match(/^\s*(\d{3}-\d{4})\s+(?:HIGH|LOW|PUBLIC HEALTH)/im)?.[1];
  if (!id) return null;
  const url = `https://www.fsis.usda.gov/sites/default/files/media_file/documents/Recall_${id}-productlist.pdf`;
  const body = { urls: [url], extract_depth: "basic", format: "text" };
  const { r, keyless } = await tavily("/extract", body, 20_000);
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: { url: string; raw_content: string }[] };
  count("/extract", body, j.results?.length ?? 0, keyless);
  const raw = j.results?.[0]?.raw_content;
  if (!raw || !/\d{10,14}/.test(raw)) return null;
  return { url, rows: productRows(clean(raw)).slice(0, 12_000) };
}

/** One line per product row: a new row starts at a 3-6 digit item number followed by a 10-14 digit UPC. */
export function productRows(text: string): string {
  return text.replace(/\s+(?=\b\d{3,6}\s+\d{10,14}\b)/g, "\n").trim();
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

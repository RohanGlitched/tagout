import "server-only";
import type { Notice } from "../types";
import { clean, getJson } from "./http";

/**
 * U.S. Consumer Product Safety Commission recalls, through SaferProducts.gov's public REST API.
 * Measured quirks: model numbers live only in the Description text (Products[].Model is always empty); a transient
 * error comes back as HTTP 200 with a fake RecallID 0 record and is then cached for that exact URL, so every call
 * carries a cache-buster and retries once on RecallID 0. The API trails the CPSC newsroom by about a week; the
 * RSS feed fills that gap.
 */
const API = "https://www.saferproducts.gov/RestWebServices/Recall";

type Rec = {
  RecallID: number;
  RecallNumber: string;
  RecallDate: string;
  Description: string;
  URL: string;
  Title: string;
  ConsumerContact: string;
  Products: { Name: string; Description: string; Model: string; Type: string; NumberOfUnits: string }[];
  Images: { URL: string; Caption: string }[];
  Manufacturers: { Name: string }[];
  Retailers: { Name: string }[];
  Importers: { Name: string }[];
  ProductUPCs: { UPC: string }[];
  Hazards: { Name: string }[];
  Remedies: { Name: string }[];
  RemedyOptions: { Option: string }[];
};

export type CpscQuery = { product?: string; title?: string; description?: string; manufacturer?: string; since?: string };

async function fetchRecs(params: Record<string, string>): Promise<Rec[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const q = new URLSearchParams({ format: "json", ...params, _: String(Date.now() + attempt) });
    const recs = (await getJson<Rec[]>(`${API}?${q}`, { timeoutMs: 20_000 })) ?? [];
    if (recs.length === 1 && recs[0].RecallID === 0) continue;
    return recs;
  }
  throw new Error("CPSC's recall database didn't answer. Try again in a minute.");
}

/** Recall number as CPSC prints it: "26532" → "26-532". */
export const recallNo = (n: string) => (/^\d{5}$/.test(n) ? `${n.slice(0, 2)}-${n.slice(2)}` : n);

export function toNotice(r: Rec): Notice {
  const units = Number((r.Products?.[0]?.NumberOfUnits ?? "").replace(/,/g, "").match(/\d+/)?.[0] ?? NaN);
  const firm = r.Manufacturers?.[0]?.Name || r.Importers?.[0]?.Name || undefined;
  const captions = (r.Images ?? []).map((i) => clean(i.Caption)).filter(Boolean);
  return {
    source: "cpsc",
    id: recallNo(r.RecallNumber),
    title: clean(r.Title),
    date: r.RecallDate.slice(0, 10),
    url: r.URL,
    firm: firm ? clean(firm) : undefined,
    hazard: clean(r.Hazards?.[0]?.Name),
    remedy: clean(r.Remedies?.[0]?.Name),
    contact: clean(r.ConsumerContact),
    image: r.Images?.[0]?.URL,
    models: [],
    lots: [],
    upcs: (r.ProductUPCs ?? []).map((u) => u.UPC).filter(Boolean),
    units: Number.isFinite(units) ? units : undefined,
    text: [clean(r.Title), ...(r.Products ?? []).map((p) => clean(p.Name)), clean(r.Description), ...captions].join("\n"),
  };
}

/** Search by product name, title words, description text (model numbers) or manufacturer. Newest first. */
export async function searchCpsc(q: CpscQuery, limit = 12): Promise<Notice[]> {
  const params: Record<string, string> = {};
  if (q.product) params.ProductName = q.product;
  if (q.title) params.RecallTitle = q.title;
  if (q.description) params.RecallDescription = q.description;
  if (q.manufacturer) params.Manufacturer = q.manufacturer;
  if (q.since) params.RecallDateStart = q.since;
  if (!Object.keys(params).length) return [];
  const recs = await fetchRecs(params);
  return recs
    .sort((a, b) => b.RecallDate.localeCompare(a.RecallDate))
    .slice(0, limit)
    .map(toNotice);
}

/** Every recall published since a date (for the "Recalls today" board). */
export async function latestCpsc(since: string): Promise<Notice[]> {
  const recs = await fetchRecs({ RecallDateStart: since });
  return recs.sort((a, b) => b.RecallDate.localeCompare(a.RecallDate)).map(toNotice);
}

/**
 * The CPSC newsroom feed: the newest ~40 recalls, often a week ahead of the API. Title and link only, so these
 * become notices without model lists; Tavily Extract can fill in the page when one looks relevant.
 */
export async function cpscFeed(): Promise<Notice[]> {
  const r = await fetch("https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS", { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Tagout/1.0" } });
  if (!r.ok) return [];
  const xml = await r.text();
  const out: Notice[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t: string) => m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const link = tag("link");
    const date = new Date(tag("pubDate"));
    const desc = clean(tag("description").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " "));
    if (!link) continue;
    out.push({
      source: "cpsc",
      id: link.split("/").pop() ?? link,
      title: clean(tag("title")),
      date: Number.isNaN(+date) ? "" : date.toISOString().slice(0, 10),
      url: link,
      models: [],
      lots: [],
      upcs: [],
      text: `${clean(tag("title"))}\n${desc}`,
    });
  }
  return out;
}

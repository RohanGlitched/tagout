import "server-only";
import type { Notice } from "../types";
import { clean, getJson } from "./http";

/**
 * FDA enforcement reports (drugs, food, medical devices) through openFDA. No key: 240 requests a minute and
 * 1,000 a day per IP. "No matches" is a 404, which getJson turns into null. The openfda block (brand, NDC) is
 * empty on many recent records, so NDCs and UPCs are also searched in the description text.
 */
export type FdaKind = "drug" | "food" | "device";

type Rec = {
  recall_number: string;
  event_id: string;
  status: string;
  classification: string;
  product_type: string;
  recalling_firm: string;
  product_description: string;
  product_quantity?: string;
  reason_for_recall: string;
  code_info: string;
  more_code_info?: string;
  distribution_pattern?: string;
  recall_initiation_date: string;
  report_date: string;
  openfda?: { brand_name?: string[]; generic_name?: string[]; package_ndc?: string[]; product_ndc?: string[] };
};

const iso = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);

/** NDCs and UPCs printed in the description: these are the product's identifiers, read without a model. */
export function codesIn(text: string): { ndcs: string[]; upcs: string[] } {
  const ndcs = [...text.matchAll(/\b\d{4,5}-\d{3,4}-\d{1,2}\b/g)].map((m) => m[0]);
  const upcs = [...text.matchAll(/UPC[^0-9]{0,12}((?:\d[\s-]?){11,13})/gi)].map((m) => m[1].replace(/\D/g, ""));
  return { ndcs: [...new Set(ndcs)], upcs: [...new Set(upcs)] };
}

/**
 * Lot numbers from code_info, deterministically: the tokens after "Lot" that contain a digit, minus dates.
 * The model may read more out of unusual layouts; anything it reads is checked against this same text.
 */
export function lotsIn(codeInfo: string): string[] {
  const out: string[] = [];
  for (const m of codeInfo.matchAll(/\b(?:lot|lots|batch)(?:\s*(?:numbers?|nos?\.?|codes?|#))?\s*[:#]?\s*([^;.\n]*?)(?=(?:\b(?:exp|expiry|expiration|best|use by|sell by|upc|ndc)\b)|[;\n]|$)/gi)) {
    for (const tok of m[1].split(/[,\s]+|\band\b/)) {
      const t = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      if (t.length >= 2 && /\d/.test(t) && !/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(t) && !/^(19|20)\d{2}$/.test(t)) out.push(t);
    }
  }
  return [...new Set(out)];
}

export const fdaUrl = (r: { event_id: string }) => `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${r.event_id}`;

function toNotice(r: Rec): Notice {
  const desc = clean(r.product_description);
  const codes = codesIn(`${desc}\n${r.code_info}`);
  // "TYLENOL, Acetaminophen, Extra Strength, 24 Caplets, 500mg each, distributed by..." → the first few parts.
  const parts = desc.split(/,\s*/);
  let short = "";
  for (const p of parts) {
    if (/distributed|manufactured|packed|NDC|UPC|lot/i.test(p) || (short + p).length > 90) break;
    short += (short ? ", " : "") + p;
  }
  short ||= desc.slice(0, 90);
  return {
    source: "fda",
    id: r.recall_number,
    title: short,
    date: iso(r.report_date),
    url: fdaUrl(r),
    firm: clean(r.recalling_firm),
    hazard: `${clean(r.reason_for_recall)}${r.classification ? ` (${r.classification})` : ""}`,
    remedy:
      r.status === "Ongoing"
        ? `Stop using it. Return it to the place of purchase, or ask your pharmacist or ${clean(r.recalling_firm)} about a replacement or refund.`
        : `This recall is ${r.status.toLowerCase()}. Check with the firm if you still have the product.`,
    models: [...codes.ndcs, ...(r.openfda?.package_ndc ?? [])],
    lots: lotsIn(`${r.code_info}\n${r.more_code_info ?? ""}`),
    upcs: codes.upcs,
    category: r.product_type,
    severity: r.classification,
    text: `${desc}\n${clean(r.code_info)}\n${clean(r.more_code_info)}`,
  };
}

export type FdaQuery = { kind: FdaKind; ndc?: string; lot?: string; upc?: string; brand?: string; words?: string; since?: string };

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

/** One openFDA search per identifier we have, in parallel, merged by recall number. Newest first. */
export async function searchFda(q: FdaQuery, limit = 10): Promise<Notice[]> {
  const base = `https://api.fda.gov/${q.kind}/enforcement.json`;
  const searches: string[] = [];
  if (q.ndc) {
    const ndc = q.ndc.trim();
    searches.push(`openfda.package_ndc:${quote(ndc)}`, `product_description:${quote(ndc)}`);
    if (ndc.split("-").length === 3) searches.push(`openfda.product_ndc:${quote(ndc.split("-").slice(0, 2).join("-"))}`);
  }
  if (q.lot) searches.push(`code_info:${quote(q.lot)}`);
  if (q.upc) {
    const u = q.upc.replace(/\D/g, "");
    searches.push(`code_info:${quote(u)}`, `product_description:${quote(u)}`);
  }
  if (q.brand) searches.push(q.kind === "drug" ? `openfda.brand_name:${quote(q.brand)}` : `product_description:${quote(q.brand)}`);
  if (q.words) searches.push(`product_description:${quote(q.words)}`);
  if (!searches.length) return [];
  const since = q.since ? `+AND+report_date:[${q.since.replace(/-/g, "")}+TO+20991231]` : "";
  const results = await Promise.all(
    searches.map((s) =>
      getJson<{ results: Rec[] }>(`${base}?search=${encodeURIComponent(s).replace(/%20/g, "+").replace(/%2B/g, "+")}${since}&sort=report_date:desc&limit=${limit}`, { timeoutMs: 12_000 })
        .then((j) => j?.results ?? [])
        .catch(() => [] as Rec[]),
    ),
  );
  const byId = new Map<string, Rec>();
  for (const r of results.flat()) if (!byId.has(r.recall_number)) byId.set(r.recall_number, r);
  return [...byId.values()]
    .sort((a, b) => b.report_date.localeCompare(a.report_date))
    .slice(0, limit)
    .map(toNotice);
}

/** The newest enforcement reports of a kind (for the "Recalls today" board). */
export async function latestFda(kind: FdaKind, limit = 20): Promise<Notice[]> {
  const j = await getJson<{ results: Rec[] }>(`https://api.fda.gov/${kind}/enforcement.json?sort=report_date:desc&limit=${limit}`, { timeoutMs: 12_000 });
  return (j?.results ?? []).map(toNotice);
}

import "server-only";
import type { Notice } from "../types";
import { clean, getJson } from "./http";
import { joinCodeParts } from "../match";
import { allergenOnly } from "../notice-facts";

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

/** openFDA's keyless limit is per IP, and a serverless host's egress IPs are shared; a free key raises it to 120,000 a day. */
const apiKey = () => (process.env.OPENFDA_API_KEY ? `&api_key=${encodeURIComponent(process.env.OPENFDA_API_KEY)}` : "");

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
    // "Lot 091026 DL - JUN 07 27": the line code "DL" after the number is part of the lot ("091026 DL").
    const toks = joinCodeParts(m[1].split(/[,\s]+|\band\b/).map((tok) => tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")));
    for (const t of toks) {
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
    // An undeclared-allergen food recall ("Product contains undeclared milk"), when that is the only hazard named.
    ...(r.product_type === "Food" && allergenOnly(r.reason_for_recall ?? "") ? { allergen: allergenOnly(r.reason_for_recall ?? "") } : {}),
    severity: r.classification,
    status: r.status,
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
  // The openfda brand block is empty on many recent drug records (Clear Eyes' Sept 2026 recall has none), so the
  // brand is also searched in the description.
  if (q.brand) searches.push(...(q.kind === "drug" ? [`openfda.brand_name:${quote(q.brand)}`] : []), `product_description:${quote(q.brand)}`);
  if (q.words) searches.push(`product_description:${quote(q.words)}`);
  if (!searches.length) return [];
  const since = q.since ? `+AND+report_date:[${q.since.replace(/-/g, "")}+TO+20991231]` : "";
  const results = await Promise.all(
    searches.map((s) =>
      getJson<{ results: Rec[] }>(`${base}?search=${encodeURIComponent(s).replace(/%20/g, "+").replace(/%2B/g, "+")}${since}&sort=report_date:desc&limit=${limit}${apiKey()}`, { timeoutMs: 12_000 })
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

/**
 * Every enforcement report of a kind posted since a date (openFDA's report_date), up to `max`, newest first.
 * openFDA pages at 1,000 a call; a month of device reports is a few hundred.
 */
export async function fdaSince(kind: FdaKind, since: string, max = 2000): Promise<Notice[]> {
  const out: Rec[] = [];
  const q = `report_date:%5B${since.replace(/-/g, "")}+TO+20991231%5D`;
  for (let skip = 0; skip < max; skip += 1000) {
    const j = await getJson<{ results: Rec[]; meta?: { results?: { total?: number } } }>(`https://api.fda.gov/${kind}/enforcement.json?search=${q}&sort=report_date:desc&limit=1000&skip=${skip}${apiKey()}`, { timeoutMs: 20_000 });
    out.push(...(j?.results ?? []));
    if (!j || out.length >= (j.meta?.results?.total ?? 0)) break;
  }
  return out.map(toNotice);
}

/** One enforcement report by its recall number ("D-0121-2026"; F- food, Z- devices): null when openFDA has none. */
export async function fdaByNumber(no: string): Promise<Notice | null> {
  const kind: FdaKind = no.startsWith("F-") ? "food" : no.startsWith("Z-") ? "device" : "drug";
  const j = await getJson<{ results: Rec[] }>(`https://api.fda.gov/${kind}/enforcement.json?search=recall_number:${encodeURIComponent(quote(no))}&limit=1${apiKey()}`, { timeoutMs: 12_000 });
  const rec = j?.results?.find((r) => r.recall_number === no);
  return rec ? toNotice(rec) : null;
}

/** The newest enforcement reports of a kind (for the "Recalls today" board). */
export async function latestFda(kind: FdaKind, limit = 20): Promise<Notice[]> {
  const j = await getJson<{ results: Rec[] }>(`https://api.fda.gov/${kind}/enforcement.json?sort=report_date:desc&limit=${limit}${apiKey()}`, { timeoutMs: 12_000 });
  return (j?.results ?? []).map(toNotice);
}

/** What a per-recall openFDA lookup found: `has` is null when openFDA didn't answer (which says nothing either
 *  way); `searched` are the lookups in words for the tag ("lot 085261: 0 results"). */
export type DbCheck = { has: boolean | null; on: string; searched: string[] };

export type RecallQuery = {
  firm?: string;
  /** The announcement's own date (YYYY-MM-DD), when known. */
  noticeDate?: string;
  lots: string[];
  upcs: string[];
  /** Product words from the announcement's title ("gelato", "hoagie"). */
  nouns: string[];
  kinds?: FdaKind[];
  /** The day of the check (YYYY-MM-DD). */
  today: string;
};

const digits = (s: string) => s.replace(/\D/g, "");
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const back = (iso: string, days: number) => new Date(Date.parse(iso) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Is a firm's enforcement report this recall? It is when it prints one of the announcement's lots or UPCs, or
 * names one of its product words, or was reported (or started) no earlier than a week before the announcement:
 * an older report about other products is another recall (the Lidl cookies of September aren't the gelato of
 * October). Without the announcement's date, any report from the last 30 days counts.
 */
export function sameRecall(r: Pick<Rec, "product_description" | "code_info" | "report_date" | "recall_initiation_date">, q: RecallQuery): boolean {
  const text = `${r.product_description} ${r.code_info}`;
  const hay = squash(text);
  if (q.lots.some((l) => squash(l).length >= 4 && hay.includes(squash(l)))) return true;
  if (q.upcs.some((u) => digits(u).length >= 8 && digits(text).includes(digits(u).replace(/^0+/, "")))) return true;
  const words = ` ${text.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  if (q.nouns.some((w) => w.length >= 4 && new RegExp(` ${w}(e?s)? `).test(words))) return true;
  const from = (q.noticeDate ? back(q.noticeDate, 7) : back(q.today, 30)).replace(/-/g, "");
  return (r.report_date ?? "") >= from || (r.recall_initiation_date ?? "") >= from;
}

/**
 * Does openFDA have an enforcement report for THIS recall yet (not just any report from the firm)? Searches each
 * lot and UPC the announcement prints, then the firm's reports of the last 90 days, each judged by sameRecall.
 * A company announcement with no such report is one only the web search found ("Ahead of the database").
 */
export async function fdaHasRecall(q: RecallQuery): Promise<DbCheck> {
  const kinds = q.kinds?.length ? q.kinds : (["food", "drug", "device"] as FdaKind[]);
  const searched: string[] = [];
  let answered = 0;
  let has = false;
  const ask = async (search: string) => {
    const per = await Promise.all(
      kinds.map((k) =>
        getJson<{ results: Rec[] }>(`https://api.fda.gov/${k}/enforcement.json?search=${encodeURIComponent(search).replace(/%20/g, "+").replace(/%2B/g, "+")}&limit=100${apiKey()}`, { timeoutMs: 12_000 })
          .then((j) => {
            answered++;
            return j?.results ?? [];
          })
          .catch(() => null),
      ),
    );
    return per.some((x) => x !== null) ? per.flatMap((x) => x ?? []) : null;
  };
  const codes = [...q.lots.slice(0, 2).map((c) => ({ what: "lot", c })), ...q.upcs.slice(0, 2).map((c) => ({ what: "UPC", c }))];
  for (const { what, c } of codes) {
    const fields = what === "UPC" ? [`code_info:${quote(c)}`, `product_description:${quote(c)}`] : [`code_info:${quote(c)}`];
    const hits = await Promise.all(fields.map(ask));
    if (hits.every((h) => h === null)) continue;
    const n = new Set(hits.flatMap((h) => h ?? []).map((r) => r.recall_number)).size;
    if (n) has = true;
    searched.push(`${what} ${c}: ${n ? `${n} ${n === 1 ? "report" : "reports"}` : "0 results"}`);
  }
  if (q.firm) {
    const since = back(q.noticeDate ?? q.today, 90).replace(/-/g, "");
    const recs = await ask(`recalling_firm:${quote(q.firm)}+AND+report_date:[${since}+TO+20991231]`);
    if (recs) {
      const same = recs.filter((r) => sameRecall(r, q));
      if (same.length) has = true;
      searched.push(
        recs.length
          ? same.length
            ? `${q.firm}: ${same.length} matching ${same.length === 1 ? "report" : "reports"}`
            : `${q.firm}: ${recs.length} other ${recs.length === 1 ? "report" : "reports"}, none for this product`
          : `${q.firm}: no reports in 90 days`,
      );
    }
  }
  return { has: answered ? has : null, on: q.today, searched };
}

import type { Item, Notice, TagLevel } from "../types";
import { brandIn, distinctive, norm, normBrand, printedIn, splitIds } from "../match";

/**
 * The inverted index the daily sweep matches new recalls against: every brand and every printed code of every
 * watched thing, pointing back at the watches that hold it. A new recall is looked up by the words of its firm,
 * title and product lines and by the codes in its text, so matching costs one pass over the recall, however
 * many households are watched. Nothing here calls a model or the network.
 */

/** One watched thing, as the newest finished check of its watch read it. */
export type Watched = {
  watchId: string;
  /** The same thing across checks: its kind and its own words. */
  key: string;
  item: Item;
  checkId?: string;
  /** When that check finished (ISO). */
  checkedAt: string;
  /** Its tag in that check. */
  level?: TagLevel;
  /** Recalls the watch already knows about for this thing (noticeKeys of the check's cited notices and of
   *  earlier sweep events): never reported as new. */
  known: Set<string>;
};

export const itemKey = (i: Item) => `${i.kind}:${normBrand(i.said)}`;

/** A recall's names: agency and number, and for CPSC and web pages the link and title, so a CPSC newsroom page
 *  found on the web and the database record of the same recall are known as one. */
export function noticeKeys(n: Pick<Notice, "source" | "id" | "url" | "title">): string[] {
  const keys: string[] = [];
  if (n.source !== "web") keys.push(`${n.source}:${n.id}`.toLowerCase());
  // FDA links name the recall event, which covers several recall numbers (one per product), so only CPSC and web
  // pages are known by their link.
  if (n.url && (n.source === "cpsc" || n.source === "web")) keys.push(`url:${n.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/#.*$/, "").replace(/\/+$/, "")}`);
  if (n.title && (n.source === "cpsc" || n.source === "web")) keys.push(`title:${normBrand(n.title.replace(/\s\|.*$/, ""))}`);
  return keys;
}

export const noticeKey = (n: Pick<Notice, "source" | "id" | "url" | "title">) => noticeKeys(n)[0];

/** Brand keys: the brand's words, the same run together ("Baby Trend", "babytrend"), and a long first word. */
export function brandKeys(brand: string | undefined): string[] {
  if (!brand) return [];
  const b = normBrand(brand);
  if (b.length < 3) return [];
  const keys = [b, b.replace(/ /g, "")];
  const first = b.split(" ")[0];
  if (b.includes(" ") && first.length >= 6) keys.push(first);
  return [...new Set(keys)];
}

/** A code as the index keys it: normalised, and an all-digit code (a UPC) without its leading zeros. */
const codeKey = (c: string) => {
  const n = norm(c);
  return /^\d+$/.test(n) ? n.replace(/^0+/, "") : n;
};

/** The item's printed codes worth indexing: four characters or more with a digit (a short or wordy code would
 *  turn up in unrelated recalls by chance). */
export function itemCodes(item: Item): string[] {
  const raw = [item.model, item.lot, item.upc, item.ndc, item.serial, ...(item.codes ?? [])].filter((c): c is string => Boolean(c));
  const all = [...raw, ...raw.flatMap((c) => splitIds(c, false))];
  return [...new Set(all.filter((c) => norm(c).length >= 4 && /\d/.test(norm(c))))];
}

export type VehicleQuery = { make: string; model: string; year: number; entries: Watched[] };
export type SeatQuery = { brand: string; entries: Watched[] };

export type WatchIndex = {
  entries: Watched[];
  brands: Map<string, Watched[]>;
  codes: Map<string, Watched[]>;
  /** NHTSA has no "published since" feed, so each distinct watched vehicle and car-seat brand is asked once a day. */
  vehicles: Map<string, VehicleQuery>;
  seats: Map<string, SeatQuery>;
};

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const l = m.get(k);
  if (l) {
    if (!l.includes(v)) l.push(v);
  } else m.set(k, [v]);
};

export function buildIndex(entries: Watched[]): WatchIndex {
  const idx: WatchIndex = { entries, brands: new Map(), codes: new Map(), vehicles: new Map(), seats: new Map() };
  for (const e of entries) {
    const it = e.item;
    for (const k of brandKeys(it.brand)) push(idx.brands, k, e);
    for (const c of itemCodes(it)) push(idx.codes, codeKey(c), e);
    if (it.kind === "vehicle" && it.brand && it.product && it.year) {
      const k = `${normBrand(it.brand)}|${norm(it.product)}|${it.year}`;
      const q = idx.vehicles.get(k) ?? { make: it.brand, model: it.product, year: it.year, entries: [] };
      q.entries.push(e);
      idx.vehicles.set(k, q);
    }
    if (it.kind === "car-seat" && it.brand && brandKeys(it.brand).length) {
      const k = normBrand(it.brand);
      const q = idx.seats.get(k) ?? { brand: it.brand, entries: [] };
      q.entries.push(e);
      idx.seats.set(k, q);
    }
  }
  return idx;
}

const firstChunk = (n: Notice) => (n.text ?? "").slice(0, 600);

/** The words a recall names its maker and product by: firm, title, vehicle make, product lines, and for FDA and
 *  web notices the start of the text (openFDA's brand often sits only in the product description). */
function nameHay(n: Notice): string {
  return normBrand([n.firm, n.title, n.make, ...n.models, n.source === "fda" || n.source === "web" ? firstChunk(n) : ""].filter(Boolean).join(" "));
}

/** Every watched thing whose brand or printed code appears in this recall (before the relevance rules). */
export function lookup(idx: WatchIndex, n: Notice): Watched[] {
  const hits = new Set<Watched>();
  const words = nameHay(n).split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= 4 && i + k <= words.length; k++) {
      const g = words.slice(i, i + k);
      for (const key of new Set([g.join(" "), g.join("")])) for (const e of idx.brands.get(key) ?? []) hits.add(e);
    }
  }
  const tokens = new Set([...(n.text ?? "").split(/[^A-Za-z0-9./+-]+/), ...n.models, ...n.lots, ...n.upcs].map(codeKey).filter((t) => t.length >= 4));
  for (const t of tokens) for (const e of idx.codes.get(t) ?? []) hits.add(e);
  return [...hits];
}

/** Could a recall of this agency (and FDA category) cover this kind of thing at all? */
export function kindFits(kind: Item["kind"], n: Notice): boolean {
  const cat = (n.category ?? "").toLowerCase();
  switch (kind) {
    case "vehicle":
      return n.source === "nhtsa" && Boolean(n.vehicleModel);
    case "car-seat":
      return (n.source === "nhtsa" && !n.vehicleModel) || n.source === "cpsc" || n.source === "web";
    case "product":
      return n.source === "cpsc" || n.source === "web";
    case "drug":
      return (n.source === "fda" && (!cat || cat.startsWith("drug"))) || n.source === "web";
    case "food":
      return (n.source === "fda" && (!cat || cat.startsWith("food"))) || n.source === "web" || n.source === "fsis";
    case "device":
      return (n.source === "fda" && (!cat || cat.startsWith("device"))) || n.source === "web";
  }
}

export function brandFits(brand: string | undefined, n: Notice): boolean {
  if (!brand) return false;
  if (brandIn(brand, n)) return true;
  if (n.source !== "fda" && n.source !== "web") return false;
  const keys = brandKeys(brand);
  return keys.length > 0 && ` ${normBrand(firstChunk(n))} `.includes(` ${normBrand(brand)} `);
}

const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");

/**
 * Is the recall about the same kind of product, not just the same brand? With no agent in the loop, a Vornado
 * steamer recall must not tag a Vornado heater: a word of the item's product (or of its own words, less the
 * brand) has to appear in the recall's title or the start of its text. A child-seat campaign fits a car seat.
 */
export function productFits(item: Item, n: Notice): boolean {
  if (item.kind === "vehicle") return true;
  if (item.kind === "car-seat" && n.source === "nhtsa" && /^\d{2}C\d{3}000$/.test(n.id)) return true;
  const brandWords = new Set(normBrand(item.brand ?? "").split(" "));
  const own = normBrand(item.product || item.said)
    .split(" ")
    .filter((w) => w.length >= 3 && !brandWords.has(w) && !/^(model|type|lot|the|and|with|for|my|our)$/.test(w))
    .map(stem);
  if (!own.length) return false;
  const hay = new Set(normBrand(`${n.title} ${firstChunk(n)}`).split(" ").map(stem));
  return own.some((w) => hay.has(w));
}

const listed = (c: string, n: Notice) => {
  const k = codeKey(c);
  return [...n.models, ...n.lots, ...n.upcs].some((x) => codeKey(x) === k);
};

/**
 * Why this recall could be about this watched thing, or null: one of the thing's own codes is printed in it (from
 * the same brand, or a code distinctive enough that finding it elsewhere isn't chance), or it is the same brand
 * and the same kind of product. Only then is the recall read and matched.
 */
export function relevant(e: Watched, n: Notice): "code" | "brand" | null {
  if (!kindFits(e.item.kind, n)) return null;
  const brand = brandFits(e.item.brand, n);
  if (itemCodes(e.item).some((c) => (printedIn(c, n.text) || listed(c, n)) && (brand || distinctive(c)))) return "code";
  if (!brand) return null;
  return productFits(e.item, n) ? "brand" : null;
}

/** Recalls dated this long before a thing's last check may still be news: the agency databases trail their
 *  newsrooms by one to three weeks, so a check can miss a recall that was already announced. */
export const LAG_DAYS = 21;

export function newToWatch(e: Watched, n: Notice): boolean {
  if (noticeKeys(n).some((k) => e.known.has(k))) return false;
  if (!n.date) return true;
  const cutoff = new Date(Date.parse(e.checkedAt) - LAG_DAYS * 86_400_000).toISOString().slice(0, 10);
  return n.date >= cutoff;
}

/** The watched things a recall should be read and matched for. */
export function candidates(idx: WatchIndex, n: Notice): { entry: Watched; why: "code" | "brand" }[] {
  const out: { entry: Watched; why: "code" | "brand" }[] = [];
  for (const entry of lookup(idx, n)) {
    if (!newToWatch(entry, n)) continue;
    const why = relevant(entry, n);
    if (why) out.push({ entry, why });
  }
  return out;
}

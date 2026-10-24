import "server-only";
import type { Notice } from "../types";
import { docKey, readDoc, sha256, writeDoc } from "../docs";
import { looksLikeCode, norm } from "../match";
import { MODELS, structured } from "../nebius";
import { storage } from "../storage";
import { webExtract } from "../sources/web";

/**
 * Reads the affected model numbers, lots, UPCs and manufacture-date windows out of a notice's own wording.
 * CPSC prints model numbers only in prose, NHTSA in its summaries, so a model reads them. Then every code the
 * model returns is checked against the notice text, character for character after normalisation; a code that
 * isn't there is struck and never reaches the matcher.
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    models: { type: "array", items: { type: "string" }, description: "affected model numbers, TYPE codes, item or style numbers, exactly as printed" },
    lots: { type: "array", items: { type: "string" }, description: "affected lot, batch, serial or date codes, exactly as printed; a range as 'A through B'" },
    upcs: { type: "array", items: { type: "string" } },
    made_from: { type: ["string", "null"], description: "first affected manufacture date, YYYY-MM-DD, only if the notice gives a window" },
    made_to: { type: ["string", "null"], description: "last affected manufacture date, YYYY-MM-DD" },
    where_to_look: { type: ["string", "null"], description: "where the deciding code is printed on the product, in the notice's words, short" },
    announced: { type: ["string", "null"], description: "the date the recall was announced, YYYY-MM-DD, only if the notice states it" },
  },
  required: ["models", "lots", "upcs", "made_from", "made_to", "where_to_look", "announced"],
};

type Read = { models: string[]; lots: string[]; upcs: string[]; made_from: string | null; made_to: string | null; where_to_look: string | null; announced: string | null };

const SYSTEM = `You read one official recall notice and list exactly which units it covers.
Copy codes EXACTLY as printed (model numbers, TYPE codes, item/style numbers, lot or batch numbers, serial or date-code ranges, UPCs). Never invent, complete or reformat a code. Leave lists empty when the notice names no codes (for example when every unit of a product is recalled).
Only give made_from/made_to when the notice states a manufacture date window. where_to_look: where the notice says the code is printed (e.g. "silver rating label on the bottom"), else null.`;

/**
 * `model` is the model whose reading was used; `cached` when that reading came from the read cache instead of a
 * call; `failed` when a model was asked and none answered (the item can't be cleared against this notice);
 * `deferred` when the reading was neither cached nor allowed this time (the sweep's per-run cap).
 */
export type ReadResult = { notice: Notice; struck: string[]; model?: string; cached?: boolean; failed?: boolean; deferred?: boolean };

const OFFICIAL = /(^|\.)(cpsc|nhtsa|fda|fsis\.usda|recalls)\.gov$/;

/**
 * The read cache: one document per (source, recall number, hash of the exact text read, model), so a notice is
 * read once and every later check or sweep that meets the same wording reuses the reading. Only the model's raw
 * answer is kept; the strike-against-the-text step runs again on every use. Active when a store is configured,
 * or with TAGOUT_READ_CACHE=local (files under .data/); TAGOUT_READ_CACHE=off turns it off. The eval harness
 * runs without a store, so its replays are unchanged.
 */
const PROMPT_VERSION = "r1";
const cacheOn = () => process.env.TAGOUT_READ_CACHE !== "off" && (storage() !== null || process.env.TAGOUT_READ_CACHE === "local");

export const textHash = (n: Pick<Notice, "title">, text: string) => sha256(`${n.title}\n${text}`);
const readKey = (n: Notice, hash: string, model: string) => docKey(`reads/${sha256([PROMPT_VERSION, n.source, n.id, hash, model].join("|")).slice(0, 40)}.json`);

type Cached = { v: 1; source: string; id: string; textHash: string; model: string; at: string; data: Read };

/** A cached reading by any model at least as good as the chain's: the full reader's models first, so a lite
 *  check or the sweep reuses an Ultra reading when one exists. */
async function cachedRead(n: Notice, hash: string, chain: string[]): Promise<Cached | null> {
  if (!cacheOn()) return null;
  const models = [...new Set([...MODELS.reader, ...chain])];
  const hits = await Promise.all(models.map((m) => readDoc<Cached>(readKey(n, hash, m)).catch(() => null)));
  return hits.find((h) => h?.value.data)?.value ?? null;
}

async function saveRead(n: Notice, hash: string, model: string, data: Read): Promise<void> {
  if (!cacheOn()) return;
  const doc: Cached = { v: 1, source: n.source, id: n.id, textHash: hash, model, at: new Date().toISOString(), data };
  await writeDoc(readKey(n, hash, model), doc).catch((e) => console.error("[read] cache write failed", (e as Error).message));
}

/** Web pages already fetched in one batch (fillWebText), so readNotice doesn't fetch them again one by one. */
const prefetched = new WeakSet<Notice>();
const needsPage = (n: Notice) => n.source === "web" && (n.text?.length ?? 0) < 1500 && !prefetched.has(n);

/** Reads every short web result's page in as few Tavily Extract calls as possible (five URLs a call). */
export async function fillWebText(notices: Notice[]): Promise<void> {
  const want = notices.filter(needsPage);
  const urls = [...new Set(want.map((n) => n.url))];
  const pages = new Map<string, string>();
  for (let i = 0; i < urls.length; i += 5) {
    const got = await webExtract(urls.slice(i, i + 5)).catch(() => new Map<string, string>());
    for (const [u, t] of got) pages.set(u, t);
  }
  for (const n of want) {
    const page = pages.get(n.url);
    if (page) n.text = `${n.title}\n${page}`;
    prefetched.add(n);
  }
}

export async function readNotice(n: Notice, useModel: boolean, chain: string[] = MODELS.reader, opts: { allowFresh?: boolean } = {}): Promise<ReadResult> {
  // A web result's snippet is too short to list models; read the page first when it's an official or maker site.
  if (needsPage(n)) {
    const page = (await webExtract([n.url]).catch(() => new Map<string, string>())).get(n.url);
    if (page) n.text = `${n.title}\n${page}`;
    prefetched.add(n);
  }
  const text = (n.text ?? "").slice(0, 12_000);
  if (!useModel || !text || n.vehicleModel) return { notice: n, struck: [] };

  const hash = textHash(n, text);
  let r: { data: Read; model: string };
  let cached = false;
  const hit = await cachedRead(n, hash, chain).catch(() => null);
  if (hit) {
    r = { data: hit.data, model: hit.model };
    cached = true;
  } else if (opts.allowFresh === false) {
    return { notice: n, struck: [], deferred: true };
  } else {
    try {
      r = await structured<Read>(chain, {
        name: "notice",
        schema: SCHEMA,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Recall ${n.id}: ${n.title}\n\n${text}` },
        ],
        maxTokens: 1500,
        timeoutMs: 25_000,
      });
    } catch {
      return { notice: n, struck: [], failed: true };
    }
    await saveRead(n, hash, r.model, r.data);
  }
  try {
    const hay = norm(text);
    const struck: string[] = [];
    const keep = (codes: string[]) =>
      codes.filter((c) => {
        // "A through B": both ends must be printed.
        const ends = c.split(/\s+(?:through|thru|to)\s+|\s*[–—]\s*/i);
        const ok = ends.every((e) => norm(e).length >= 2 && hay.includes(norm(e)));
        if (!ok && looksLikeCode(c)) struck.push(c); // junk (paths, prose) is dropped without a mention
        return ok;
      });
    const models = keep(r.data.models);
    const lots = keep(r.data.lots);
    const upcs = keep(r.data.upcs);
    const inText = (d: string | null) => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d) && text.includes(d.slice(0, 4)));
    // A window can be open at one end ("made before July 2023"); readers also answer "July 2023" for a date.
    const from = isoDay(r.data.made_from, "start"), to = isoDay(r.data.made_to, "end");
    const range = (from || to) && (!from || inText(from)) && (!to || inText(to)) ? [{ from: from ?? "1900-01-01", to: to ?? "2999-12-31" }] : undefined;
    return {
      notice: {
        ...n,
        models: [...new Set([...n.models, ...models])],
        lots: [...new Set([...n.lots, ...lots])],
        upcs: [...new Set([...n.upcs, ...upcs])],
        madeRanges: range ?? n.madeRanges,
        whereToLook: r.data.where_to_look || n.whereToLook,
        // A web page often has no date in its metadata; take the announcement date when its year is in the text.
        date: n.date || (inText(r.data.announced) ? r.data.announced! : ""),
      },
      struck,
      model: r.model,
      cached,
    };
  } catch {
    return { notice: n, struck: [], failed: true };
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2023-07-14", "July 2023", "07/2023" or "2023-07" as an ISO day; a month alone is its first or last day. */
export function isoDay(d: string | null, side: "start" | "end"): string | null {
  if (!d) return null;
  const t = d.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let y: number | undefined, mo: number | undefined;
  let m = t.match(/^([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (m) {
    mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    y = Number(m[2]);
  } else if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) {
    y = Number(m[1]);
    mo = Number(m[2]);
  } else if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) {
    y = Number(m[2]);
    mo = Number(m[1]);
  }
  if (!y || !mo || mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, "0")}-${side === "start" ? "01" : String(last).padStart(2, "0")}`;
}

export const isOfficial = (url: string) => {
  try {
    return OFFICIAL.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
};

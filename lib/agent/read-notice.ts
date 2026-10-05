import "server-only";
import type { Notice } from "../types";
import { norm } from "../match";
import { MODELS, structured } from "../nebius";
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
  },
  required: ["models", "lots", "upcs", "made_from", "made_to", "where_to_look"],
};

type Read = { models: string[]; lots: string[]; upcs: string[]; made_from: string | null; made_to: string | null; where_to_look: string | null };

const SYSTEM = `You read one official recall notice and list exactly which units it covers.
Copy codes EXACTLY as printed (model numbers, TYPE codes, item/style numbers, lot or batch numbers, serial or date-code ranges, UPCs). Never invent, complete or reformat a code. Leave lists empty when the notice names no codes (for example when every unit of a product is recalled).
Only give made_from/made_to when the notice states a manufacture date window. where_to_look: where the notice says the code is printed (e.g. "silver rating label on the bottom"), else null.`;

export type ReadResult = { notice: Notice; struck: string[]; model?: string };

const OFFICIAL = /(^|\.)(cpsc|nhtsa|fda|fsis\.usda|recalls)\.gov$/;

export async function readNotice(n: Notice, useModel: boolean): Promise<ReadResult> {
  // A web result's snippet is too short to list models; read the page first when it's an official or maker site.
  if (n.source === "web" && (n.text?.length ?? 0) < 1500) {
    const page = (await webExtract([n.url]).catch(() => new Map<string, string>())).get(n.url);
    if (page) n.text = `${n.title}\n${page}`;
  }
  const text = (n.text ?? "").slice(0, 12_000);
  if (!useModel || !text || n.vehicleModel) return { notice: n, struck: [] };

  try {
    const r = await structured<Read>(MODELS.reader, {
      name: "notice",
      schema: SCHEMA,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Recall ${n.id}: ${n.title}\n\n${text}` },
      ],
      maxTokens: 1500,
      timeoutMs: 25_000,
    });
    const hay = norm(text);
    const struck: string[] = [];
    const keep = (codes: string[]) =>
      codes.filter((c) => {
        // "A through B": both ends must be printed.
        const ends = c.split(/\s+(?:through|thru|to)\s+|\s*[–—]\s*/i);
        const ok = ends.every((e) => norm(e).length >= 2 && hay.includes(norm(e)));
        if (!ok) struck.push(c);
        return ok;
      });
    const models = keep(r.data.models);
    const lots = keep(r.data.lots);
    const upcs = keep(r.data.upcs);
    const inText = (d: string | null) => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d) && text.includes(d.slice(0, 4)));
    const range = inText(r.data.made_from) && inText(r.data.made_to) ? [{ from: r.data.made_from!, to: r.data.made_to! }] : undefined;
    return {
      notice: {
        ...n,
        models: [...new Set([...n.models, ...models])],
        lots: [...new Set([...n.lots, ...lots])],
        upcs: [...new Set([...n.upcs, ...upcs])],
        madeRanges: range ?? n.madeRanges,
        whereToLook: r.data.where_to_look || n.whereToLook,
      },
      struck,
      model: r.model,
    };
  } catch {
    return { notice: n, struck: [] };
  }
}

export const isOfficial = (url: string) => {
  try {
    return OFFICIAL.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
};

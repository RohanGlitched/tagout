import "server-only";
import type { Item, ItemKind } from "../types";
import { norm } from "../match";
import { MODELS, structured, type Msg } from "../nebius";
import { decodeVin } from "../sources/nhtsa";

/**
 * Turns what a person typed (one thing per line) and any label photos into items. Nemotron reads the text; a
 * vision model reads photos. Identifiers are then checked against what was typed: a model, lot, VIN, UPC or NDC
 * that doesn't appear in the person's own line is dropped, so the reader can't invent the code a match turns on.
 */

const nul = (t: string) => ({ type: [t, "null"] });
const ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    line: { type: "integer", description: "1-based input line this item came from (0 for a photo)" },
    kind: { type: "string", enum: ["vehicle", "car-seat", "product", "drug", "food", "device"] },
    said: { type: "string", description: "The person's words for it, tidied (for a photo: what the label is on)" },
    brand: nul("string"),
    product: nul("string"),
    model: nul("string"),
    lot: nul("string"),
    vin: nul("string"),
    year: nul("integer"),
    made: nul("string"),
    upc: nul("string"),
    ndc: nul("string"),
    serial: nul("string"),
    codes: { type: "array", items: { type: "string" } },
  },
  required: ["line", "kind", "said", "brand", "product", "model", "lot", "vin", "year", "made", "upc", "ndc", "serial", "codes"],
};
const SCHEMA = { type: "object", additionalProperties: false, properties: { items: { type: "array", items: ITEM } }, required: ["items"] };

type Raw = { line: number; kind: ItemKind; said: string; brand: string | null; product: string | null; model: string | null; lot: string | null; vin: string | null; year: number | null; made: string | null; upc: string | null; ndc: string | null; serial: string | null; codes: string[] };

const SYSTEM = `You turn a household's list of things they own into structured items for a product-recall check.
Rules:
- One item per thing. Skip lines that aren't a product someone owns.
- kind: vehicle (cars, trucks, motorcycles, RVs), car-seat (child car seats and boosters), product (any consumer product: cribs, strollers, heaters, chargers, toys, appliances, e-bikes, furniture), drug (medicines, prescription or over the counter), food (food, drinks, baby formula, dietary supplements, pet food), device (medical devices: CPAP, glucose meters, insulin pumps).
- brand is the maker or brand name. product is the product name without the brand (for vehicles: the model name, e.g. "CR-V").
- Copy identifiers EXACTLY as written, character for character: model (model number), lot (lot or batch), vin, upc, ndc, serial. Never guess or complete one. If none was written, use null.
- year: a vehicle's model year, or null. made: a date of manufacture or date code if written.
- codes: any other printed code the person gave (a TYPE, style or item number), copied exactly.
- said: the person's own words for the item, tidied to read well.`;

const VISION = `Read this product label photo for a recall check. Return one item.
Copy every printed identifier EXACTLY, character for character: model or model number, TYPE, lot or batch, serial, VIN, UPC (the digits under the barcode), NDC, date code or date of manufacture, expiry. Use null for anything not printed. Never guess a character you can't read; leave the field null instead.
codes: any other printed code (TYPE, style, item number). said: a short plain description, e.g. "Vornado heater (from a photo)".`;

/** Each identifier must be in the line the person typed (ignoring case, spaces and dashes). */
function keepTyped(raw: Raw, lines: string[]): Raw {
  const src = norm(lines[raw.line - 1] ?? lines.join(" "));
  const ok = (v: string | null) => (v && norm(v).length >= 2 && src.includes(norm(v)) ? v.trim() : null);
  return { ...raw, model: ok(raw.model), lot: ok(raw.lot), vin: ok(raw.vin), upc: ok(raw.upc), ndc: ok(raw.ndc), serial: ok(raw.serial), codes: raw.codes.filter((c) => ok(c)) };
}

function toItem(raw: Raw, idx: number, readFrom: Item["readFrom"]): Item {
  const v = (s: string | null) => (s && s.trim() ? s.trim() : undefined);
  return {
    id: `i${idx + 1}`,
    kind: raw.kind,
    said: raw.said.trim() || [raw.brand, raw.product].filter(Boolean).join(" "),
    brand: v(raw.brand),
    product: v(raw.product),
    model: v(raw.model),
    lot: v(raw.lot),
    vin: v(raw.vin)?.toUpperCase(),
    year: raw.year ?? undefined,
    made: v(raw.made),
    upc: v(raw.upc),
    ndc: v(raw.ndc),
    serial: v(raw.serial),
    codes: raw.codes.length ? raw.codes : undefined,
    readFrom,
  };
}

/** Decode any VIN and fill in make, model and year from NHTSA's decoder. */
async function withVin(item: Item): Promise<Item> {
  if (!item.vin) return item;
  const d = await decodeVin(item.vin).catch(() => null);
  if (!d) return item;
  const cap = (s: string) => (s === s.toUpperCase() && s.length > 3 ? s[0] + s.slice(1).toLowerCase() : s);
  return { ...item, kind: "vehicle", brand: cap(d.make), product: d.model, year: d.year, readFrom: item.readFrom === "photo" ? "photo" : "vin" };
}

export type Intake = { items: Item[]; model?: string; visionModel?: string; dropped: number };

export async function readItems(text: string, photos: string[], useModel: boolean): Promise<Intake> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
  let raws: Raw[] = [];
  let model: string | undefined;
  let dropped = 0;

  if (lines.length) {
    if (useModel) {
      try {
        const r = await structured<{ items: Raw[] }>(MODELS.reader, {
          name: "items",
          schema: SCHEMA,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: lines.map((l, i) => `${i + 1}. ${l}`).join("\n") },
          ],
          timeoutMs: 25_000,
        });
        model = r.model;
        raws = r.data.items.map((x) => {
          const kept = keepTyped(x, lines);
          dropped += [x.model, x.lot, x.vin, x.upc, x.ndc].filter(Boolean).length - [kept.model, kept.lot, kept.vin, kept.upc, kept.ndc].filter(Boolean).length;
          return kept;
        });
      } catch {
        raws = lines.map((l, i) => parseLine(l, i + 1));
      }
    } else {
      raws = lines.map((l, i) => parseLine(l, i + 1));
    }
  }

  let visionModel: string | undefined;
  const photoRaws: Raw[] = [];
  if (photos.length && useModel) {
    const results = await Promise.all(
      photos.slice(0, 3).map((url) =>
        structured<{ items: Raw[] }>(MODELS.vision, {
          name: "items",
          schema: SCHEMA,
          messages: [{ role: "user", content: [{ type: "text", text: VISION }, { type: "image_url", image_url: { url } }] }] as Msg[],
          timeoutMs: 40_000,
        }).catch(() => null),
      ),
    );
    for (const r of results) {
      if (!r?.data.items[0]) continue;
      visionModel = r.model;
      photoRaws.push({ ...r.data.items[0], line: 0 });
    }
  }

  const items = await Promise.all([...raws.map((r, i) => toItem(r, i, "typed")), ...photoRaws.map((r, i) => toItem(r, raws.length + i, "photo"))].map(withVin));
  return { items: items.slice(0, 10), model, visionModel, dropped };
}

// The fixed reader for when the model is unavailable or the day's budget is spent: obvious patterns only.
const MAKES = ["acura", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy", "chrysler", "dodge", "ford", "gmc", "honda", "hyundai", "infiniti", "jeep", "kia", "lexus", "lincoln", "mazda", "mercedes-benz", "mitsubishi", "nissan", "ram", "subaru", "tesla", "toyota", "volkswagen", "vw", "volvo", "rivian"];

export function parseLine(line: string, n: number): Raw {
  const l = line.trim();
  const low = l.toLowerCase();
  const vin = l.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] ?? null;
  const year = Number(l.match(/\b(19[89]\d|20[0-3]\d)\b/)?.[1]) || null;
  const model = l.match(/\bmodel(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*([A-Z0-9][A-Z0-9-./]{2,})/i)?.[1] ?? null;
  const lot = l.match(/\b(?:lot|batch)(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{1,})/i)?.[1] ?? null;
  const upc = l.match(/\bupc\s*[:#]?\s*(\d[\d ]{10,14}\d)/i)?.[1]?.replace(/\s/g, "") ?? null;
  const ndc = l.match(/\b\d{4,5}-\d{3,4}-\d{1,2}\b/)?.[0] ?? null;
  const make = MAKES.find((m) => new RegExp(`\\b${m}\\b`).test(low));
  let kind: ItemKind = "product";
  if (vin || (make && year)) kind = "vehicle";
  else if (/car seat|booster|infant seat|snugride|keyfit/.test(low)) kind = "car-seat";
  else if (/tablet|caplet|capsule|syrup|suspension|ibuprofen|acetaminophen|tylenol|advil|motrin|medicine|mg\b|ndc|eye drops|inhaler/.test(low)) kind = "drug";
  else if (/formula|cereal|cheese|meat|chicken|beef|salad|snack|juice|milk|butter|food|supplement|cookie|bar\b/.test(low)) kind = "food";
  else if (/cpap|glucose|insulin|pump|monitor|thermometer|catheter/.test(low)) kind = "device";
  const words = l.replace(/\b(model|lot|batch|upc|vin)\b.*$/i, "").replace(/[,;]+$/, "").trim();
  const brand = kind === "vehicle" ? (make ? make[0].toUpperCase() + make.slice(1) : null) : words.split(/\s+/)[0] ?? null;
  const product = kind === "vehicle" && make ? words.replace(new RegExp(`.*\\b${make}\\b\\s*`, "i"), "").split(/[,;]/)[0].trim() || null : words.split(/\s+/).slice(1).join(" ") || null;
  return { line: n, kind, said: l, brand, product, model, lot, vin, year, made: null, upc, ndc, serial: null, codes: [] };
}

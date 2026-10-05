import "server-only";
import type { Item, Notice, Source } from "../types";
import { brandIn, norm, normBrand } from "../match";
import { chat, MODELS, parseJson, type Msg, type ToolDef } from "../nebius";
import { searchCpsc } from "../sources/cpsc";
import { childSeatRecalls, vehicleRecalls } from "../sources/nhtsa";
import { searchFda, type FdaKind } from "../sources/fda";
import { webExtract, webSearch, OFFICIAL_DOMAINS } from "../sources/web";

/**
 * The search half of a check, for one item. Nemotron plans it: it chooses which agency databases to query and
 * with what words, reads what comes back, searches again with better terms, reads recall pages in full through
 * Tavily when a snippet isn't enough, and finishes by naming the notices that are about this product. Every
 * tool runs on the server against the agencies' public APIs; the model only sees compact results.
 */

export type Step = { itemId: string; tool: string; label: string; found: number; ms: number; source: Source; error?: string };

export type Investigation = { notices: Notice[]; searched: Source[]; steps: Step[]; model?: string; planned: "model" | "fixed" };

const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties: props, required });
const str = (description: string) => ({ type: "string", description });

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_vehicle_recalls",
      description: "NHTSA vehicle recalls for a make, model and model year.",
      parameters: S({ make: str("e.g. Honda"), model: str("e.g. CR-V"), year: { type: "integer" } }, ["make", "model", "year"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_car_seat_recalls",
      description: "NHTSA child car seat recalls. Searches brand and model names (not model numbers). Try the brand alone if brand + model finds nothing.",
      parameters: S({ query: str("brand, or brand and model name, e.g. 'Graco SnugRide'") }, ["query"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_cpsc",
      description:
        "U.S. Consumer Product Safety Commission recalls (consumer products: heaters, cribs, strollers, chargers, toys, furniture, appliances). Give one or more fields; each is a contains-match. Model numbers only appear in the description text.",
      parameters: S({
        product: str("product type words as CPSC would name it, e.g. 'tower heater', 'bassinet'"),
        title: str("words in the recall title, usually the brand, e.g. 'Vornado'"),
        description: str("an exact model number or code to find in the recall description, e.g. 'SRTH'"),
        manufacturer: str("manufacturer name"),
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "search_fda",
      description: "FDA enforcement reports: drugs, food (including supplements, formula, pet food) and medical devices. Search by NDC, lot, UPC, brand, or product words.",
      parameters: S({ kind: { type: "string", enum: ["drug", "food", "device"] }, ndc: str("NDC as printed"), lot: str("lot number as printed"), upc: str("UPC digits"), brand: str("brand name"), words: str("product words, e.g. 'peanut butter'") }, ["kind"]),
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Tavily web search, limited to official recall sites (cpsc.gov, nhtsa.gov, fda.gov, fsis.usda.gov) unless you add the manufacturer's domain. Use it for recalls newer than the agency databases (they trail by 1-6 weeks), for meat and poultry (USDA FSIS), and for manufacturer recall pages.",
      parameters: S({ query: str("e.g. 'Vornado heater recall'"), extra_domain: str("optional manufacturer domain, e.g. 'gracobaby.com'"), recent_days: { type: "integer", description: "optional: only pages from the last N days" } }, ["query"]),
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Read a recall page in full (Tavily Extract) when a result looks relevant but its model or lot list isn't in the snippet. Pass the result's ref.",
      parameters: S({ ref: str("a result ref like R3") }, ["ref"]),
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Finish: list the results that could cover THIS product: the same kind of product from the same brand or maker. If the item's model or lot is unknown, include every recall of that kind of product from that brand (the matcher will ask for the label). Leave out other kinds of product, even from the same brand. An empty list means nothing relevant was found.",
      parameters: S(
        {
          relevant: { type: "array", items: S({ ref: str("result ref"), reason: str("why it's about this product, one short clause") }, ["ref", "reason"]) },
        },
        ["relevant"],
      ),
    },
  },
];

const SYSTEM = `You are the search agent in Tagout, a product-recall checker. For one item a household owns, find every official recall that could cover it.
How to work:
- Search the right database first: vehicles → search_vehicle_recalls; child car seats → search_car_seat_recalls; consumer products → search_cpsc; medicines, food, supplements, medical devices → search_fda. Meat and poultry → search_web (USDA FSIS).
- If the first search finds nothing useful, search again with different words: the brand alone in the title, the product type, the model code in the description, a synonym CPSC would use.
- Always run one search_web too, to catch recalls newer than the databases.
- Use read_page when a relevant result's snippet doesn't show which models, lots or dates are affected.
- Then call finish with the results that could cover this product: same kind of product, same brand. Brand alone is not enough: a recall of a Vornado garment steamer is not about a Vornado heater. But when the person didn't give a model or lot, keep every recall of that kind of product from that brand: you are not deciding whether their unit is covered.
- Make several tool calls at once when they're independent. Stop after at most 4 rounds of searching.
- Stay on this item: search its own brand, maker and product only. Never search other brands or similar products.
- Never decide whether the person's exact unit is affected: a separate matcher compares model and lot numbers.`;

type Pool = Map<string, Notice>;

function label(tool: string, a: Record<string, unknown>): { text: string; source: Source } {
  const q = (v: unknown) => `“${String(v)}”`;
  switch (tool) {
    case "search_vehicle_recalls":
      return { text: `NHTSA vehicle recalls for ${a.year} ${a.make} ${a.model}`, source: "nhtsa" };
    case "search_car_seat_recalls":
      return { text: `NHTSA car seat recalls for ${q(a.query)}`, source: "nhtsa" };
    case "search_cpsc": {
      const parts = [a.title && `title ${q(a.title)}`, a.product && `product ${q(a.product)}`, a.description && `text ${q(a.description)}`, a.manufacturer && `maker ${q(a.manufacturer)}`].filter(Boolean);
      return { text: `CPSC recalls, ${parts.join(", ")}`, source: "cpsc" };
    }
    case "search_fda": {
      const parts = [a.ndc && `NDC ${a.ndc}`, a.lot && `lot ${a.lot}`, a.upc && `UPC ${a.upc}`, a.brand && `brand ${q(a.brand)}`, a.words && q(a.words)].filter(Boolean);
      return { text: `FDA ${a.kind} recalls, ${parts.join(", ")}`, source: "fda" };
    }
    case "search_web":
      return { text: `Tavily web search ${q(a.query)}${a.extra_domain ? ` (+${a.extra_domain})` : ""}`, source: "web" };
    case "read_page":
      return { text: `Tavily read the page “${String(a.title ?? a.ref)}”`, source: "web" };
    default:
      return { text: tool, source: "web" };
  }
}

/** Codes from the item worth flagging when a result's text contains them. */
function itemCodes(item: Item): string[] {
  return [item.model, item.lot, item.upc, item.ndc, ...(item.codes ?? [])].filter((c): c is string => Boolean(c && norm(c).length >= 3));
}

function compact(n: Notice, ref: string, item: Item) {
  const hay = norm(n.text ?? "");
  const mentions = itemCodes(item).filter((c) => hay.includes(norm(c)));
  return {
    ref,
    source: n.source,
    number: n.id,
    date: n.date || undefined,
    title: n.title,
    snippet: (n.text ?? "").replace(/\s+/g, " ").slice(0, 420),
    ...(mentions.length ? { mentions_your_code: mentions } : {}),
  };
}

async function runTool(tool: string, a: Record<string, unknown>, item: Item, pool: Pool): Promise<{ notices: Notice[]; note?: string }> {
  switch (tool) {
    case "search_vehicle_recalls":
      return { notices: await vehicleRecalls(String(a.make), String(a.model), Number(a.year)) };
    case "search_car_seat_recalls":
      return { notices: await childSeatRecalls(String(a.query)) };
    case "search_cpsc": {
      const q = {
        product: (a.product as string) || undefined,
        title: (a.title as string) || undefined,
        description: (a.description as string) || undefined,
        manufacturer: (a.manufacturer as string) || undefined,
      };
      const notices = await searchCpsc(q);
      const fields = Object.entries(q).filter(([, v]) => v);
      if (notices.length || fields.length < 2) return { notices };
      // CPSC's filters are ANDed and its product names are its own ("tower heaters", not "space heater"):
      // when the combination finds nothing, try each field alone and say so.
      const alone = await Promise.all(fields.map(([k, v]) => searchCpsc({ [k]: v }).catch(() => [] as Notice[])));
      const seen = new Set<string>();
      const merged = alone.flat().filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
      return { notices: merged, note: "Nothing matched all the fields together, so each field was searched on its own." };
    }
    case "search_fda":
      return {
        notices: await searchFda({
          kind: (a.kind as FdaKind) ?? "drug",
          ndc: (a.ndc as string) || undefined,
          lot: (a.lot as string) || undefined,
          upc: (a.upc as string) || undefined,
          brand: (a.brand as string) || undefined,
          words: (a.words as string) || undefined,
        }),
      };
    case "search_web": {
      const extra = typeof a.extra_domain === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(a.extra_domain) ? [a.extra_domain] : [];
      const { notices } = await webSearch({ query: String(a.query), domains: [...OFFICIAL_DOMAINS, ...extra], days: typeof a.recent_days === "number" ? a.recent_days : undefined });
      // Results already found through an agency API are the same recall; keep the API's copy.
      const known = new Set([...pool.values()].map((n) => n.url.toLowerCase()));
      return { notices: await officialCopies(notices.filter((n) => !known.has(n.url.toLowerCase()))) };
    }
    case "read_page": {
      const n = findRef(pool, a.ref);
      if (!n) return { notices: [], note: "No result has that ref." };
      const pages = await webExtract([n.url]);
      const text = pages.get(n.url);
      if (!text) return { notices: [], note: "The page couldn't be read." };
      n.text = `${n.title}\n${text}`;
      const hay = norm(text);
      const mentions = itemCodes(item).filter((c) => hay.includes(norm(c)));
      return { notices: [], note: `Read ${text.length} characters of ${n.url}.${mentions.length ? ` It mentions ${mentions.join(", ")}.` : ""} Excerpt: ${text.replace(/\s+/g, " ").slice(0, 900)}` };
    }
  }
  return { notices: [], note: "Unknown tool." };
}

/** A result by its ref ("R3"), or by its URL when the model passes that instead. */
function findRef(pool: Pool, ref: unknown): Notice | undefined {
  const r = String(ref ?? "");
  return pool.get(r) ?? [...pool.values()].find((n) => n.url === r);
}

/**
 * A cpsc.gov recall page found on the web is usually also in CPSC's database, which carries the recall number,
 * date, hazard and photo: swap in that record when the titles match. Newsroom pages the database hasn't caught
 * up with stay as web results.
 */
async function officialCopies(notices: Notice[]): Promise<Notice[]> {
  return Promise.all(
    notices.map(async (n) => {
      if (!/cpsc\.gov\/Recalls\//i.test(n.url)) return n;
      const words = n.title.split(/\s+/).slice(0, 6).join(" ");
      const hits = await searchCpsc({ title: words }, 5).catch(() => [] as Notice[]);
      const same = hits.find((h) => h.title.toLowerCase() === n.title.toLowerCase() || h.url.toLowerCase() === n.url.toLowerCase());
      return same ?? n;
    }),
  );
}

/**
 * Kept whatever the model chose:
 * - results whose text contains one of the item's own codes;
 * - for vehicles, NHTSA recalls already filtered to the item's make, model and year;
 * - for car seats, NHTSA child-seat campaigns (numbers ending C…000) from the item's brand.
 * The model narrows what's left; it can't drop a recall these rules say could cover the item.
 */
function mustKeep(item: Item, pool: Pool): Notice[] {
  const codes = itemCodes(item).map(norm).filter((c) => c.length >= 4);
  return [...pool.values()].filter((n) => {
    if (item.kind === "vehicle" && n.vehicleModel) return true;
    if (item.kind === "car-seat" && n.source === "nhtsa" && /^\d{2}C\d{3}000$/.test(n.id) && brandIn(item.brand, n)) return true;
    if (!codes.length) return false;
    const hay = norm(n.text ?? "");
    return codes.some((c) => hay.includes(c));
  });
}

export async function investigate(item: Item, useModel: boolean, onStep: (s: Step) => void): Promise<Investigation> {
  const pool: Pool = new Map();
  const steps: Step[] = [];
  const searched = new Set<Source>();
  let refN = 0;

  const exec = async (tool: string, args: Record<string, unknown>) => {
    const t = Date.now();
    const page = tool === "read_page" ? findRef(pool, args.ref) : undefined;
    const { text, source } = label(tool, page ? { ...args, title: page.title.length > 70 ? `${page.title.slice(0, 68).trimEnd()}…` : page.title } : args);
    try {
      const r = await runTool(tool, args, item, pool);
      const refs: ReturnType<typeof compact>[] = [];
      for (const n of r.notices.slice(0, 10)) {
        const dup = [...pool.entries()].find(([, p]) => p.source === n.source && p.id === n.id && p.url === n.url);
        const ref = dup?.[0] ?? `R${++refN}`;
        if (!dup) pool.set(ref, n);
        refs.push(compact(dup?.[1] ?? n, ref, item));
      }
      if (tool !== "read_page") searched.add(source);
      const step: Step = { itemId: item.id, tool, label: text, found: r.notices.length, ms: Date.now() - t, source };
      steps.push(step);
      onStep(step);
      return JSON.stringify(r.note && !refs.length ? { note: r.note } : { found: r.notices.length, results: refs, ...(r.note ? { note: r.note } : {}) });
    } catch (e) {
      const step: Step = { itemId: item.id, tool, label: text, found: 0, ms: Date.now() - t, source, error: (e as Error).message };
      steps.push(step);
      onStep(step);
      return JSON.stringify({ error: (e as Error).message });
    }
  };

  if (useModel) {
    try {
      const messages: Msg[] = [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}. Item:\n${JSON.stringify(item)}` },
      ];
      let model: string | undefined;
      for (let round = 0; round < 6; round++) {
        const last = round === 5;
        const r = await chat(MODELS.agent, { messages, tools: TOOLS, tool_choice: last ? { type: "function", function: { name: "finish" } } : "auto", max_tokens: 1800 }, 45_000);
        model = r.model;
        const calls = r.toolCalls;
        messages.push({ role: "assistant", content: r.content || null, tool_calls: calls.length ? calls : undefined });
        if (!calls.length) {
          // A plain answer instead of a tool call: ask once more for finish.
          messages.push({ role: "user", content: "Call finish with the relevant result refs." });
          continue;
        }
        const finish = calls.find((c) => c.function.name === "finish");
        if (finish) {
          const { relevant } = parseJson<{ relevant: { ref: string; reason: string }[] }>(finish.function.arguments || "{}");
          const chosen = (relevant ?? []).map((x) => pool.get(x.ref)).filter((n): n is Notice => Boolean(n));
          // The agency database that covers this kind of item is always searched, even if the agent didn't.
          for (const [tool, args] of fixedPlan(item)) {
            if (tool !== "search_web" && !steps.some((s) => s.tool === tool && !s.error)) await exec(tool, args);
          }
          const notices = newestFirst([...new Set([...chosen, ...mustKeep(item, pool)])]).slice(0, 8);
          return { notices, searched: [...searched], steps, model, planned: "model" };
        }
        const outs = await Promise.all(calls.map((c) => exec(c.function.name, safeArgs(c.function.arguments))));
        calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: outs[i] }));
      }
    } catch (e) {
      console.error("[agent] falling back to the fixed plan:", (e as Error).message);
    }
  }

  // The fixed plan: the same tools in a set order, with brand and code matching for relevance.
  for (const [tool, args] of fixedPlan(item)) await exec(tool, args);
  const byBrand = [...pool.values()].filter((n) => (item.kind === "vehicle" ? true : brandIn(item.brand, n) || productWords(item, n)));
  const notices = newestFirst([...new Set([...mustKeep(item, pool), ...byBrand])]).slice(0, 8);
  return { notices, searched: [...searched], steps, planned: "fixed" };
}

const newestFirst = (ns: Notice[]) => [...ns].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

function safeArgs(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function productWords(item: Item, n: Notice): boolean {
  if (!item.product || !item.brand) return false;
  const words = normBrand(item.product).split(" ").filter((w) => w.length > 3);
  const hay = normBrand(n.title);
  return brandIn(item.brand, n) && words.some((w) => hay.includes(w));
}

export function fixedPlan(item: Item): [string, Record<string, unknown>][] {
  const name = [item.brand, item.product].filter(Boolean).join(" ") || item.said;
  const web: [string, Record<string, unknown>] = ["search_web", { query: `${name} recall` }];
  switch (item.kind) {
    case "vehicle":
      return item.brand && item.product && item.year ? [["search_vehicle_recalls", { make: item.brand, model: item.product, year: item.year }], web] : [web];
    case "car-seat":
      return [["search_car_seat_recalls", { query: item.brand ?? item.said }], web];
    case "drug":
    case "food":
    case "device":
      return [["search_fda", { kind: item.kind, ndc: item.ndc, lot: item.lot, upc: item.upc, brand: item.brand }], web];
    default:
      return [
        ["search_cpsc", item.brand ? { title: item.brand } : { product: item.product ?? item.said }],
        ...(item.model ? ([["search_cpsc", { description: item.model }]] as [string, Record<string, unknown>][]) : []),
        web,
      ];
  }
}


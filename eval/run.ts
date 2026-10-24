// Runs one arm of the eval over a cases file and writes <results dir>/<arm>.json.
// Usage: npx tsx --conditions=react-server eval/run.ts <arm> [--cases cases.json] [--results results]
//          [--only p01,n04] [--limit 10] [--cap 3] [--concurrency 3] [--today 2026-10-15]
//          [--offline] [--no-web] [--keyless] [--tavily-cap 450]
//
// Every HTTP response (agency APIs, Tavily, Token Factory) is cached on disk under eval/.cache (or $EVAL_CACHE),
// keyed by the exact request, so arms see the same data and a re-run costs nothing. Real Token Factory spend is
// kept in a ledger and the run refuses new model calls once this run has spent --cap dollars (default 1).
// --offline   never touches the network: a request that isn't cached fails (as an unreachable API would) and is
//             counted per case as a cache miss, so a replay says exactly which cases it could not reproduce.
// --no-web    Tavily is switched off: every web search and page read answers with no results, so the agent and
//             the fixed plan see only the agency databases. The results file is <arm>-noweb.json.
// --keyless   Tavily runs in its keyless mode (no credits; an hourly cap the run waits out); --tavily-cap stops
//             keyed Tavily calls at a credit count (default 450).
// --today     the date the agent is told (pinned so a later replay asks the same question).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const EVAL = path.join(ROOT, "eval");
const CACHE_ROOT = process.env.EVAL_CACHE ? path.resolve(process.env.EVAL_CACHE) : path.join(EVAL, ".cache");
const CACHE = path.join(CACHE_ROOT, "http");
const LEDGER = path.join(CACHE_ROOT, "spend.json");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OFFLINE = args.includes("--offline");
const NOWEB = args.includes("--no-web");
if (!OFFLINE) {
  for (const f of [path.join(ROOT, ".env.local"), path.join(ROOT, "..", ".env.keys"), ...(process.env.EVAL_ENV ? process.env.EVAL_ENV.split(",") : [])]) {
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = l.match(/^(\w+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
    }
  }
} else {
  // A replay needs no keys: nothing leaves the machine.
  process.env.NEBIUS_API_KEY = "offline-replay";
  delete process.env.TAVILY_API_KEY;
  delete process.env.OPENFDA_API_KEY;
}
const KEYLESS = args.includes("--keyless");
if (KEYLESS) delete process.env.TAVILY_API_KEY;
// The agent is told the date; pinning it keeps a replay on a later day a cache hit.
process.env.TAGOUT_TODAY = flag("today") ?? process.env.TAGOUT_TODAY ?? "2026-10-15";

/** $ per million tokens, from Token Factory's /v1/models on Oct 15 2026 (Super VL from its catalog on Oct 25). */
export const PRICES: Record<string, [number, number]> = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": [1, 3],
  "nvidia/nemotron-3-super-120b-a12b": [0.3, 0.9],
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": [0.06, 0.24],
  "nvidia/Nemotron-3.5-Super-VL": [0.3, 0.9],
};
const ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

type Call = { model: string; prompt: number; completion: number; cached: boolean; ms: number };
type Ctx = { calls: Call[]; tavily: number; cachedTavily: number; search: number; extract: number; webBlocked: number; misses: string[] };
const caseCtx = new AsyncLocalStorage<Ctx>();

/** Dollars this run may spend on Token Factory (the ledger keeps the running total across runs). */
const CAP = Number(flag("cap") ?? 1);
type Ledger = { total: number; calls: number; byModel: Record<string, number>; tavilyLive: number; tavilyKeyed?: number };
const ledger: Ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { total: 0, calls: 0, byModel: {}, tavilyLive: 0 };
const startSpend = ledger.total;
const TAVILY_CAP = Number(flag("tavily-cap") ?? 450);
const saveLedger = () => {
  if (OFFLINE) return;
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
};
const cost = (model: string, p: number, c: number) => {
  const key = Object.keys(PRICES).find((k) => k.toLowerCase() === model.toLowerCase());
  const [a, b] = key ? PRICES[key] : [1, 3];
  return (p * a + c * b) / 1e6;
};

/**
 * The cache key: method, URL and body. CPSC calls carry a cache-buster, and the "has openFDA heard of this firm
 * lately" check asks from a date 90 days before the wall clock, so both are taken out of the key: the same
 * question on a later day replays the answer recorded on the day of the run.
 */
export function cacheKey(method: string, url: string, body: string): string {
  const keyUrl = url
    .replace(/([?&])_=\d+&?/, "$1")
    .replace(/[?&]$/, "")
    .replace(/(recalling_firm(?:%3A|:).*?report_date(?:%3A|:)(?:%5B|\[))\d{8}(\+TO\+20991231)/i, "$1SINCE$2");
  return crypto.createHash("sha256").update(`${method} ${keyUrl} ${body}`).digest("hex");
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const key = cacheKey(method, url, body);
  const file = path.join(CACHE, key.slice(0, 2), `${key}.json`);
  const tf = url.includes("tokenfactory.nebius.com");
  const tv = url.includes("api.tavily.com");
  const ctx = caseCtx.getStore();
  const model = tf ? (JSON.parse(body || "{}").model as string) : "";

  if (tv && NOWEB) {
    // Tavily switched off: the web half finds nothing (the same as a search with no results).
    if (ctx) ctx.webBlocked++;
    return new Response(JSON.stringify({ results: [], response_time: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (tv && ctx) {
    if (url.includes("/extract")) ctx.extract++;
    else ctx.search++;
  }
  if (fs.existsSync(file)) {
    const hit = JSON.parse(fs.readFileSync(file, "utf8")) as { status: number; type: string; body: string; ms?: number };
    if (tf && ctx) {
      const u = JSON.parse(hit.body).usage ?? {};
      ctx.calls.push({ model, prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cached: true, ms: hit.ms ?? 0 });
    }
    if (tv && ctx) ctx.cachedTavily++;
    return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type } });
  }
  if (OFFLINE) {
    const host = new URL(url).hostname;
    ctx?.misses.push(tf ? `${host} ${model}` : `${host} ${new URL(url).pathname}`);
    if (process.env.EVAL_DEBUG) console.error(`[miss] ${method} ${url.slice(0, 300)}`);
    throw new Error(`not cached: ${url.slice(0, 120)}`);
  }
  if (tf && ledger.total - startSpend >= CAP) throw new Error(`run budget of $${CAP} reached`);
  const keyed = tv && /authorization/i.test(JSON.stringify(init?.headers ?? {}));
  if (keyed && (ledger.tavilyKeyed ?? 0) >= TAVILY_CAP) throw new Error(`eval Tavily cap of ${TAVILY_CAP} credits reached`);

  const t0 = Date.now();
  let r: Response | null = null;
  for (let i = 0; i < 60; i++) {
    r = await realFetch(input, init);
    if (!(tv && r.status === 429) && !(tf && r.status === 429)) break;
    if (tf && i >= 4) break;
    // Keyless Tavily answers 429 with an hourly cap and a Retry-After: wait it out rather than record a failure.
    const wait = tv ? Math.max(20, Number(r.headers.get("retry-after") ?? 0)) * 1000 : 2000 * 2 ** i;
    if (tv) console.error(`[eval] Tavily 429, waiting ${wait / 1000}s`);
    await new Promise((res) => setTimeout(res, wait));
  }
  const text = await r!.text();
  const ms = Date.now() - t0;
  const type = r!.headers.get("content-type") ?? "application/json";
  const keep = r!.ok || (r!.status === 400 && url.includes("api.nhtsa.gov")) || (r!.status === 404 && url.includes("api.fda.gov"));
  if (keep) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ status: r!.status, type, body: text, ms }));
  }
  if (tf && r!.ok) {
    const u = JSON.parse(text).usage ?? {};
    const c = cost(model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0);
    ledger.total += c;
    ledger.calls++;
    ledger.byModel[model] = (ledger.byModel[model] ?? 0) + c;
    saveLedger();
    ctx?.calls.push({ model, prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cached: false, ms });
  }
  if (tv) {
    ledger.tavilyLive++;
    if (keyed && r!.ok) ledger.tavilyKeyed = (ledger.tavilyKeyed ?? 0) + 1;
    if (!r!.ok) console.error(`[eval] Tavily HTTP ${r!.status}: ${text.slice(0, 160)}`);
    saveLedger();
    if (ctx) ctx.tavily++;
  }
  return new Response(text, { status: r!.status, headers: { "content-type": type } });
}) as typeof fetch;

const { runCheck } = await import("../lib/agent/run.ts");
const { MODELS, structured } = await import("../lib/nebius.ts");
const { webSearch, OFFICIAL_DOMAINS } = await import("../lib/sources/web.ts");
const { readItems } = await import("../lib/agent/intake.ts");

type Case = { id: string; group: string; text: string; expect: string; recall?: string[]; photo?: string; set?: string; form?: string };
const casesFile = path.resolve(EVAL, flag("cases") ?? "cases.json");
const { cases } = JSON.parse(fs.readFileSync(casesFile, "utf8")) as { cases: Case[] };

type Arm =
  | { kind: "pipeline"; intake: string[]; agent: string[]; reader: string[]; useAgent: boolean; useModel: boolean; label: string }
  | { kind: "ask"; model: string; search: boolean; label: string }
  | { kind: "intake"; model: string; label: string };
const P = (intake: string, agent: string, reader: string, label: string, useAgent = true, useModel = true): Arm => ({ kind: "pipeline", intake: [intake], agent: [agent], reader: [reader], useAgent, useModel, label });
const ARMS: Record<string, Arm> = {
  tagout: P(ULTRA, ULTRA, ULTRA, "Tagout: Ultra reads the list, runs the agent and reads the notices; rules decide"),
  "fixed-plan": P(ULTRA, ULTRA, ULTRA, "Fixed search plan instead of the agent; Ultra readers; rules decide", false),
  "fixed-plan-nano": P(ULTRA, ULTRA, NANO, "Fixed search plan instead of the agent; Ultra list reader, Nano notice reader; rules decide", false),
  rules: P(ULTRA, ULTRA, ULTRA, "No model at all: fixed plan, pattern reader, rules", false, false),
  "alone-ultra": { kind: "ask", model: ULTRA, search: false, label: "Nemotron 3 Ultra alone, no tools" },
  "search-ultra": { kind: "ask", model: ULTRA, search: true, label: "Nemotron 3 Ultra reading Tavily results, no rules" },
  // Notice reader swapped, everything before it held at Ultra (the agent's calls replay from the cache).
  "super-readers": P(ULTRA, ULTRA, SUPER, "Ultra list reader and agent, Super notice reader"),
  "nano-readers": P(ULTRA, ULTRA, NANO, "Ultra list reader and agent, Nano notice reader"),
  // Search agent swapped (list and notice readers held at Ultra).
  "super-agent": P(ULTRA, SUPER, ULTRA, "Super search agent, Ultra readers"),
  "nano-agent": P(ULTRA, NANO, ULTRA, "Nano search agent, Ultra readers"),
  // List reader alone, compared with Ultra's items field by field.
  "intake-super": { kind: "intake", model: SUPER, label: "Super reading the list" },
  "intake-nano": { kind: "intake", model: NANO, label: "Nano reading the list" },
  "intake-ultra": { kind: "intake", model: ULTRA, label: "Ultra reading the list" },
};

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["recalled", "check", "not_recalled"] },
    recall: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["status", "recall", "reason"],
};
const ASK = `You check whether something a household owns is covered by a U.S. product recall (CPSC, FDA, NHTSA or USDA).
Answer "recalled" only if you are confident this exact unit is covered: its model, lot or code is listed in a recall. Answer "check" if the product line has a recall but you can't tell whether this unit is covered. Answer "not_recalled" if no recall you know of covers it. Give the recall number if you know it.`;

async function ask(arm: Extract<Arm, { kind: "ask" }>, c: Case) {
  let context = "";
  if (arm.search) {
    const { notices } = await webSearch({ query: `${c.text} recall`, domains: OFFICIAL_DOMAINS, max: 5 }).catch(() => ({ notices: [] }));
    context = notices.length ? `\n\nWeb search results (Tavily, official recall sites):\n${notices.map((n, i) => `[${i + 1}] ${n.url}\n${(n.text ?? "").replace(/\s+/g, " ").slice(0, 700)}`).join("\n\n")}` : "\n\nWeb search found nothing.";
  }
  const r = await structured<{ status: string; recall: string | null; reason: string }>([arm.model], {
    name: "answer",
    schema: ASK_SCHEMA,
    messages: [
      { role: "system", content: ASK },
      { role: "user", content: `Today is ${process.env.TAGOUT_TODAY}. The household owns: "${c.text}".${context}` },
    ],
    maxTokens: 2500,
    timeoutMs: 60_000,
  });
  const level = r.data.status === "recalled" ? "danger" : r.data.status === "check" ? "warning" : "inspected";
  return { level, notice: r.data.recall ?? undefined, reason: r.data.reason };
}

/** The list reader on its own: the items it reads from one line, for comparison with Ultra's. */
async function intakeOnly(c: Case) {
  const r = await readItems(c.text, [], true);
  const it = r.items[0];
  return { level: "n/a", model: r.model, item: it ? { kind: it.kind, brand: it.brand, product: it.product, model: it.model, lot: it.lot, upc: it.upc, year: it.year, codes: it.codes, made: it.made } : null };
}

/** A case's label photo as the data URL the app sends (paths are relative to eval/). */
function photosOf(c: Case): string[] {
  if (!c.photo) return [];
  const file = path.resolve(EVAL, c.photo);
  const mime = file.endsWith(".png") ? "png" : file.endsWith(".webp") ? "webp" : "jpeg";
  return [`data:image/${mime};base64,${fs.readFileSync(file).toString("base64")}`];
}

async function pipeline(arm: Extract<Arm, { kind: "pipeline" }>, c: Case) {
  let level: string | undefined, notice: string | undefined, headline: string | undefined, engine: unknown, error: string | undefined;
  let planned: string | undefined;
  const steps: { tool: string; label: string; found: number; fresh?: number; error?: string }[] = [];
  let items: unknown;
  for await (const e of runCheck({ text: c.text, photos: photosOf(c) }, arm.useModel, { agent: arm.useAgent })) {
    if (e.t === "items") items = e.items.map((it) => ({ kind: it.kind, brand: it.brand, product: it.product, model: it.model, lot: it.lot, upc: it.upc, codes: it.codes, made: it.made, readFrom: it.readFrom }));
    else if (e.t === "verdict") {
      level = e.verdict.level;
      notice = e.verdict.notice ? `${e.verdict.notice.source.toUpperCase()} ${e.verdict.notice.id}` : undefined;
      headline = e.verdict.headline;
      planned = e.planned;
    } else if (e.t === "step") steps.push({ tool: e.step.tool, label: e.step.label, found: e.step.found, fresh: e.step.fresh, ...(e.step.error ? { error: e.step.error } : {}) });
    else if (e.t === "done") engine = e.engine;
    else if (e.t === "error") error = e.message;
  }
  return { level: level ?? "error", notice, headline, planned, engine, error, items, steps };
}

const name = args[0];
const arm = ARMS[name];
if (!arm) throw new Error(`Unknown arm. One of: ${Object.keys(ARMS).join(", ")}`);
if (arm.kind === "pipeline") {
  MODELS.agent.splice(0, MODELS.agent.length, ...arm.agent);
  MODELS.reader.splice(0, MODELS.reader.length, ...arm.reader);
  MODELS.intake.splice(0, MODELS.intake.length, ...arm.intake);
}
if (arm.kind === "intake") {
  MODELS.intake.splice(0, MODELS.intake.length, arm.model);
}
const only = flag("only")?.split(",");
const limit = Number(flag("limit") ?? Infinity);
const todo = cases.filter((c) => !only || only.includes(c.id)).slice(0, limit);
const outName = `${name}${NOWEB ? "-noweb" : ""}`;
const outFile = path.join(EVAL, flag("results") ?? "results", `${outName}.json`);
const prev = fs.existsSync(outFile) ? (JSON.parse(fs.readFileSync(outFile, "utf8")) as { cases: Record<string, unknown>[] }) : { cases: [] };
const byId = new Map(prev.cases.map((r) => [r.id as string, r]));
const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
};
const code = { commit: git("rev-parse --short HEAD"), libChanged: Boolean(git("status --porcelain -- lib")) };

let i = 0;
const worker = async () => {
  while (i < todo.length) {
    const c = todo[i++];
    if (!OFFLINE && ledger.total - startSpend >= CAP) {
      console.log(`stop: run budget $${CAP} reached`);
      return;
    }
    const ctx: Ctx = { calls: [], tavily: 0, cachedTavily: 0, search: 0, extract: 0, webBlocked: 0, misses: [] };
    const t0 = Date.now();
    const out = await caseCtx.run(ctx, async () => (arm.kind === "ask" ? ask(arm, c) : arm.kind === "intake" ? intakeOnly(c) : pipeline(arm, c))).catch((e: Error) => ({ level: "error", error: e.message }));
    const ms = Date.now() - t0;
    const tokens = ctx.calls.reduce((a, x) => ({ prompt: a.prompt + x.prompt, completion: a.completion + x.completion }), { prompt: 0, completion: 0 });
    const usd = ctx.calls.reduce((a, x) => a + cost(x.model, x.prompt, x.completion), 0);
    const fresh = ctx.calls.every((x) => !x.cached);
    const old = byId.get(c.id) as { ms?: number; msFresh?: boolean } | undefined;
    const row = {
      id: c.id,
      group: c.group,
      ...(c.set ? { set: c.set } : {}),
      ...(c.form ? { form: c.form } : {}),
      expect: c.expect,
      ...out,
      calls: ctx.calls.length,
      liveCalls: ctx.calls.filter((x) => !x.cached).length,
      tokens,
      usd: Number(usd.toFixed(5)),
      // Latency is only meaningful when nothing came from the cache; keep the first uncached time.
      ms: fresh || !old?.msFresh ? ms : old.ms,
      msFresh: fresh || Boolean(old?.msFresh),
      tavily: ctx.tavily + ctx.cachedTavily,
      tavilySearch: ctx.search,
      tavilyExtract: ctx.extract,
      ...(NOWEB ? { webBlocked: ctx.webBlocked } : {}),
      ...(OFFLINE ? { cacheMisses: ctx.misses.length, missed: [...new Set(ctx.misses)].slice(0, 6) } : {}),
    };
    byId.set(c.id, row);
    console.log(c.id.padEnd(4), String(row.level).padEnd(9), "want", c.expect.padEnd(10), (row as { notice?: string }).notice ?? "", `$${row.usd.toFixed(4)}`, `${ms}ms`, OFFLINE ? `misses ${ctx.misses.length}` : "", (row as { error?: string }).error ?? "");
  }
};
await Promise.all(Array.from({ length: Number(flag("concurrency") ?? 3) }, worker));

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const ordered = cases.map((c) => byId.get(c.id)).filter(Boolean);
const config = { ...arm, cases: path.relative(EVAL, casesFile).replace(/\\/g, "/"), today: process.env.TAGOUT_TODAY, noWeb: NOWEB, offline: OFFLINE, keyless: KEYLESS, code };
fs.writeFileSync(outFile, JSON.stringify({ arm: outName, label: `${arm.label}${NOWEB ? " (Tavily off)" : ""}`, config, at: new Date().toISOString(), cases: ordered }, null, 1) + "\n");
console.log(OFFLINE ? `offline replay: ${ordered.filter((r) => (r as { cacheMisses?: number }).cacheMisses).length} of ${ordered.length} cases had cache misses` : `spent this run $${(ledger.total - startSpend).toFixed(4)}; eval total $${ledger.total.toFixed(4)} over ${ledger.calls} live calls; Tavily live calls ${ledger.tavilyLive} (${ledger.tavilyKeyed ?? 0} on the key)`);

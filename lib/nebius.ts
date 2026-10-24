import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Nebius Token Factory (OpenAI-compatible) with NVIDIA Nemotron. Each role names a chain of models so one
 * model being pulled or rate-limited doesn't end the demo; the engine label always names the model that
 * actually answered. Provider error text stays in the server log.
 */
const BASE = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";

const list = (v: string | undefined, d: string[]) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);

export const MODELS = {
  /** Plans the searches and judges which recalls are about the item: the serious reasoning. */
  agent: list(process.env.NEBIUS_AGENT_MODELS, ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]),
  /** Reads model and lot lists out of recall notices. In the eval (eval/, /proof) Ultra was right on 104 of 105
   *  cases; Super as the notice reader wrongly tagged one unit red, Nano two. Super is the fallback. */
  reader: list(process.env.NEBIUS_READER_MODELS, ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]),
  /** Reads what people typed into items. Its own chain so it can be routed separately; by default it follows the reader. */
  intake: list(process.env.NEBIUS_INTAKE_MODELS ?? process.env.NEBIUS_READER_MODELS, ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]),
  /** The notice reader for the lite tier (after the day's Ultra budget): the fixed search plan with Nano reading
   *  the notices measured 98 of 105 right, no recalled unit cleared, at about 0.3 cents an item. */
  lite: list(process.env.NEBIUS_LITE_READER_MODELS, ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b"]),
  /** Reads label photos. Nemotron 3.5 Super VL joined Token Factory on Oct 12 2026, after the photo step was built
   *  on Qwen; on Oct 25 it read every code on the sample labels exactly (scripts/vision-eval.ts, eval/HOLDOUT.md),
   *  so it leads and Qwen and Gemma stay as fallbacks. */
  vision: list(process.env.NEBIUS_VISION_MODELS, ["nvidia/Nemotron-3.5-Super-VL", "Qwen/Qwen3.8-27B", "google/gemma-3-27b-it"]),
};

/** "nvidia/Nemotron-3-Ultra-550b-a55b" → "Nemotron 3 Ultra". */
export function modelLabel(id: string): string {
  const n = id.split("/").pop() ?? id;
  if (/ultra/i.test(n)) return "Nemotron 3 Ultra";
  if (/super-vl/i.test(n)) return "Nemotron 3.5 Super VL";
  if (/super/i.test(n)) return "Nemotron 3 Super";
  if (/lightning/i.test(n)) return "Nemotron 3.5 Lightning";
  if (/nano/i.test(n)) return "Nemotron 3 Nano";
  if (/qwen/i.test(n)) return "Qwen3.8 27B";
  if (/gemma/i.test(n)) return "Gemma 3 27B";
  if (/glm/i.test(n)) return "GLM-5.3 Flash";
  return n;
}

export type Msg =
  | { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatResult = { model: string; content: string; toolCalls: ToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number } };

/** Token Factory calls and tokens spent inside one check, so the page can say what the check cost. `usd` is the
 *  same at Token Factory's list prices (PRICES). */
export type Usage = { calls: number; prompt: number; completion: number; usd?: number };
export const usageScope = new AsyncLocalStorage<Usage>();

/** List prices in dollars per million tokens, [input, output]; an unlisted model is priced like Ultra. */
export const PRICES: Record<string, [number, number]> = {
  "nvidia/nemotron-3-ultra-550b-a55b": [1, 3],
  "nvidia/nemotron-3-super-120b-a12b": [0.3, 0.9],
  "nvidia/nvidia-nemotron-3-nano-30b-a3b": [0.06, 0.24],
};

export function priceOf(model: string, prompt: number, completion: number): number {
  const [a, b] = PRICES[model.toLowerCase()] ?? [1, 3];
  return (prompt * a + completion * b) / 1e6;
}

/**
 * A deadline for every model call made inside it (one check, or one sweep). Each call's timeout is cut to the
 * time left, and once less than a second and a half is left a call fails at once, so the caller's fallback runs
 * while there is still time to save the result.
 */
export const deadlineScope = new AsyncLocalStorage<{ at: number }>();

export function hasKey(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

/** A failed call: `status` is the HTTP status (absent for timeouts, network errors and empty replies). */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly deadline = false,
  ) {
    super(message);
  }
}

/**
 * Whether a failure is worth another try: rate limits (429), server errors (5xx), timeouts and network errors.
 * A 400, 404 or 422 is about this request and won't change on a retry; 401, 402 and 403 are about the key or the
 * balance and stop the whole chain (`fatal`), since every model behind the same key will answer the same.
 */
export function retryable(e: unknown): boolean {
  if (!(e instanceof ModelError)) return true;
  if (e.deadline) return false;
  return e.status === undefined || e.status === 429 || e.status >= 500;
}

export function fatal(e: unknown): boolean {
  return e instanceof ModelError && (e.deadline || e.status === 401 || e.status === 402 || e.status === 403);
}

/** "Retry-After: 3" or an HTTP date, in milliseconds. */
function retryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, t - Date.now());
}

async function once(model: string, body: Record<string, unknown>, timeoutMs: number): Promise<ChatResult> {
  const t0 = Date.now();
  const dl = deadlineScope.getStore()?.at;
  const left = dl ? dl - t0 : Infinity;
  if (left < 1500) throw new ModelError("the check's deadline has passed", undefined, undefined, true);
  let r: Response;
  try {
    r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
    });
  } catch (e) {
    throw new ModelError((e as Error).name === "TimeoutError" ? "timed out" : `network: ${(e as Error).message}`);
  }
  if (!r.ok) {
    const text = (await r.text().catch(() => "")).slice(0, 400);
    console.error(`[nebius] ${model} HTTP ${r.status}: ${text}`);
    throw new ModelError(`HTTP ${r.status}`, r.status, retryAfter(r.headers.get("retry-after")));
  }
  const j = (await r.json().catch(() => ({}))) as { choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[]; usage?: ChatResult["usage"] };
  const m = j.choices?.[0]?.message;
  if (!m) throw new ModelError("empty response");
  const tally = usageScope.getStore();
  if (tally && j.usage) {
    tally.calls++;
    tally.prompt += j.usage.prompt_tokens ?? 0;
    tally.completion += j.usage.completion_tokens ?? 0;
    tally.usd = (tally.usd ?? 0) + priceOf(model, j.usage.prompt_tokens ?? 0, j.usage.completion_tokens ?? 0);
  }
  console.log(`[nebius] ${model} ${Date.now() - t0}ms ${j.usage?.prompt_tokens ?? "?"}+${j.usage?.completion_tokens ?? "?"} tokens`);
  return { model, content: (m.content ?? "").trim(), toolCalls: m.tool_calls ?? [], usage: j.usage };
}

/**
 * One chat call, trying each model in the chain until one answers. A model that failed with something worth
 * retrying (429, 5xx, a timeout) gets one more try after a backoff with jitter, longer if Token Factory sent
 * Retry-After; a 400 or 404 moves straight to the next model; 401, 402 and 403 end the chain at once.
 */
export async function chat(chain: string[], body: { messages: Msg[]; tools?: ToolDef[]; tool_choice?: unknown; response_format?: unknown; max_tokens?: number; temperature?: number }, timeoutMs = 30_000): Promise<ChatResult> {
  if (!hasKey()) throw new Error("NEBIUS_API_KEY is not set");
  let last: unknown;
  let again = chain;
  for (let pass = 0; pass < 2 && again.length; pass++) {
    if (pass) {
      const hint = last instanceof ModelError && last.retryAfterMs !== undefined ? Math.min(last.retryAfterMs, 8000) : 0;
      const wait = Math.max(hint, 1200 + Math.random() * 800);
      const dl = deadlineScope.getStore()?.at;
      if (dl && Date.now() + wait + 1500 > dl) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    const next: string[] = [];
    for (const model of again) {
      try {
        return await once(model, { temperature: 0.2, max_tokens: 2000, ...body }, timeoutMs);
      } catch (e) {
        last = e;
        console.error(`[nebius] ${model} failed: ${(e as Error).message}`);
        if (fatal(e)) throw e;
        if (retryable(e)) next.push(model);
      }
    }
    again = next;
  }
  throw last instanceof Error ? last : new Error("All models failed");
}

/** Pull the JSON object out of a reply (models sometimes wrap it in a fence or add a line before it). */
export function parseJson<T>(text: string): T {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)) as T;
    throw new Error("The model's reply wasn't JSON.");
  }
}

/** Structured output under a strict JSON schema. Retries the next model when one returns something unparsable. */
export async function structured<T>(chain: string[], opts: { name: string; schema: Record<string, unknown>; messages: Msg[]; maxTokens?: number; timeoutMs?: number }): Promise<{ data: T; model: string }> {
  let last: unknown;
  for (const model of chain) {
    try {
      const r = await chat(
        [model],
        { messages: opts.messages, max_tokens: opts.maxTokens ?? 2500, response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } } },
        opts.timeoutMs ?? 30_000,
      );
      return { data: parseJson<T>(r.content), model: r.model };
    } catch (e) {
      last = e;
      if (fatal(e)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error("No model returned valid JSON");
}

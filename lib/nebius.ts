import "server-only";

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
  /** Reads what people typed into items, and reads model and lot lists out of recall notices. Ultra measured both
   *  fastest and cleanest at strict JSON here; Super is the fallback. */
  reader: list(process.env.NEBIUS_READER_MODELS, ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]),
  /** Reads label photos. There is no NVIDIA vision model on Token Factory today, so this is the one non-Nemotron role. */
  vision: list(process.env.NEBIUS_VISION_MODELS, ["Qwen/Qwen3.8-27B", "zai-org/GLM-5.3-Flash"]),
};

/** "nvidia/Nemotron-3-Ultra-550b-a55b" → "Nemotron 3 Ultra". */
export function modelLabel(id: string): string {
  const n = id.split("/").pop() ?? id;
  if (/ultra/i.test(n)) return "Nemotron 3 Ultra";
  if (/super/i.test(n)) return "Nemotron 3 Super";
  if (/lightning/i.test(n)) return "Nemotron 3.5 Lightning";
  if (/nano/i.test(n)) return "Nemotron 3 Nano";
  if (/qwen/i.test(n)) return "Qwen3.8 27B";
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

export function hasKey(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

async function once(model: string, body: Record<string, unknown>, timeoutMs: number): Promise<ChatResult> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 400);
    console.error(`[nebius] ${model} HTTP ${r.status}: ${text}`);
    throw new Error(`HTTP ${r.status}`);
  }
  const j = (await r.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[]; usage?: ChatResult["usage"] };
  const m = j.choices?.[0]?.message;
  if (!m) throw new Error("empty response");
  return { model, content: (m.content ?? "").trim(), toolCalls: m.tool_calls ?? [], usage: j.usage };
}

/** One chat call, trying each model in the chain until one answers. */
export async function chat(chain: string[], body: { messages: Msg[]; tools?: ToolDef[]; tool_choice?: unknown; response_format?: unknown; max_tokens?: number; temperature?: number }, timeoutMs = 30_000): Promise<ChatResult> {
  if (!hasKey()) throw new Error("NEBIUS_API_KEY is not set");
  let last: unknown;
  // Two passes over the chain: Token Factory has answered 401 to every model for a few seconds at a time
  // (measured Oct 5) and then recovered, so one short pause saves the check from the fixed plan.
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, 1500));
    for (const model of chain) {
      try {
        return await once(model, { temperature: 0.2, max_tokens: 2000, ...body }, timeoutMs);
      } catch (e) {
        last = e;
        console.error(`[nebius] ${model} failed: ${(e as Error).message}`);
      }
    }
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
    }
  }
  throw last instanceof Error ? last : new Error("No model returned valid JSON");
}

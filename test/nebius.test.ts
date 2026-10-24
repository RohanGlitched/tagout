import { test } from "node:test";
import assert from "node:assert/strict";

// The default chains, not whatever a local .env routes them to.
for (const k of ["NEBIUS_AGENT_MODELS", "NEBIUS_READER_MODELS", "NEBIUS_INTAKE_MODELS", "NEBIUS_LITE_READER_MODELS", "NEBIUS_VISION_MODELS"]) delete process.env[k];
const { MODELS, modelLabel, parseJson } = await import("../lib/nebius.ts");

test("label photos go to Nemotron 3.5 Super VL first, with Qwen and Gemma as fallbacks", () => {
  assert.deepEqual(MODELS.vision, ["nvidia/Nemotron-3.5-Super-VL", "Qwen/Qwen3.8-27B", "google/gemma-3-27b-it"]);
});

test("every text role leads with a Nemotron model", () => {
  for (const role of ["agent", "reader", "intake", "lite"] as const) assert.match(MODELS[role][0], /^nvidia\/.*nemotron/i, role);
});

test("the engine label names the model that answered", () => {
  assert.equal(modelLabel("nvidia/Nemotron-3.5-Super-VL"), "Nemotron 3.5 Super VL");
  assert.equal(modelLabel("nvidia/nemotron-3-super-120b-a12b"), "Nemotron 3 Super");
  assert.equal(modelLabel("nvidia/Nemotron-3-Ultra-550b-a55b"), "Nemotron 3 Ultra");
  assert.equal(modelLabel("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"), "Nemotron 3 Nano");
  assert.equal(modelLabel("Qwen/Qwen3.8-27B"), "Qwen3.8 27B");
  assert.equal(modelLabel("google/gemma-3-27b-it"), "Gemma 3 27B");
});

test("a reply wrapped in a fence or led by a sentence still parses", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Here it is: {"a":[1,2]} done'), { a: [1, 2] });
  assert.throws(() => parseJson("no json here"));
});

// Token Factory stubbed: each call is recorded, and answered by `reply(body)`.
function stub(reply: (body: Record<string, unknown>) => { content: string; finish: string }) {
  const sent: Record<string, unknown>[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    const r = reply(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: r.content }, finish_reason: r.finish }], usage: { prompt_tokens: 10, completion_tokens: Number(body.max_tokens) } }), { status: 200 });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = real) };
}
const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };

test("a reply cut off at the cap with nothing usable is asked once more, with 2.5 times the room", async () => {
  process.env.NEBIUS_API_KEY ||= "test";
  const { structured, usageScope } = await import("../lib/nebius.ts");
  const s = stub((b) => (Number(b.max_tokens) > 1500 ? { content: '{"a":1}', finish: "stop" } : { content: '{"a":', finish: "length" }));
  const usage: import("../lib/nebius.ts").Usage = { calls: 0, prompt: 0, completion: 0 };
  try {
    const r = await usageScope.run(usage, () => structured<{ a: number }>(["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"], { name: "x", schema, messages: [{ role: "user", content: "x" }], maxTokens: 1500 }));
    assert.deepEqual(r.data, { a: 1 });
    assert.equal(r.model, "nvidia/Nemotron-3-Ultra-550b-a55b", "the same model answers the retry");
    assert.deepEqual(s.sent.map((b) => b.max_tokens), [1500, 3750]);
    assert.equal(usage.truncated, 1);
    assert.equal(usage.retried, 1);
  } finally {
    s.restore();
  }
});

test("a complete reply is not retried, and a cut-off reply that still parses is kept", async () => {
  const { structured } = await import("../lib/nebius.ts");
  const s = stub(() => ({ content: '{"a":2}', finish: "length" }));
  try {
    const r = await structured<{ a: number }>(["nvidia/Nemotron-3-Ultra-550b-a55b"], { name: "x", schema, messages: [{ role: "user", content: "x" }], maxTokens: 1500 });
    assert.deepEqual(r.data, { a: 2 });
    assert.equal(s.sent.length, 1);
  } finally {
    s.restore();
  }
});

test("reasoning is switched off only for the listed Nemotron models, and back on for the retry", async () => {
  const { structured } = await import("../lib/nebius.ts");
  const nano = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
  const s = stub((b) => (b.chat_template_kwargs ? { content: '{"a":' + " ".repeat(50), finish: "length" } : { content: '{"a":3}', finish: "stop" }));
  try {
    const r = await structured<{ a: number }>([nano], { name: "x", schema, messages: [{ role: "user", content: "x" }], maxTokens: 1500, noThink: [nano, "google/gemma-3-27b-it"] });
    assert.deepEqual(r.data, { a: 3 });
    assert.deepEqual(s.sent[0].chat_template_kwargs, { enable_thinking: false });
    assert.equal(s.sent[1].chat_template_kwargs, undefined);
    assert.equal(s.sent[1].max_tokens, 3750);
    await structured(["google/gemma-3-27b-it"], { name: "x", schema, messages: [{ role: "user", content: "x" }], noThink: ["google/gemma-3-27b-it"] });
    assert.equal(s.sent[2].chat_template_kwargs, undefined, "never sent to a model that isn't Nemotron");
  } finally {
    s.restore();
  }
});

test("list prices cover every model the chains can call", async () => {
  const { MODELS, PRICES, priceOf } = await import("../lib/nebius.ts");
  for (const m of new Set(Object.values(MODELS).flat())) assert.ok(PRICES[m.toLowerCase()], m);
  assert.equal(priceOf("nvidia/Nemotron-3.5-Super-VL", 1e6, 1e6), 1.2);
  assert.equal(priceOf("Qwen/Qwen3.8-27B", 1e6, 1e6), 3.45);
  assert.equal(priceOf("google/gemma-3-27b-it", 1e6, 1e6), 0.4);
});

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

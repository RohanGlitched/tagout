// What the eval really spent on Token Factory: every cached model response is one billed call. Usage: node eval/spend.mjs
import fs from "node:fs";
import path from "node:path";

const PRICES = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": [1, 3],
  "nvidia/nemotron-3-super-120b-a12b": [0.3, 0.9],
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": [0.06, 0.24],
};
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), ".cache", "http");
const by = {};
let total = 0;
let calls = 0;
let tavily = 0;
for (const d of fs.readdirSync(root)) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    const hit = JSON.parse(fs.readFileSync(path.join(root, d, f), "utf8"));
    let j;
    try {
      j = JSON.parse(hit.body);
    } catch {
      continue;
    }
    if (j?.usage && j?.choices) {
      const key = Object.keys(PRICES).find((k) => k.toLowerCase() === String(j.model).toLowerCase()) ?? j.model;
      const [a, b] = PRICES[key] ?? [1, 3];
      const usd = ((j.usage.prompt_tokens ?? 0) * a + (j.usage.completion_tokens ?? 0) * b) / 1e6;
      by[key] = by[key] ?? { calls: 0, usd: 0, prompt: 0, completion: 0 };
      by[key].calls++;
      by[key].usd += usd;
      by[key].prompt += j.usage.prompt_tokens ?? 0;
      by[key].completion += j.usage.completion_tokens ?? 0;
      total += usd;
      calls++;
    } else if (j?.results && (j.response_time !== undefined || j.request_id)) tavily++;
  }
}
console.log(JSON.stringify({ total: Number(total.toFixed(4)), calls, tavilyCached: tavily, byModel: by }, null, 1));

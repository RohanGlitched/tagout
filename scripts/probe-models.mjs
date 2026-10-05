// Day-one probe: which Token Factory models do tool calls and json_schema, and how fast. Usage: node scripts/probe-models.mjs
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^"|"$/g, ""); }
const BASE = "https://api.tokenfactory.nebius.com/v1";
const H = { authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "content-type": "application/json" };
async function call(body) {
  const t = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  return { ms: Date.now() - t, status: r.status, j };
}
const tools = [{ type: "function", function: { name: "cpsc_search", description: "Search CPSC recalls", parameters: { type: "object", properties: { product: { type: "string" }, manufacturer: { type: "string" } }, required: ["product"] } } }];
const schema = { name: "items", strict: true, schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["vehicle", "car-seat", "product", "drug", "food"] }, brand: { type: ["string", "null"] }, model: { type: ["string", "null"] } }, required: ["kind", "brand", "model"] } } }, required: ["items"] } };
const models = ["nvidia/Nemotron-3_5-Lightning", "nvidia/nemotron-3-super-120b-a12b", "nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"];
for (const model of models) {
  const a = await call({ model, max_tokens: 800, messages: [{ role: "user", content: "Is my Vornado SRTH heater recalled? Use the tool." }], tools, tool_choice: "auto" });
  const tc = a.j.choices?.[0]?.message?.tool_calls;
  console.log(model, "TOOLS", a.status, a.ms + "ms", tc ? JSON.stringify(tc[0].function) : JSON.stringify(a.j).slice(0, 300), "usage", JSON.stringify(a.j.usage));
  const b = await call({ model, max_tokens: 1500, messages: [{ role: "user", content: "Items: 2019 Honda CR-V; Graco SnugRide 35 car seat; Tylenol lot EJA022" }], response_format: { type: "json_schema", json_schema: schema } });
  console.log(model, "JSON", b.status, b.ms + "ms", (b.j.choices?.[0]?.message?.content ?? JSON.stringify(b.j)).slice(0, 400));
}
// Vision on GLM-5.3-Flash with a tiny generated label image.

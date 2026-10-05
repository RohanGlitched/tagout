import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^"(.*)"$/, "$1"); }
const img = "data:image/jpeg;base64," + fs.readFileSync(process.argv[2]).toString("base64");
for (const model of (process.argv[3] || "zai-org/GLM-5.3-Flash,Qwen/Qwen3.8-27B,google/gemma-3-27b-it").split(",")) {
  const t = Date.now();
  const r = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: [{ type: "text", text: "Read this product label. Return JSON {brand, product, model, serial, lot, date_code, upc} using exactly the characters printed; null if absent." }, { type: "image_url", image_url: { url: img } }] }], response_format: { type: "json_object" } }) });
  const j = await r.json();
  console.log(model, r.status, Date.now() - t, "ms", (j.choices?.[0]?.message?.content ?? JSON.stringify(j)).slice(0, 500));
}

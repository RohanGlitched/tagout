// Checks how often CPSC's recall database fills in the product model field, which is why Tagout reads model numbers
// out of the notice text instead. GET only. Usage: node scripts/model-field-probe.mjs  -> docs/model-field-probe.json
import fs from "node:fs";

const today = new Date().toISOString().slice(0, 10);
const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2020-01-01&RecallDateEnd=${today}`;
const all = await (await fetch(url, { headers: { accept: "application/json" } })).json();
const filled = all.filter((r) => (r.Products ?? []).some((p) => (p.Model ?? "").trim()));
const mention = all.filter((r) => /\bmodel/i.test(r.Description ?? ""));
const out = { at: today, url, recalls: all.length, modelFieldFilled: filled.length, descriptionMentionsModel: mention.length };
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/model-field-probe.json", JSON.stringify(out, null, 1) + "\n");
console.log(out);

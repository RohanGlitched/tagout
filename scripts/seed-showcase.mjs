// Runs the curated household check against a deployment and prints its id. Usage: node scripts/seed-showcase.mjs [base]
const BASE = process.argv[2] || "http://localhost:3700";
const text = [
  "Vornado space heater, TYPE SRTH on the label",
  "Tylenol Extra Strength caplets, lot EJA022",
  "2019 Honda CR-V",
  "Evenflo car seat",
  "Lasko ceramic tower heater, model CT22425",
].join("\n");
const r = await fetch(`${BASE}/api/checks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
const { id, error } = await r.json();
if (!id) throw new Error(error);
const run = await fetch(`${BASE}/api/checks/${id}/run`, { method: "POST" });
const out = await run.text();
for (const line of out.trim().split("\n")) {
  const e = JSON.parse(line);
  if (e.t === "verdict") console.log(e.verdict.itemId, e.verdict.level, e.verdict.headline);
  if (e.t === "error") console.log("ERROR", e.message);
}
console.log("id", id);

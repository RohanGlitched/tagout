// Checks the allergen cases' ground truth against openFDA, without any Tagout code or model.
// Usage: node eval/verify-allergen.mjs   (writes eval/verified-allergen.json)
//
// positive  - the lot is printed in the named record (code_info or product description), and its
//             reason_for_recall calls the expected allergen undeclared and names no other hazard word.
// near-miss - the lot is NOT printed in the named record, and no openFDA food record of the same brand prints it.
// Every case: none of its recalls is in eval/cases.json or eval/cases-holdout.json.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL("cases-allergen.json", dir), "utf8"));
const others = fs.readFileSync(new URL("cases.json", dir), "utf8") + fs.readFileSync(new URL("cases-holdout.json", dir), "utf8");
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url).catch(() => null);
    if (r?.status === 404) return null;
    if (r?.ok) return r.json();
    await sleep(1000 * (i + 1));
  }
  throw new Error(`no answer from ${url}`);
}
const record = async (id) => (await json(`https://api.fda.gov/food/enforcement.json?search=recall_number:"${id}"&limit=1`))?.results?.[0] ?? null;
const OTHER = /listeria|salmonella|coli|botulin|foreign|metal|glass|plastic|lead|mold/i;

const results = [];
for (const c of cases) {
  const lot = c.text.match(/\blot\s+([A-Za-z0-9-]+)/i)?.[1];
  const row = { id: c.id, group: c.group, lot, ok: true, notes: [] };
  const fail = (m) => {
    row.ok = false;
    row.notes.push(m);
  };
  try {
    const ref = (c.recall ?? [c.near])[0];
    const id = ref.replace(/^FDA\s*/, "");
    if (others.includes(id)) fail(`${id} is in another case file`);
    const r = await record(id);
    if (!r) throw new Error(`${id} not found`);
    row.report_date = r.report_date;
    row.reason = r.reason_for_recall;
    const hay = norm(`${r.product_description} ${r.code_info} ${r.more_code_info ?? ""}`);
    if (c.group === "positive") {
      if (!hay.includes(norm(lot))) fail(`lot ${lot} not printed in ${id}`);
      if (!/undeclared/i.test(r.reason_for_recall) || !new RegExp(c.allergen.replace(/s$/, ""), "i").test(r.reason_for_recall)) fail(`${id}'s reason doesn't call ${c.allergen} undeclared`);
      if (OTHER.test(r.reason_for_recall)) fail(`${id}'s reason names another hazard`);
    } else {
      if (hay.includes(norm(lot))) fail(`lot ${lot} IS printed in ${id}`);
      const j = await json(`https://api.fda.gov/food/enforcement.json?search=code_info:"${encodeURIComponent(lot)}"&limit=50`);
      const hits = (j?.results ?? []).filter((x) => norm(`${x.product_description} ${x.recalling_firm}`).includes(norm(c.brand)) && norm(`${x.product_description} ${x.code_info}`).includes(norm(lot)));
      if (hits.length) fail(`lot ${lot} printed in ${hits.map((x) => x.recall_number).join(", ")}`);
      else row.notes.push(`no openFDA food record from ${c.brand} prints ${lot}`);
    }
  } catch (e) {
    fail(`error: ${e.message}`);
  }
  results.push(row);
  console.log(row.ok ? "ok  " : "FAIL", c.id, c.group.padEnd(9), lot, row.report_date ?? "", row.reason ?? "", row.notes.join("; "));
  await sleep(300);
}
fs.writeFileSync(new URL("verified-allergen.json", dir), JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} verified`);

// Ground truth for held-out set #3, checked against the agency records with no Tagout code: fetches each CPSC or
// openFDA record, reads the printed bound with the case's own pattern, and checks the household's value against it.
// Usage: node eval/verify-holdout3.mjs  -> eval/verified-holdout3.json
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL("cases-holdout3.json", dir), "utf8"));
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const month = (s) => {
  const [m, y] = s.toLowerCase().split(" ");
  const i = MONTHS.indexOf(m);
  if (i < 0) throw new Error(`not a month: ${s}`);
  return `${y}-${String(i + 1).padStart(2, "0")}`;
};

const cache = new Map();
async function record(src, id) {
  const key = `${src}:${id}`;
  if (!cache.has(key)) {
    const url =
      src === "cpsc"
        ? `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=${id}`
        : `https://api.fda.gov/device/enforcement.json?search=recall_number:"${id}"`;
    const j = await (await fetch(url)).json();
    const text = src === "cpsc" ? j.map((r) => `${r.Title}\n${r.Description}`).join("\n") : (j.results ?? []).map((r) => `${r.product_description}\n${r.code_info}`).join("\n");
    cache.set(key, text.replace(/\s+/g, " "));
  }
  return cache.get(key);
}

const results = [];
for (const c of cases) {
  const t = c.truth;
  const notes = [];
  let ok = false;
  try {
    const text = await record(t.source, t.record);
    if (!text) throw new Error("record not found");
    if (t.kind === "month-window" || t.kind === "month-windows") {
      const m = text.match(new RegExp(t.pattern, "i"));
      if (!m) throw new Error("bound not printed");
      const ends = m.slice(1).map(month);
      const windows = [];
      for (let i = 0; i < ends.length; i += 2) windows.push([ends[i], ends[i + 1]]);
      const inside = windows.some(([a, b]) => t.value >= a && t.value <= b);
      ok = inside === (t.inside ?? true);
      notes.push(`${t.value} ${inside ? "inside" : "outside"} ${windows.map((w) => w.join("..")).join(" and ")}`);
    } else if (t.kind === "number-intervals") {
      const m = text.match(new RegExp(t.pattern, "i"));
      if (!m) throw new Error("bound not printed");
      const nums = m.slice(1).map(Number);
      const v = Number(t.value);
      const inside = nums[0] <= v && v <= nums[1] ? true : nums[2] <= v && v <= nums[3];
      ok = inside === (t.inside ?? true);
      notes.push(`${t.value} ${inside ? "inside" : "outside"} ${nums[0]}-${nums[1]} and ${nums[2]}-${nums[3]}`);
    } else if (t.kind === "printed") {
      ok = text.includes(t.value);
      notes.push(`${t.value} ${ok ? "printed" : "not printed"} in ${t.record}`);
    } else if (t.kind === "printed-nowhere") {
      const j = await (await fetch(`https://api.fda.gov/device/enforcement.json?search=code_info:"${t.search}"&limit=100`)).json();
      const all = (j.results ?? []).map((r) => r.code_info).join(" ");
      ok = !all.includes(t.value) && (j.results ?? []).length > 0;
      notes.push(`${t.value} printed in none of ${(j.results ?? []).length} openFDA records that print ${t.search}`);
    }
  } catch (e) {
    notes.push(String(e.message ?? e));
  }
  results.push({ id: c.id, group: c.group, probe: c.probe, ok, notes });
  console.log(ok ? "ok  " : "FAIL", c.id, c.probe.padEnd(7), notes.join("; "));
}
fs.writeFileSync(new URL("verified-holdout3.json", dir), JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} verified`);

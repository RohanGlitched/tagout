// Checks every case's ground truth against the agencies' own records, without any Tagout code or model.
// Usage: node eval/verify.mjs   (writes eval/verified.json)
//
// positive  - the code is printed in the named recall (CPSC description, FDA code_info or UPC).
// near-miss - the code is NOT printed in the recall it sits next to, and no CPSC or FDA record prints it.
// clean     - no CPSC or FDA record prints the code.
// car       - NHTSA's recallsByVehicle count, under NHTSA's own model spelling.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL("cases.json", dir), "utf8"));
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
    if (r?.status === 404) return null;
    // NHTSA answers "no recalls" with HTTP 400 and a JSON body that says Count 0.
    if (r?.status === 400 && url.includes("api.nhtsa.gov")) return r.json();
    if (r?.ok) {
      const j = await r.json();
      // CPSC answers a transient error with a fake RecallID 0 record.
      if (Array.isArray(j) && j.length === 1 && j[0].RecallID === 0) {
        await sleep(800);
        continue;
      }
      return j;
    }
    await sleep(1000 * (i + 1));
  }
  throw new Error(`no answer from ${url}`);
}

const cpscText = (r) => [r.Title, r.Description, ...(r.Products ?? []).map((p) => `${p.Name} ${p.Model}`), ...(r.ProductUPCs ?? []).map((u) => u.UPC)].join(" ");
const fdaText = (r) => `${r.product_description} ${r.code_info} ${r.more_code_info ?? ""}`;

async function cpscByNumber(n) {
  const num = n.replace(/^CPSC\s*/, "").replace("-", "");
  const recs = (await json(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=${num}&_=${Date.now()}`)) ?? [];
  return recs.find((r) => r.RecallNumber === num) ?? null;
}
async function fdaByNumber(n) {
  const id = n.replace(/^FDA\s*/, "");
  const kind = id.startsWith("D-") ? "drug" : id.startsWith("H-") || id.startsWith("F-") ? "food" : "device";
  const j = await json(`https://api.fda.gov/${kind}/enforcement.json?search=recall_number:"${id}"&limit=1`);
  return j?.results?.[0] ?? null;
}
// A short number like "5951" is printed in many unrelated notices (serial ranges of other products), so a record
// only counts when it also names the case's brand.
async function cpscPrinting(code, brand) {
  const recs = (await json(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDescription=${encodeURIComponent(code)}&_=${Date.now()}`)) ?? [];
  return recs.filter((r) => norm(cpscText(r)).includes(norm(code)) && norm(cpscText(r)).includes(norm(brand))).map((r) => r.RecallNumber);
}
async function fdaPrinting(code, brand) {
  const out = [];
  for (const kind of ["drug", "food", "device"]) {
    const j = await json(`https://api.fda.gov/${kind}/enforcement.json?search=code_info:"${encodeURIComponent(code)}"&limit=20`);
    for (const r of j?.results ?? []) if (norm(fdaText(r)).includes(norm(code)) && norm(`${fdaText(r)} ${r.recalling_firm}`).includes(norm(brand))) out.push(r.recall_number);
    await sleep(250);
  }
  return out;
}

/** The code a case turns on: what follows "model", "lot", "batch", "date code", "UPC" or "TYPE". */
function codesOf(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:model|lot|batch|date code|UPC|TYPE)\s+([A-Za-z0-9][A-Za-z0-9-+]*)/gi)) out.push(m[1]);
  return out;
}

const NHTSA_NAME = { "MX-5 Miata": "MX-5", GX: "GX460" };
const results = [];
for (const c of cases) {
  const codes = codesOf(c.text);
  const row = { id: c.id, group: c.group, codes, ok: true, notes: [] };
  try {
    if (c.group === "positive") {
      const ref = c.recall[0];
      const rec = ref.startsWith("CPSC") ? await cpscByNumber(ref) : await fdaByNumber(ref);
      if (!rec) throw new Error(`${ref} not found`);
      const hay = norm(ref.startsWith("CPSC") ? cpscText(rec) : fdaText(rec));
      row.date = ref.startsWith("CPSC") ? rec.RecallDate?.slice(0, 10) : rec.report_date;
      for (const k of codes) {
        if (!hay.includes(norm(k))) {
          row.ok = false;
          row.notes.push(`${k} not printed in ${ref}`);
        }
      }
    } else if (c.group === "near-miss" || c.group === "clean") {
      if (c.near && /^(CPSC|FDA) [A-Z0-9-]+$/.test(c.near)) {
        const rec = c.near.startsWith("CPSC") ? await cpscByNumber(c.near) : await fdaByNumber(c.near);
        if (!rec) throw new Error(`${c.near} not found`);
        const hay = norm(c.near.startsWith("CPSC") ? cpscText(rec) : fdaText(rec));
        // The deciding code (the last one: a batch after a recalled model, a lot) must be missing from the notice.
        const decider = codes.at(-1);
        if (c.window) {
          // A date-window case: the model is listed, and the notice must state the window the date falls outside.
          if (!hay.includes(norm(c.window))) {
            row.ok = false;
            row.notes.push(`window "${c.window}" not printed in ${c.near}`);
          }
        } else if (decider && hay.includes(norm(decider))) {
          row.ok = false;
          row.notes.push(`${decider} IS printed in ${c.near}`);
        }
      }
      const decider = c.window ? null : codes.at(-1);
      if (decider) {
        const brand = c.text.split(/[\s,]+/)[0].replace(/'s$/i, "");
        const cp = await cpscPrinting(decider, brand);
        const fd = await fdaPrinting(decider, brand);
        if (cp.length || fd.length) {
          row.ok = false;
          row.notes.push(`${decider} printed in ${[...cp.map((x) => `CPSC ${x}`), ...fd].join(", ")}`);
        }
      }
    } else if (c.group === "car") {
      const m = c.text.match(/^(\d{4}) (\S+) (.+)$/);
      const model = NHTSA_NAME[m[3]] ?? m[3];
      const j = await json(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(m[2])}&model=${encodeURIComponent(model)}&modelYear=${m[1]}`);
      row.recalls = j?.Count ?? 0;
      const want = c.expect === "warning" ? row.recalls > 0 : row.recalls === 0;
      if (!want) {
        row.ok = false;
        row.notes.push(`NHTSA lists ${row.recalls} recalls`);
      }
    } else if (c.group === "no-code") {
      if (/^(CPSC|FDA) [A-Z0-9-]+$/.test(c.near)) {
        const rec = c.near.startsWith("CPSC") ? await cpscByNumber(c.near) : await fdaByNumber(c.near);
        if (!rec) throw new Error(`${c.near} not found`);
      }
    }
  } catch (e) {
    row.ok = false;
    row.notes.push(`error: ${e.message}`);
  }
  results.push(row);
  console.log(row.ok ? "ok  " : "FAIL", c.id, c.group, codes.join(" "), row.notes.join("; "), row.recalls ?? "", row.date ?? "");
  await sleep(150);
}
fs.writeFileSync(new URL("verified.json", dir), JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} verified`);

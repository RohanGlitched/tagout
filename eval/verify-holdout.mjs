// Checks every held-out case's ground truth against the agencies' own records or the notice text, without any
// Tagout code or model. Usage: node eval/verify-holdout.mjs   (writes eval/verified-holdout.json)
//
// Same rules as eval/verify.mjs, plus the lag window:
// positive  - each deciding code is printed in the named recall (CPSC record, FDA code_info, or the notice text
//             saved in eval/notices-holdout/ for recalls no database has yet).
// near-miss - the deciding code is NOT printed in the recall it sits next to, and no CPSC or FDA record prints it.
// no-code   - the recall exists; any code the line gives is printed in it.
// clean     - no CPSC or FDA record prints the code.
// car       - NHTSA's recallsByVehicle count (and the newest campaign's date).
// lag       - also: the recall is NOT in the database Tagout would query (CPSC's API has no such recall number;
//             openFDA has no enforcement report from the firm since Oct 1; FSIS has no database tool in Tagout).
// Every case: none of its recalls is in eval/cases.json, so nothing here shaped a fix.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL("cases-holdout.json", dir), "utf8"));
const tuned = fs.readFileSync(new URL("cases.json", dir), "utf8");
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
    if (r?.status === 404) return null;
    if (r?.status === 400 && url.includes("api.nhtsa.gov")) return r.json();
    if (r?.ok) {
      const j = await r.json();
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
/** Enforcement reports from a firm since Oct 1 2026 (drug, food, device), about the product when given. */
async function fdaFirmReports(firm, product) {
  const out = [];
  for (const kind of ["drug", "food", "device"]) {
    const j = await json(`https://api.fda.gov/${kind}/enforcement.json?search=recalling_firm:"${encodeURIComponent(firm)}"+AND+report_date:[20261001+TO+20991231]&limit=50`);
    for (const r of j?.results ?? []) if (!product || norm(r.product_description).includes(norm(product))) out.push(`${r.recall_number} ${r.report_date}`);
    await sleep(250);
  }
  return out;
}

/** The codes a case turns on: its explicit `codes`, else what follows model, lot, batch, date code, UPC or TYPE. */
function codesOf(c) {
  if (c.codes) return c.codes;
  const out = [];
  for (const m of c.text.matchAll(/\b(?:model|lot|batch|date code|UPC|TYPE)\s+([A-Za-z0-9][A-Za-z0-9-+]*(?: [A-Z]{2}\b)?)/gi)) out.push(m[1]);
  return out;
}

const results = [];
for (const c of cases) {
  const codes = codesOf(c);
  const row = { id: c.id, set: c.set, group: c.group, form: c.form, codes, ok: true, notes: [] };
  const fail = (m) => {
    row.ok = false;
    row.notes.push(m);
  };
  try {
    const refs = [...(c.recall ?? []), ...(c.near ? [c.near] : [])];
    for (const ref of refs) {
      const id = ref.replace(/^(CPSC|FDA|FSIS)\s*/, "");
      if (/^(CPSC|FDA) [A-Z0-9-]+$/.test(ref) && tuned.includes(id)) fail(`${ref} is in the tuned cases`);
    }
    const brand = c.brand ?? c.text.split(/[\s,]+/)[0].replace(/'s$/i, "");
    // The notice text: the agency record, or the saved notice for a recall no database has yet.
    let hay = null;
    let ref = (c.recall ?? [])[0] ?? c.near;
    if (c.notice) {
      hay = norm(fs.readFileSync(new URL(c.notice, dir), "utf8"));
    } else if (ref && /^(CPSC|FDA) [A-Z0-9-]+$/.test(ref)) {
      const rec = ref.startsWith("CPSC") ? await cpscByNumber(ref) : await fdaByNumber(ref);
      if (!rec) throw new Error(`${ref} not found`);
      row.date = ref.startsWith("CPSC") ? rec.RecallDate?.slice(0, 10) : rec.report_date;
      hay = norm(ref.startsWith("CPSC") ? cpscText(rec) : fdaText(rec));
    }

    if (c.group === "positive" || (c.group === "no-code" && codes.length)) {
      if (!hay) fail("no notice text to check");
      else for (const k of codes) if (!hay.includes(norm(k))) fail(`${k} not printed in ${ref}`);
    } else if (c.group === "near-miss") {
      const decider = codes.at(-1);
      if (hay && hay.includes(norm(decider))) fail(`${decider} IS printed in ${ref}`);
      const cp = await cpscPrinting(decider, brand);
      const fd = await fdaPrinting(decider, brand);
      if (cp.length || fd.length) fail(`${decider} printed in ${[...cp.map((x) => `CPSC ${x}`), ...fd].join(", ")}`);
    } else if (c.group === "clean") {
      const decider = codes.at(-1);
      const cp = await cpscPrinting(decider, brand);
      const fd = await fdaPrinting(decider, brand);
      if (cp.length || fd.length) fail(`${decider} printed in ${[...cp.map((x) => `CPSC ${x}`), ...fd].join(", ")}`);
    } else if (c.group === "car") {
      const m = c.text.match(/^(\d{4}) (\S+) (.+)$/);
      const model = c.nhtsaModel ?? m[3];
      const j = await json(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(m[2])}&model=${encodeURIComponent(model)}&modelYear=${m[1]}`);
      row.recalls = j?.Count ?? 0;
      row.campaigns = (j?.results ?? []).map((r) => `${r.NHTSACampaignNumber} ${r.ReportReceivedDate}`);
      if (c.expect === "warning" ? row.recalls === 0 : row.recalls > 0) fail(`NHTSA lists ${row.recalls} recalls`);
    } else if (c.group === "no-code" && !hay) {
      fail("no notice to check");
    }

    if (c.set === "lag") {
      // Not in the database Tagout would query.
      for (const r of c.recall ?? (c.near ? [c.near] : [])) {
        if (/^CPSC \d{2}-\d{3}$/.test(r)) {
          const rec = await cpscByNumber(r);
          if (rec) fail(`${r} is already in CPSC's API (${rec.RecallDate?.slice(0, 10)})`);
          else row.notes.push(`${r}: not in CPSC's API`);
        }
      }
      if (c.firm) {
        const reps = await fdaFirmReports(c.firm, c.product);
        if (reps.length) fail(`openFDA already has ${reps.join(", ")} from ${c.firm}${c.product ? ` about ${c.product}` : ""}`);
        else row.notes.push(`openFDA: no report from ${c.firm}${c.product ? ` about ${c.product}` : ""} since Oct 1`);
      }
      if ((c.recall ?? [])[0]?.startsWith("FSIS")) row.notes.push("FSIS: Tagout has no FSIS database tool; web only");
      if (c.published < "2026-10-16") fail(`published ${c.published}, before the lag window`);
    }
  } catch (e) {
    fail(`error: ${e.message}`);
  }
  results.push(row);
  console.log(row.ok ? "ok  " : "FAIL", c.id, c.set.padEnd(8), c.group.padEnd(9), codes.join(" "), row.notes.join("; "), row.recalls ?? "", row.date ?? "", (row.campaigns ?? []).join(","));
  await sleep(150);
}
fs.writeFileSync(new URL("verified-holdout.json", dir), JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} verified`);

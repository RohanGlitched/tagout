// Checks every case of held-out set #2 against the agencies' own records or the saved notice text, without any
// Tagout code or model. Usage: node eval/verify-holdout2.mjs   (writes eval/verified-holdout2.json)
//
// Unlike verify-holdout.mjs, a positive here need not print the household's code: each case carries a `truth`
// spec, and the check parses what the record prints.
// printed     - each code is printed in the record (spacing, dashes and case ignored).
// range       - both bounds are printed; the value has the bounds' prefix and its number is inside (or outside) them;
//               the value itself is printed in no CPSC or FDA record of the brand.
// prefixRange - the prefix and both bounds are printed; the value's number is inside (or outside) them.
// window      - the codes and the window's dates are printed (as the record words them); the value's date is inside
//               (or outside) the window.
// gap         - the neighbouring codes are printed, the value is printed neither in the record nor in any CPSC or
//               FDA record of the brand.
// wholeLine   - the notice says every unit is covered, in its own words.
// car         - NHTSA's recallsByVehicle count is above 0 (orange expected).
// clean       - no CPSC or FDA record of the brand prints the code.
// lag         - also: openFDA has no enforcement report from the firm since Oct 1 2026.
// Every case: none of its recalls is in cases.json, cases-holdout.json or cases-allergen.json.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const { cases } = JSON.parse(fs.readFileSync(new URL("cases-holdout2.json", dir), "utf8"));
const others = ["cases.json", "cases-holdout.json", "cases-allergen.json"].map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
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
const squash = (s) => s.replace(/\s+/g, " ").toLowerCase();

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
/** CPSC and FDA records of the brand that print this code. */
async function printedAnywhere(code, brand) {
  const out = [];
  const recs = (await json(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDescription=${encodeURIComponent(code)}&_=${Date.now()}`)) ?? [];
  for (const r of recs) if (norm(cpscText(r)).includes(norm(code)) && norm(cpscText(r)).includes(norm(brand))) out.push(`CPSC ${r.RecallNumber}`);
  for (const kind of ["drug", "food", "device"]) {
    for (const field of ["code_info", "product_description"]) {
      const j = await json(`https://api.fda.gov/${kind}/enforcement.json?search=${field}:"${encodeURIComponent(code)}"&limit=50`);
      for (const r of j?.results ?? []) if (norm(fdaText(r)).includes(norm(code)) && norm(`${fdaText(r)} ${r.recalling_firm}`).includes(norm(brand))) out.push(r.recall_number);
      await sleep(200);
    }
  }
  return [...new Set(out)];
}
async function fdaFirmReports(firm) {
  const out = [];
  for (const kind of ["drug", "food", "device"]) {
    const j = await json(`https://api.fda.gov/${kind}/enforcement.json?search=recalling_firm:"${encodeURIComponent(firm)}"+AND+report_date:[20261001+TO+20991231]&limit=50`);
    for (const r of j?.results ?? []) out.push(`${r.recall_number} ${r.report_date}`);
    await sleep(200);
  }
  return out;
}
/** "00010 2450" → ["00010", 2450]: the leading part and the last number. */
const split = (s) => {
  const m = String(s).trim().match(/^(.*?)(\d+)$/);
  return m ? [norm(m[1]), Number(m[2])] : [norm(s), NaN];
};

const results = [];
for (const c of cases) {
  const row = { id: c.id, set: c.set, group: c.group, probe: c.probe, ok: true, notes: [] };
  const fail = (m) => {
    row.ok = false;
    row.notes.push(m);
  };
  try {
    for (const ref of [...(c.recall ?? []), ...(c.near ? [c.near] : [])]) {
      const id = ref.replace(/^(CPSC|FDA)\s*/, "");
      if (/^(CPSC|FDA) [A-Z0-9-]+$/.test(ref) && (others.includes(id) || others.includes(id.replace("-", "")))) fail(`${ref} is in another case file`);
    }
    const ref = (c.recall ?? [])[0] ?? c.near;
    const brand = c.brand ?? c.text.split(/[\s,]+/)[0];
    let text = null;
    if (c.notice) {
      // The saved notice: its header (source, fetch date, a summary) ends at the first blank line; the text follows.
      text = fs.readFileSync(new URL(c.notice, dir), "utf8").split(/\r?\n\r?\n/).slice(1).join("\n\n");
    } else if (ref && /^(CPSC|FDA) [A-Z0-9-]+$/.test(ref)) {
      const rec = ref.startsWith("CPSC") ? await cpscByNumber(ref) : await fdaByNumber(ref);
      if (!rec) throw new Error(`${ref} not found`);
      row.date = ref.startsWith("CPSC") ? rec.RecallDate?.slice(0, 10) : rec.report_date;
      text = ref.startsWith("CPSC") ? cpscText(rec) : fdaText(rec);
    }
    const hay = text ? norm(text) : "";
    const printed = (code) => hay.includes(norm(code));
    const t = c.truth ?? {};
    switch (t.kind) {
      case "printed":
        for (const k of t.codes) if (!printed(k)) fail(`${k} not printed in ${ref}`);
        for (const d of t.dates ?? []) if (!squash(text).includes(squash(d))) fail(`"${d}" not printed in ${ref}`);
        break;
      case "range": {
        if (!printed(t.from) || !printed(t.to)) fail(`range ${t.from}..${t.to} not printed in ${ref}`);
        const [pa, a] = split(t.from), [pb, b] = split(t.to), [pv, v] = split(t.value);
        const inside = pa === pb && pv === pa && v >= a && v <= b;
        if (inside !== t.inside) fail(`${t.value} is ${inside ? "inside" : "outside"} ${t.from}..${t.to}`);
        const hits = printed(t.value) ? [ref] : await printedAnywhere(t.value, brand);
        if (hits.length) fail(`${t.value} is printed in ${hits.join(", ")}`);
        else row.notes.push(`${t.value} ${inside ? "inside" : "outside"} ${t.from}..${t.to}, printed nowhere`);
        break;
      }
      case "prefixRange": {
        for (const k of [t.prefix, t.from, t.to]) if (!printed(k)) fail(`${k} not printed in ${ref}`);
        const v = Number(t.value);
        const inside = v >= Number(t.from) && v <= Number(t.to);
        if (inside !== t.inside) fail(`${t.value} is ${inside ? "inside" : "outside"} ${t.from}..${t.to}`);
        const hits = await printedAnywhere(`${t.prefix}${t.value}`, brand);
        if (printed(`${t.prefix} ${t.value}`) || hits.length) fail(`${t.prefix} ${t.value} is printed`);
        else row.notes.push(`${t.prefix} + ${t.value} ${inside ? "inside" : "outside"} ${t.from}..${t.to}`);
        break;
      }
      case "window": {
        for (const k of t.codes) if (!printed(k)) fail(`${k} not printed in ${ref}`);
        for (const d of t.dates) if (!squash(text).includes(squash(d))) fail(`"${d}" not printed in ${ref}`);
        const inside = (!t.from || t.value >= t.from) && (!t.to || t.value <= t.to);
        if (inside !== t.inside) fail(`${t.value} is ${inside ? "inside" : "outside"} ${t.from ?? "…"}..${t.to ?? "…"}`);
        else row.notes.push(`${t.value} ${inside ? "inside" : "outside"} ${t.from ?? "…"}..${t.to ?? "…"}`);
        break;
      }
      case "gap": {
        for (const k of t.neighbors) if (!printed(k)) fail(`neighbour ${k} not printed in ${ref}`);
        if (printed(t.value)) fail(`${t.value} IS printed in ${ref}`);
        const hits = await printedAnywhere(t.value, brand);
        if (hits.length) fail(`${t.value} printed in ${hits.join(", ")}`);
        else row.notes.push(`${t.value} printed nowhere; ${t.neighbors.join(" and ")} printed`);
        break;
      }
      case "wholeLine":
        for (const s of t.says) if (!squash(text).includes(squash(s))) fail(`"${s}" not in the notice`);
        break;
      case "car": {
        const m = c.text.match(/^(\d{4}) (\S+) (.+)$/);
        const j = await json(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(m[2])}&model=${encodeURIComponent(c.nhtsaModel ?? m[3])}&modelYear=${m[1]}`);
        row.recalls = j?.Count ?? 0;
        row.campaigns = (j?.results ?? []).map((r) => `${r.NHTSACampaignNumber} ${r.ReportReceivedDate}`);
        if (c.expect === "warning" ? row.recalls === 0 : row.recalls > 0) fail(`NHTSA lists ${row.recalls} recalls`);
        break;
      }
      case "clean": {
        const hits = await printedAnywhere(c.codes.at(-1), brand);
        if (hits.length) fail(`${c.codes.at(-1)} printed in ${hits.join(", ")}`);
        break;
      }
      default:
        fail(`no truth spec`);
    }
    if (c.set === "lag") {
      for (const f of c.firms ?? [c.firm]) {
        const reps = await fdaFirmReports(f);
        if (reps.length) fail(`openFDA already has ${reps.join(", ")} from ${f}`);
        else row.notes.push(`openFDA: no report from ${f} since Oct 1`);
      }
    }
  } catch (e) {
    fail(`error: ${e.message}`);
  }
  results.push(row);
  console.log(row.ok ? "ok  " : "FAIL", c.id, c.set.padEnd(8), c.group.padEnd(9), (c.probe ?? "").padEnd(10), row.notes.join("; "), row.recalls ?? "", row.date ?? "");
  await sleep(150);
}
fs.writeFileSync(new URL("verified-holdout2.json", dir), JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + "\n");
console.log(`${results.filter((r) => r.ok).length}/${results.length} verified`);

// How general are the bound rules? Runs noticeBounds() (two-group serial ranges, prefix-plus-number families) and
// dateWindowIn() (best-by and use-by windows) from lib/match.ts over every 2026 CPSC recall and openFDA enforcement
// report, plus the saved held-out notices, and counts the notices that print each kind of bound against those the
// rules parse. GET only, no model, no Tavily. In-sample: the rules were written after held-out set #2.
// Usage: npx tsx --conditions=react-server scripts/bound-coverage.mts [--show 8]  -> docs/bound-coverage.json
import fs from "node:fs";
import path from "node:path";
import { dateWindowIn, flatText, noticeBounds } from "../lib/match.ts";

const show = Number(process.argv[process.argv.indexOf("--show") + 1] || 6);
const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

type Doc = { id: string; text: string };
const docs: Doc[] = [];

const cpsc = (await (await fetch(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${year}-01-01&RecallDateEnd=${today}`)).json()) as {
  RecallNumber: string;
  Title: string;
  Description: string;
  Products?: { Name?: string; Model?: string }[];
}[];
for (const r of cpsc) docs.push({ id: `CPSC ${r.RecallNumber}`, text: `${r.Title}\n${r.Description}\n${(r.Products ?? []).map((p) => `${p.Name ?? ""} ${p.Model ?? ""}`).join("\n")}` });

for (const kind of ["food", "drug", "device"]) {
  for (let skip = 0; skip < 3000; skip += 1000) {
    const u = `https://api.fda.gov/${kind}/enforcement.json?search=report_date:[${year}0101+TO+${today.replace(/-/g, "")}]&limit=1000&skip=${skip}`;
    const j = (await (await fetch(u)).json()) as { results?: { recall_number: string; product_description: string; code_info: string; more_code_info?: string }[] };
    if (!j.results?.length) break;
    for (const r of j.results) docs.push({ id: `FDA ${r.recall_number}`, text: `${r.product_description}\n${r.code_info}\n${r.more_code_info ?? ""}` });
  }
}

const EVAL = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "eval");
for (const dir of ["notices-holdout", "notices-holdout2"]) {
  for (const f of fs.readdirSync(path.join(EVAL, dir))) docs.push({ id: `${dir}/${f}`, text: fs.readFileSync(path.join(EVAL, dir, f), "utf8") });
}

// What counts as printing a bound, broadly (so misses show up), per rule.
const PRINTS = {
  pair: /\bserial.{0,200}?\b(\d{3,6}) \d{3,6}\b.{0,30}?\b\1 \d{3,6}\b/i,
  family: /\b(?:prefix(?:es)?|begin(?:ning|s)? with|start(?:ing|s)? with)\b.{0,80}?\b(?:number|digits?)\b.{0,30}?\d{3,}/i,
  window: /\b(?:best[- ]?(?:by|if used by|before)|use[- ]?by|sell[- ]?by)\b[^.;\n]{0,90}?\b(?:through|thru|until|to|from|between)\b[^.;\n]{0,40}?\d/i,
};

const out: Record<string, { prints: number; parsed: number; missed: { id: string; text: string }[] }> = {};
for (const k of Object.keys(PRINTS) as (keyof typeof PRINTS)[]) out[k] = { prints: 0, parsed: 0, missed: [] };
for (const d of docs) {
  const flat = flatText(d.text);
  const b = noticeBounds(d.text);
  const parsed = { pair: b.pairs.length > 0, family: b.families.length > 0, window: Boolean(dateWindowIn(d.text)) };
  for (const k of Object.keys(PRINTS) as (keyof typeof PRINTS)[]) {
    const m = flat.match(PRINTS[k]);
    if (!m && !parsed[k]) continue;
    out[k].prints++;
    if (parsed[k]) out[k].parsed++;
    else out[k].missed.push({ id: d.id, text: flat.slice(Math.max(0, (m?.index ?? 0) - 40), (m?.index ?? 0) + 200) });
  }
}

const summary = {
  at: today,
  notices: docs.length,
  sources: `CPSC recalls ${year} (${cpsc.length}), openFDA food, drug and device enforcement reports ${year}, eval/notices-holdout and notices-holdout2`,
  rules: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { printsOne: v.prints, parsed: v.parsed, missedExamples: v.missed.slice(0, show) }])),
  note: "In-sample: noticeBounds() and dateWindowIn() were written on Oct 30 after held-out set #2. 'printsOne' is a broad pattern for notices that look like they print that kind of bound; read the missed examples before reading the ratio.",
};
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/bound-coverage.json", JSON.stringify(summary, null, 1) + "\n");
for (const [k, v] of Object.entries(out)) {
  console.log(`${k}: ${v.parsed} of ${v.prints} parsed`);
  for (const m of v.missed.slice(0, show)) console.log(`   miss ${m.id}: ${m.text}`);
}
console.log(`${docs.length} notices`);

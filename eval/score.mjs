// Scores every arm in eval/results against the verified ground truth and writes eval/summary.json (read by the
// /proof page) plus a markdown table on stdout. Usage: node eval/score.mjs
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const { cases } = read("cases.json");
const verified = read("verified.json");
const ok = new Set(verified.results.filter((r) => r.ok).map((r) => r.id));
const truth = cases.filter((c) => ok.has(c.id));

/** Is this tag right for this case? "not-danger" accepts orange and green. */
export const right = (c, level) => (c.expect === "not-danger" ? level === "warning" || level === "inspected" : level === c.expect);
const shouldFlag = (c) => c.expect === "danger" || c.expect === "warning";

const ORDER = ["tagout", "fixed-plan-nano", "rules", "search-ultra", "alone-ultra", "super-readers", "nano-readers", "super-agent", "nano-agent"];
const files = fs.readdirSync(new URL("results/", dir)).filter((f) => f.endsWith(".json"));
const arms = [];
for (const f of files) {
  const res = read(`results/${f}`);
  if (res.config?.kind === "intake") continue;
  const rows = new Map(res.cases.map((r) => [r.id, r]));
  const got = truth.map((c) => ({ c, r: rows.get(c.id) })).filter((x) => x.r);
  if (got.length < truth.length) console.error(`${res.arm}: ${got.length}/${truth.length} cases run`);
  const lv = (x) => x.r.level;
  const pos = got.filter((x) => x.c.expect === "danger");
  const reds = got.filter((x) => lv(x) === "danger");
  const tpRed = reds.filter((x) => x.c.expect === "danger");
  const falseRed = reds.filter((x) => x.c.expect !== "danger");
  const falseClear = got.filter((x) => shouldFlag(x.c) && lv(x) === "inspected");
  const errors = got.filter((x) => lv(x) === "error");
  const exact = got.filter((x) => right(x.c, lv(x)));
  const usd = got.map((x) => x.r.usd ?? 0);
  const ms = got.filter((x) => x.r.msFresh && x.r.calls > 0).map((x) => x.r.ms).sort((a, b) => a - b);
  const byGroup = {};
  for (const g of ["positive", "near-miss", "no-code", "car", "clean"]) {
    const xs = got.filter((x) => x.c.group === g);
    byGroup[g] = { n: xs.length, right: xs.filter((x) => right(x.c, lv(x))).length };
  }
  arms.push({
    arm: res.arm,
    label: res.label,
    n: got.length,
    right: exact.length,
    redPrecision: reds.length ? tpRed.length / reds.length : null,
    redRecall: pos.length ? tpRed.length / pos.length : null,
    reds: reds.length,
    truePositives: tpRed.length,
    positives: pos.length,
    falseRed: falseRed.map((x) => x.c.id),
    falseClear: falseClear.map((x) => x.c.id),
    errors: errors.map((x) => x.c.id),
    byGroup,
    usdPerItem: usd.reduce((a, b) => a + b, 0) / Math.max(1, usd.length),
    usdTotal: usd.reduce((a, b) => a + b, 0),
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    webOnlyReds: tpRed.filter((x) => String(x.r.notice ?? "").startsWith("WEB")).map((x) => x.c.id),
    levels: Object.fromEntries(got.map((x) => [x.c.id, lv(x)])),
  });
}
arms.sort((a, b) => (ORDER.indexOf(a.arm) + 99) % 99 - (ORDER.indexOf(b.arm) + 99) % 99);
// The first run of the full arm, before the fixes it led to (kept in results-first/).
let firstRun = null;
if (fs.existsSync(new URL("results-first/tagout.json", dir))) {
  const f = read("results-first/tagout.json");
  const rows = new Map(f.cases.map((r) => [r.id, r]));
  const xs = truth.map((c) => ({ c, r: rows.get(c.id) })).filter((x) => x.r);
  firstRun = {
    at: f.at,
    right: xs.filter((x) => right(x.c, x.r.level)).length,
    n: xs.length,
    falseRed: xs.filter((x) => x.r.level === "danger" && x.c.expect !== "danger").map((x) => x.c.id),
    falseClear: xs.filter((x) => shouldFlag(x.c) && x.r.level === "inspected").map((x) => x.c.id),
    wrong: xs.filter((x) => !right(x.c, x.r.level)).map((x) => ({ id: x.c.id, level: x.r.level })),
  };
}
const summary = { at: new Date().toISOString(), firstRun, cases: truth.length, groups: Object.fromEntries(["positive", "near-miss", "no-code", "car", "clean"].map((g) => [g, truth.filter((c) => c.group === g).length])), arms };
fs.writeFileSync(new URL("summary.json", dir), JSON.stringify(summary, null, 1) + "\n");

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
console.log(`| Arm | Right | Red precision | Red recall | Wrongly red | Wrongly cleared | Cost per item | Median time |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const a of arms) {
  console.log(`| ${a.label} | ${a.right}/${a.n} | ${pct(a.redPrecision)} (${a.truePositives}/${a.reds}) | ${pct(a.redRecall)} (${a.truePositives}/${a.positives}) | ${a.falseRed.length} | ${a.falseClear.length} | ${a.usdPerItem ? `${(a.usdPerItem * 100).toFixed(2)}¢` : "0¢"} | ${a.medianMs ? `${(a.medianMs / 1000).toFixed(1)} s` : "–"} |`);
}
for (const a of arms) console.log(`${a.arm}: wrongly red ${a.falseRed.join(" ") || "-"}; wrongly cleared ${a.falseClear.join(" ") || "-"}; errors ${a.errors.join(" ") || "-"}; web-only reds ${a.webOnlyReds.join(" ") || "-"}`);

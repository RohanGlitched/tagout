// Scores every arm in a results directory against the verified ground truth and writes a summary (by default
// eval/summary.json, read by the /proof page) plus a markdown table on stdout.
// Usage: node eval/score.mjs [--cases cases.json] [--verified verified.json] [--results results] [--out summary.json]
//                            [--first results-first/tagout.json | --first none]
// Held-out: node eval/score.mjs --cases cases-holdout.json --verified verified-holdout.json --results results-holdout --out holdout-summary.json --first none
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const CASES = opt("cases", "cases.json");
const VERIFIED = opt("verified", "verified.json");
const RESULTS = opt("results", "results").replace(/\/?$/, "/");
const OUT = opt("out", "summary.json");
const FIRST = opt("first", "results-first/tagout.json");
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const { cases } = read(CASES);
const verified = read(VERIFIED);
const ok = new Set(verified.results.filter((r) => r.ok).map((r) => r.id));
const truth = cases.filter((c) => ok.has(c.id));

/** Tavily pay-as-you-go price per API credit (docs.tavily.com, API credits page, checked Oct 25 2026). A basic
 *  search is 1 credit; a basic extract is 1 credit per 5 successful URLs, and Tagout sends one URL per extract, so
 *  each extract call is counted as 1 credit (an upper bound: a failed extract costs nothing). */
export const TAVILY_USD_PER_CREDIT = 0.008;

/** Is this tag right for this case? "not-danger" accepts orange and green; "flag" accepts orange and red. */
export const right = (c, level) =>
  c.expect === "not-danger" ? level === "warning" || level === "inspected" : c.expect === "flag" ? level === "warning" || level === "danger" : level === c.expect;
const shouldFlag = (c) => c.expect === "danger" || c.expect === "warning" || c.expect === "flag";

// Exact (Clopper-Pearson) 95% interval for k successes in n.
const lnGamma = (z) => {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, t = z + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
};
const binom = (k, n, p) => Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
const cdf = (k, n, p) => {
  let s = 0;
  for (let i = 0; i <= k; i++) s += binom(i, n, p);
  return s;
};
const solve = (f) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
};
export function interval(k, n) {
  if (!n) return null;
  const lower = k === 0 ? 0 : solve((p) => 1 - cdf(k - 1, n, p) >= 0.025);
  const upper = k === n ? 1 : solve((p) => cdf(k, n, p) <= 0.025);
  return [Number(lower.toFixed(3)), Number(upper.toFixed(3))];
}

const ORDER = ["tagout", "fixed-plan", "fixed-plan-nano", "rules", "search-ultra", "alone-ultra", "super-readers", "nano-readers", "super-agent", "nano-agent"];
const rank = (arm) => {
  const base = arm.replace(/-noweb$/, "");
  const i = ORDER.indexOf(base);
  return (i < 0 ? 99 : i) * 2 + (arm.endsWith("-noweb") ? 1 : 0);
};
const GROUPS = [...new Set(["positive", "near-miss", "no-code", "car", "clean", ...truth.map((c) => c.group)])].filter((g) => truth.some((c) => c.group === g));
const files = fs.existsSync(new URL(RESULTS, dir)) ? fs.readdirSync(new URL(RESULTS, dir)).filter((f) => f.endsWith(".json")) : [];
const arms = [];
for (const f of files) {
  const res = read(`${RESULTS}${f}`);
  if (res.config?.kind === "intake") continue;
  const rows = new Map(res.cases.map((r) => [r.id, r]));
  const got = truth.map((c) => ({ c, r: rows.get(c.id) })).filter((x) => x.r);
  if (got.length < truth.length) console.error(`${res.arm}: ${got.length}/${truth.length} cases run`);
  const lv = (x) => x.r.level;
  const pos = got.filter((x) => x.c.expect === "danger");
  const reds = got.filter((x) => lv(x) === "danger");
  const tpRed = reds.filter((x) => x.c.expect === "danger");
  const notRed = got.filter((x) => x.c.expect !== "danger" && x.c.expect !== "flag");
  const falseRed = reds.filter((x) => x.c.expect !== "danger" && x.c.expect !== "flag");
  const flagged = got.filter((x) => shouldFlag(x.c));
  const falseClear = flagged.filter((x) => lv(x) === "inspected");
  const errors = got.filter((x) => lv(x) === "error");
  const exact = got.filter((x) => right(x.c, lv(x)));
  const usd = got.map((x) => x.r.usd ?? 0);
  const tav = got.map((x) => (x.r.tavilySearch ?? 0) + (x.r.tavilyExtract ?? 0) || x.r.tavily || 0);
  const ms = got.filter((x) => x.r.msFresh && x.r.calls > 0).map((x) => x.r.ms).sort((a, b) => a - b);
  const byGroup = {};
  for (const g of GROUPS) {
    const xs = got.filter((x) => x.c.group === g);
    byGroup[g] = { n: xs.length, right: xs.filter((x) => right(x.c, lv(x))).length };
  }
  const by = (key) => {
    const vals = [...new Set(got.map((x) => x.c[key]).filter(Boolean))];
    if (!vals.length) return undefined;
    return Object.fromEntries(
      vals.map((v) => {
        const xs = got.filter((x) => x.c[key] === v);
        return [v, { n: xs.length, right: xs.filter((x) => right(x.c, lv(x))).length, falseRed: xs.filter((x) => lv(x) === "danger" && x.c.expect !== "danger" && x.c.expect !== "flag").map((x) => x.c.id), falseClear: xs.filter((x) => shouldFlag(x.c) && lv(x) === "inspected").map((x) => x.c.id) }];
      }),
    );
  };
  const usdPerItem = usd.reduce((a, b) => a + b, 0) / Math.max(1, usd.length);
  const tavilyPerItem = tav.reduce((a, b) => a + b, 0) / Math.max(1, tav.length);
  arms.push({
    arm: res.arm,
    label: res.label,
    n: got.length,
    right: exact.length,
    rightInterval: interval(exact.length, got.length),
    redPrecision: reds.length ? tpRed.length / reds.length : null,
    redRecall: pos.length ? tpRed.length / pos.length : null,
    redRecallInterval: interval(tpRed.length, pos.length),
    reds: reds.length,
    truePositives: tpRed.length,
    positives: pos.length,
    falseRed: falseRed.map((x) => x.c.id),
    falseRedOf: notRed.length,
    falseRedInterval: interval(falseRed.length, notRed.length),
    falseClear: falseClear.map((x) => x.c.id),
    falseClearOf: flagged.length,
    falseClearInterval: interval(falseClear.length, flagged.length),
    errors: errors.map((x) => x.c.id),
    byGroup,
    ...(by("set") ? { bySet: by("set") } : {}),
    ...(by("form") ? { byForm: by("form") } : {}),
    usdPerItem,
    usdTotal: usd.reduce((a, b) => a + b, 0),
    tavilyPerItem,
    tavilyUsdPerItem: tavilyPerItem * TAVILY_USD_PER_CREDIT,
    usdPerItemWithTavily: usdPerItem + tavilyPerItem * TAVILY_USD_PER_CREDIT,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    webOnlyReds: tpRed.filter((x) => String(x.r.notice ?? "").startsWith("WEB")).map((x) => x.c.id),
    webCited: got.filter((x) => String(x.r.notice ?? "").startsWith("WEB")).map((x) => x.c.id),
    // The agent failed and the fixed plan answered (only meaningful for arms that use the agent).
    fellBack: res.config?.useAgent === false ? [] : got.filter((x) => (x.r.planned ?? x.r.engine?.planned) === "fixed").map((x) => x.c.id),
    ...(res.config?.offline ? { cacheMisses: got.filter((x) => x.r.cacheMisses).map((x) => x.c.id) } : {}),
    config: res.config ? { today: res.config.today, noWeb: res.config.noWeb ?? false, offline: res.config.offline ?? false, keyless: res.config.keyless ?? false, code: res.config.code } : undefined,
    levels: Object.fromEntries(got.map((x) => [x.c.id, lv(x)])),
  });
}
arms.sort((a, b) => rank(a.arm) - rank(b.arm));
// The first run of the full arm, before the fixes it led to (kept in results-first/).
let firstRun = null;
if (FIRST !== "none" && fs.existsSync(new URL(FIRST, dir))) {
  const f = read(FIRST);
  const rows = new Map(f.cases.map((r) => [r.id, r]));
  const xs = truth.map((c) => ({ c, r: rows.get(c.id) })).filter((x) => x.r);
  firstRun = {
    at: f.at,
    right: xs.filter((x) => right(x.c, x.r.level)).length,
    n: xs.length,
    falseRed: xs.filter((x) => x.r.level === "danger" && x.c.expect !== "danger" && x.c.expect !== "flag").map((x) => x.c.id),
    falseClear: xs.filter((x) => shouldFlag(x.c) && x.r.level === "inspected").map((x) => x.c.id),
    wrong: xs.filter((x) => !right(x.c, x.r.level)).map((x) => ({ id: x.c.id, level: x.r.level })),
  };
}
const summary = { at: new Date().toISOString(), firstRun, cases: truth.length, groups: Object.fromEntries(GROUPS.map((g) => [g, truth.filter((c) => c.group === g).length])), arms };
fs.writeFileSync(new URL(OUT, dir), JSON.stringify(summary, null, 1) + "\n");

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
console.log(`| Arm | Right | Red precision | Red recall | Wrongly red | Wrongly cleared | Cost per item (TF) | Tavily credits per item | Median time |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const a of arms) {
  console.log(`| ${a.label} | ${a.right}/${a.n} | ${pct(a.redPrecision)} (${a.truePositives}/${a.reds}) | ${pct(a.redRecall)} (${a.truePositives}/${a.positives}) | ${a.falseRed.length}/${a.falseRedOf} | ${a.falseClear.length}/${a.falseClearOf} | ${a.usdPerItem ? `${(a.usdPerItem * 100).toFixed(2)}¢` : "0¢"} | ${a.tavilyPerItem.toFixed(2)} | ${a.medianMs ? `${(a.medianMs / 1000).toFixed(1)} s` : "–"} |`);
}
for (const a of arms) console.log(`${a.arm}: wrongly red ${a.falseRed.join(" ") || "-"}; wrongly cleared ${a.falseClear.join(" ") || "-"}; errors ${a.errors.join(" ") || "-"}; web-only reds ${a.webOnlyReds.join(" ") || "-"}; fell back ${a.fellBack.join(" ") || "-"}${a.cacheMisses ? `; cache misses ${a.cacheMisses.length}` : ""}`);

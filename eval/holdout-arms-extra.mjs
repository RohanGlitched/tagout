// Two arms on the 39 held-out cases that need no new calls: the rules-only arm (replayed offline from the eval
// cache) and a "lite first, Ultra only on red" cascade combined from the recorded lite and Tagout rows. Writes
// eval/holdout-arms-extra.json.  Usage: node eval/holdout-arms-extra.mjs
//
// The rules arm comes from `npx tsx --conditions=react-server eval/run.ts rules --offline --cases cases-holdout.json
// --results results-holdout-extra --today 2026-10-25` (run that first). Its pattern reader reads different items
// from Ultra's, so some of its searches were never cached: those fail as an unreachable API would and are listed.
//
// The cascade: every item runs on the lite tier (fixed plan, Nano reader); an item the lite tier tags red is run
// again on the full agent (Ultra) and takes that tag. Its cost is the lite cost for every item plus the full cost
// for the escalated ones. It is computed from the first run (a1d8b21, the real held-out measurement), from the
// re-run at the current code (results-holdout-after/, in-sample), and on the 105 tuned cases (results-after/).
import fs from "node:fs";

// The same scoring as score.mjs (copied: importing score.mjs would run it and rewrite summary.json).
const TAVILY_USD_PER_CREDIT = 0.008;
/** Is this tag right for this case? "not-danger" accepts orange and green; "flag" accepts orange and red. */
const right = (c, level) =>
  c.expect === "not-danger" ? level === "warning" || level === "inspected" : c.expect === "flag" ? level === "warning" || level === "danger" : level === c.expect;
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
function interval(k, n) {
  if (!n) return null;
  const lower = k === 0 ? 0 : solve((p) => 1 - cdf(k - 1, n, p) >= 0.025);
  const upper = k === n ? 1 : solve((p) => cdf(k, n, p) <= 0.025);
  return [Number(lower.toFixed(3)), Number(upper.toFixed(3))];
}


const dir = new URL(".", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const truthOf = (casesFile, verifiedFile) => {
  const ok = new Set(read(verifiedFile).results.filter((r) => r.ok).map((r) => r.id));
  return read(casesFile).cases.filter((c) => ok.has(c.id));
};
const HELD = truthOf("cases-holdout.json", "verified-holdout.json");
const TUNED = truthOf("cases.json", "verified.json");
const shouldFlag = (c) => c.expect === "danger" || c.expect === "warning" || c.expect === "flag";
const credits = (r) => r.tavilyCredits ?? ((r.tavilySearch ?? 0) + (r.tavilyExtract ?? 0) || r.tavily || 0);

/** Scores rows {id, level, usd, credits} the way score.mjs does. */
function score(rows, truth = HELD) {
  const by = new Map(rows.map((r) => [r.id, r]));
  const got = truth.map((c) => ({ c, r: by.get(c.id) })).filter((x) => x.r);
  const lv = (x) => x.r.level;
  const falseRed = got.filter((x) => lv(x) === "danger" && x.c.expect !== "danger" && x.c.expect !== "flag").map((x) => x.c.id);
  const falseClear = got.filter((x) => shouldFlag(x.c) && lv(x) === "inspected").map((x) => x.c.id);
  const exact = got.filter((x) => right(x.c, lv(x)));
  const set = (s) => {
    const xs = got.filter((x) => x.c.set === s);
    return `${xs.filter((x) => right(x.c, lv(x))).length}/${xs.length}`;
  };
  const usd = got.reduce((a, x) => a + (x.r.usd ?? 0), 0) / got.length;
  const tav = got.reduce((a, x) => a + (x.r.credits ?? 0), 0) / got.length;
  return {
    n: got.length,
    right: exact.length,
    rightInterval: interval(exact.length, got.length),
    falseRed,
    falseRedOf: got.filter((x) => x.c.expect !== "danger" && x.c.expect !== "flag").length,
    falseClear,
    falseClearOf: got.filter((x) => shouldFlag(x.c)).length,
    ...(truth === HELD ? { database: set("database"), lag: set("lag") } : {}),
    wrong: got.filter((x) => !right(x.c, lv(x))).map((x) => `${x.c.id} ${lv(x)} (want ${x.c.expect})`),
    usdPerItem: Number(usd.toFixed(5)),
    tavilyPerItem: Number(tav.toFixed(2)),
    usdPerItemWithTavily: Number((usd + tav * TAVILY_USD_PER_CREDIT).toFixed(5)),
  };
}

const rowsOf = (file) => read(file).cases.map((r) => ({ id: r.id, level: r.level, usd: r.usd ?? 0, credits: credits(r), cacheMisses: r.cacheMisses, missed: r.missed }));

function cascade(liteFile, fullFile, truth = HELD) {
  const lite = new Map(rowsOf(liteFile).map((r) => [r.id, r]));
  const full = new Map(rowsOf(fullFile).map((r) => [r.id, r]));
  const escalated = [];
  const rows = [...lite.values()].map((l) => {
    const f = full.get(l.id);
    if (l.level !== "danger" || !f) return l;
    escalated.push(`${l.id} ${l.level}→${f.level}`);
    return { id: l.id, level: f.level, usd: l.usd + f.usd, credits: l.credits + f.credits };
  });
  // Where the full agent and the lite tier differ, and which one was right.
  const agentVsLite = { agentRight: [], liteRight: [] };
  for (const c of truth) {
    const l = lite.get(c.id), f = full.get(c.id);
    if (!l || !f || l.level === f.level) continue;
    if (right(c, f.level) && !right(c, l.level)) agentVsLite.agentRight.push(`${c.id} ${f.level} (lite ${l.level})`);
    if (right(c, l.level) && !right(c, f.level)) agentVsLite.liteRight.push(`${c.id} ${l.level} (agent ${f.level})`);
  }
  return {
    from: { lite: liteFile, full: fullFile, commit: read(liteFile).config?.code?.commit },
    ...score(rows, truth),
    escalated,
    lite: score([...lite.values()], truth),
    full: score([...full.values()], truth),
    agentVsLite,
  };
}

const rulesRows = rowsOf("results-holdout-extra/rules.json");
const exactRules = rulesRows.filter((r) => !r.cacheMisses);
const out = {
  at: new Date().toISOString(),
  note: "No new model or Tavily calls: the rules arm is an offline replay from eval/.cache, the cascade is combined from recorded rows. The first-run cascade is the held-out measurement; the current-code one is in-sample (these cases were read while fixing).",
  rules: {
    label: "No model at all: fixed plan, pattern reader, rules (and never green without a model)",
    commit: read("results-holdout-extra/rules.json").config?.code?.commit,
    replay: "offline from the eval cache; a call the cache doesn't have fails as an unreachable API would",
    ...score(rulesRows),
    casesWithMisses: rulesRows.filter((r) => r.cacheMisses).map((r) => r.id),
    missedCalls: [...new Set(rulesRows.flatMap((r) => r.missed ?? []))],
    onExactReplays: { cases: exactRules.length, ...score(exactRules) },
  },
  cascade: {
    label: "Lite tier first; an item the lite tier tags red is run on the full agent (Ultra) and takes its tag",
    firstRun: cascade("results-holdout/fixed-plan-nano.json", "results-holdout/tagout.json"),
    current: cascade("results-holdout-after/fixed-plan-nano.json", "results-holdout-after/tagout.json"),
    // The same cascade on the 105 tuned cases at the current code (in-sample, from results-after/).
    tuned105: cascade("results-after/fixed-plan-nano.json", "results-after/tagout.json", TUNED),
  },
  routing: {
    firstCheck: "Full agent (Ultra): the most right and none cleared; a first check is when an unknown item is most likely to hide a recall.",
    recheck: "The daily sweep: each new recall is read once and matched by rules against every watched item, so a re-check costs nothing per household until a recall names a watched brand or code.",
    resale: "Cascade: lite tier for every listing, the full agent only on red, so a red tag on a listing is confirmed by the agent before it costs a sale; greens and oranges cost the lite price.",
  },
};
fs.writeFileSync(new URL("holdout-arms-extra.json", dir), JSON.stringify(out, null, 1) + "\n");
const line = (name, s) => console.log(`${name.padEnd(28)} ${s.right}/${s.n}  wrongly red ${s.falseRed.length}/${s.falseRedOf} [${s.falseRed}]  cleared ${s.falseClear.length}/${s.falseClearOf} [${s.falseClear}]  ${s.database ? `db ${s.database}  lag ${s.lag}  ` : ""}${(s.usdPerItem * 100).toFixed(2)}¢ + ${s.tavilyPerItem} credits = ${(s.usdPerItemWithTavily * 100).toFixed(2)}¢`);
line("rules (offline replay)", out.rules);
line(`rules, ${exactRules.length} exact replays`, out.rules.onExactReplays);
for (const k of ["firstRun", "current", "tuned105"]) {
  const c = out.cascade[k];
  line(`lite ${k}`, c.lite);
  line(`full ${k}`, c.full);
  line(`cascade ${k}`, c);
  console.log(`   escalated ${c.escalated.length}: ${c.escalated.join(", ")}`);
  console.log(`   agent right, lite wrong: ${c.agentVsLite.agentRight.join(", ") || "-"}; lite right, agent wrong: ${c.agentVsLite.liteRight.join(", ") || "-"}`);
}

// Adds the Tavily ablation and the run facts to eval/holdout-summary.json (written first by `npm run
// eval:holdout:score`). Usage: node eval/holdout-report.mjs
// For each arm that also ran with Tavily off (<arm>-noweb), it lists the cases whose tag changed, and how many of
// the lag-window recalls (only on the web) each variant flagged or cleared.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const summary = read("holdout-summary.json");
const { cases } = read("cases-holdout.json");
const byId = new Map(cases.map((c) => [c.id, c]));
const right = (c, level) =>
  c.expect === "not-danger" ? level === "warning" || level === "inspected" : c.expect === "flag" ? level === "warning" || level === "danger" : level === c.expect;
const flagged = (c) => c.expect === "danger" || c.expect === "warning" || c.expect === "flag";

const ablation = {};
for (const a of summary.arms.filter((x) => !x.arm.endsWith("-noweb"))) {
  const off = summary.arms.find((x) => x.arm === `${a.arm}-noweb`);
  if (!off) continue;
  const ids = Object.keys(a.levels).filter((id) => id in off.levels);
  const lag = ids.filter((id) => byId.get(id).set === "lag");
  const lagFlag = lag.filter((id) => flagged(byId.get(id)));
  const count = (levels, xs, f) => xs.filter((id) => f(byId.get(id), levels[id])).length;
  ablation[a.arm] = {
    withTavily: { right: count(a.levels, ids, right), n: ids.length },
    withoutTavily: { right: count(off.levels, ids, right), n: ids.length },
    lag: {
      n: lag.length,
      shouldFlag: lagFlag.length,
      withTavily: { right: count(a.levels, lag, right), flagged: lagFlag.filter((id) => a.levels[id] !== "inspected").length, red: lag.filter((id) => byId.get(id).expect === "danger" && a.levels[id] === "danger").length },
      withoutTavily: { right: count(off.levels, lag, right), flagged: lagFlag.filter((id) => off.levels[id] !== "inspected").length, red: lag.filter((id) => byId.get(id).expect === "danger" && off.levels[id] === "danger").length },
      positives: lag.filter((id) => byId.get(id).expect === "danger").length,
    },
    // Cases whose tag differs, and whether Tavily helped (right only with it) or hurt (right only without it).
    changed: ids
      .filter((id) => a.levels[id] !== off.levels[id])
      .map((id) => ({ id, set: byId.get(id).set, expect: byId.get(id).expect, withTavily: a.levels[id], withoutTavily: off.levels[id], effect: right(byId.get(id), a.levels[id]) && !right(byId.get(id), off.levels[id]) ? "helped" : !right(byId.get(id), a.levels[id]) && right(byId.get(id), off.levels[id]) ? "hurt" : "neither" })),
  };
}
summary.tavilyAblation = ablation;
summary.meta = read("holdout-meta.json");
fs.writeFileSync(new URL("holdout-summary.json", dir), JSON.stringify(summary, null, 1) + "\n");
for (const [arm, x] of Object.entries(ablation)) {
  console.log(`${arm}: with Tavily ${x.withTavily.right}/${x.withTavily.n}, without ${x.withoutTavily.right}/${x.withoutTavily.n}; lag window: flagged ${x.lag.withTavily.flagged}/${x.lag.shouldFlag} with, ${x.lag.withoutTavily.flagged}/${x.lag.shouldFlag} without; red ${x.lag.withTavily.red}/${x.lag.positives} with, ${x.lag.withoutTavily.red}/${x.lag.positives} without`);
  for (const c of x.changed) console.log(`  ${c.id} ${c.set} want ${c.expect}: ${c.withTavily} with, ${c.withoutTavily} without (${c.effect})`);
}

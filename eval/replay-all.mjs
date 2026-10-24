// Replays the eval offline against the current code, from eval/.cache only (no network, no keys, no spend), scores
// the replay and compares it with the recorded results.  Usage: npm run eval:replay [-- --holdout] [-- --arms a,b]
//
// Each arm re-runs with run.ts --offline into results-replay/ (or results-holdout-replay/), then score.mjs writes
// replay-summary.json (or holdout-replay-summary.json). A case "replays exactly" when every Token Factory and
// Tavily call it makes is in the cache. Agency calls that miss (openFDA's "has this firm reported lately" check,
// added after the Oct 15 run) fail as an unreachable API would; that check only adds an "ahead of the database"
// badge, never a tag. Cases whose model calls miss are listed: the code changed under them since the recorded run,
// and they need live calls to re-measure. Exit code 1 if any tag differs from the committed replay summary.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EVAL = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const HOLDOUT = args.includes("--holdout");
const cfg = HOLDOUT
  ? { cases: "cases-holdout.json", verified: "verified-holdout.json", recorded: "results-holdout", out: "results-holdout-replay", summary: "holdout-replay-summary.json", today: "2026-10-25" }
  : { cases: "cases.json", verified: "verified.json", recorded: "results", out: "results-replay", summary: "replay-summary.json", today: "2026-10-15" };
const recordedDir = path.join(EVAL, cfg.recorded);
if (!fs.existsSync(path.join(EVAL, ".cache", "http")) && !process.env.EVAL_CACHE) {
  console.error("No eval/.cache/http here. The cache is not in git; see eval/HOLDOUT.md for how to get it.");
  process.exit(2);
}
// Every recorded pipeline or ask arm, plus the Tavily-off variants that replay for free.
const recorded = fs.readdirSync(recordedDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(recordedDir, f), "utf8")));
const only = args.includes("--arms") ? args[args.indexOf("--arms") + 1].split(",") : null;
const runs = recorded
  .filter((r) => r.config?.kind !== "intake" && !r.config?.offline)
  .map((r) => ({ arm: r.arm, base: r.arm.replace(/-noweb$/, ""), noWeb: r.arm.endsWith("-noweb"), today: r.config?.today ?? cfg.today, ids: r.cases.map((c) => c.id) }))
  .filter((r) => !only || only.includes(r.arm));
if (!HOLDOUT && !only) runs.push({ arm: "rules-noweb", base: "rules", noWeb: true, today: cfg.today });

// The committed replay, read before this run overwrites it.
const baselineSummary = fs.existsSync(path.join(EVAL, cfg.summary)) ? JSON.parse(fs.readFileSync(path.join(EVAL, cfg.summary), "utf8")) : null;
const tsx = process.platform === "win32" ? "npx.cmd" : "npx";
for (const r of runs) {
  fs.rmSync(path.join(EVAL, cfg.out, `${r.arm}.json`), { force: true });
  const a = ["tsx", "--conditions=react-server", path.join(EVAL, "run.ts"), r.base, "--offline", "--cases", cfg.cases, "--results", cfg.out, "--today", r.today, "--concurrency", "4", ...(r.noWeb ? ["--no-web"] : []), ...(r.ids ? ["--only", r.ids.join(",")] : [])];
  const p = spawnSync(tsx, a, { cwd: path.join(EVAL, ".."), encoding: "utf8", shell: process.platform === "win32" });
  const last = (p.stdout ?? "").trim().split("\n").at(-1);
  console.log(`${r.arm.padEnd(18)} ${last ?? p.stderr?.slice(0, 200)}`);
}
const s = spawnSync(process.execPath, [path.join(EVAL, "score.mjs"), "--cases", cfg.cases, "--verified", cfg.verified, "--results", cfg.out, "--out", cfg.summary, "--first", "none"], { encoding: "utf8" });
if (s.status) console.error(s.stderr);

// Compare with the recorded run (information: the code may have changed since) and with the committed replay
// (a regression check: the same code and cache must give the same tags, so any change there fails the run).
const baseline = baselineSummary?.arms ? new Map(baselineSummary.arms.map((a) => [a.arm, a.levels])) : null;
let drift = 0;
console.log("\nArm                 recorded  replayed  exact  needs live calls  changed since the recorded run  changed since the committed replay");
for (const r of runs) {
  const rec = recorded.find((x) => x.arm === r.arm);
  const rep = JSON.parse(fs.readFileSync(path.join(EVAL, cfg.out, `${r.arm}.json`), "utf8"));
  const sum = JSON.parse(fs.readFileSync(path.join(EVAL, cfg.summary), "utf8")).arms.find((x) => x.arm === r.arm);
  const recRows = new Map((rec?.cases ?? []).map((c) => [c.id, c]));
  const modelMiss = (c) => (c.missed ?? []).some((m) => /tokenfactory|tavily/.test(m));
  const exact = rep.cases.filter((c) => !modelMiss(c));
  const changed = exact.filter((c) => recRows.has(c.id) && recRows.get(c.id).level !== c.level).map((c) => `${c.id} ${recRows.get(c.id).level}→${c.level}`);
  const before = baseline?.get(r.arm);
  const regressed = before ? rep.cases.filter((c) => before[c.id] && before[c.id] !== c.level).map((c) => `${c.id} ${before[c.id]}→${c.level}`) : [];
  drift += regressed.length;
  const recRight = rec ? JSON.parse(fs.readFileSync(path.join(EVAL, HOLDOUT ? "holdout-summary.json" : "summary.json"), "utf8")).arms.find((x) => x.arm === r.arm)?.right : null;
  console.log(`${r.arm.padEnd(18)}  ${String(recRight ?? "–").padStart(6)}  ${String(sum?.right ?? "–").padStart(8)}  ${String(exact.length).padStart(5)}  ${rep.cases.filter(modelMiss).map((c) => c.id).join(" ") || "-"}  ${changed.join(", ") || "-"}  ${before ? regressed.join(", ") || "-" : "(no committed replay)"}`);
}
console.log(`\nWrote ${cfg.out}/ and ${cfg.summary}.${drift ? ` ${drift} case(s) changed tag since the committed replay.` : baseline ? " Every case matches the committed replay." : ""}`);
process.exit(drift ? 1 : 0);

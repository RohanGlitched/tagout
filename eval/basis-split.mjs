// What decided each red tag, at the current code: copies the per-red `basis` split (score.mjs redBasis) from the
// offline replays into summary-current.json (the 105) and holdout-after-fixes.json (the 39), for the Tagout and
// lite-tier arms, after checking that the replay gives the same tag as the recorded run on every case.
// Usage: npm run eval:replay && npm run eval:replay -- --holdout && node eval/basis-split.mjs   (free: no network)
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
const write = (f, j) => fs.writeFileSync(new URL(f, dir), JSON.stringify(j, null, 1) + "\n");

const NOTE =
  "redBasis: what decided each red tag, from an offline replay of this arm at the current code (eval:replay), which gives the same tag as the recorded run on every case. by: reader-list = the code is in a model, lot or UPC list Nemotron's notice reader read; record-list = in the agency record's own field or its deterministic parse (openFDA code_info lots, UPCs and NDCs in the description); text = only in the notice's text (the matcher's fallback). how: exact, range (inside a printed range) or family (a family code). window: a made-date window was checked too. Every code a reader lists is also printed in the notice (lib/agent/verify-codes.ts), so reader-list says which path decided, not that only the reader could find it: the no-model arm (record-list and text only) is the comparison.";

let bad = 0;
for (const [target, replay] of [
  ["summary-current.json", "replay-summary.json"],
  ["holdout-after-fixes.json", "holdout-replay-summary.json"],
]) {
  const t = read(target);
  const r = read(replay);
  for (const arm of ["tagout", "fixed-plan-nano"]) {
    const a = t.arms.find((x) => x.arm === arm);
    const b = r.arms.find((x) => x.arm === arm);
    if (!a || !b?.redBasis) {
      console.error(`${target} ${arm}: no replay basis`);
      bad++;
      continue;
    }
    const moved = Object.keys(a.levels).filter((id) => b.levels[id] !== a.levels[id]);
    if (moved.length) {
      console.error(`${target} ${arm}: the replay differs on ${moved.join(" ")}; basis not copied`);
      bad++;
      continue;
    }
    a.redBasis = { ...b.redBasis, from: replay, code: b.config?.code };
    console.log(`${target} ${arm}: ${a.right}/${a.n}, ${b.redBasis.n} reds: ${JSON.stringify(b.redBasis.by)} ${JSON.stringify(b.redBasis.how)} window ${b.redBasis.window}`);
  }
  t.redBasisNote = NOTE;
  write(target, t);
}
process.exit(bad ? 1 : 0);

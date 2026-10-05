// Runs one check from the command line and prints its events. Usage: npx tsx --conditions=react-server scripts/try-check.ts "line1\nline2" [--fixed]
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^"(.*)"$/, "$1"); }
const { runCheck } = await import("../lib/agent/run.ts");
// The shell passes "\n" as a backslash and an n; turn those into real line breaks.
const text = (process.argv[2] ?? "").split(String.raw`\n`).join("\n");
const t0 = Date.now();
for await (const e of runCheck({ text, photos: [] }, !process.argv.includes("--fixed"))) {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
  if (e.t === "items") console.log(s, "ITEMS", JSON.stringify(e.items), "dropped", e.dropped, JSON.stringify(e.engine));
  else if (e.t === "step") console.log(s, "STEP", e.step.itemId, e.step.label, "→", e.step.found, e.step.error ?? "", `${e.step.ms}ms`);
  else if (e.t === "read") console.log(s, "READ", e.itemId, e.noticeId, "codes", e.codes, "struck", e.struck);
  else if (e.t === "verdict") console.log(s, "VERDICT", e.verdict.itemId, e.verdict.level, "|", e.verdict.headline, "|", e.verdict.notice?.id ?? "", JSON.stringify(e.verdict.proof), "\n        steps:", JSON.stringify(e.verdict.steps).slice(0, 400), "\n        related:", (e.verdict.related ?? []).map((n) => n.id).join(","));
  else console.log(s, e.t.toUpperCase(), JSON.stringify(e).slice(0, 300));
}

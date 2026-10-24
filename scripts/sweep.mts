// The daily recall sweep as a standalone job (a Nebius AI Cloud Serverless Job, cron on any box, or a laptop).
//
//   npx tsx --conditions=react-server scripts/sweep.mts [options]
//
//   --dry             measure only: write no events, state or report
//   --no-model        no Token Factory calls (recalls that would need reading are counted, not read)
//   --no-tavily       skip the Tavily searches (CPSC newsroom fallback, USDA FSIS)
//   --max-reads=N     fresh notice reads allowed this run (default 40)
//   --lookback=D      days of recalls to consider (default 30)
//   --prefix=P/       write under P/ (e.g. sweep-test/) instead of the production keys
//   --watch=ID[,ID]   only these watches
//   --gcloud          get a GCS access token from the gcloud CLI (local trial runs)
//   --remote          don't sweep here: call the deployed cron route with CRON_SECRET (SWEEP_URL overrides the URL)
//
// Env: NEBIUS_API_KEY, TAVILY_API_KEY (optional), GCS_BUCKET plus GCS_SA_KEY or GCS_ACCESS_TOKEN (or
// BLOB_READ_WRITE_TOKEN); without a store the sweep reads and writes .data/. Values already in the environment
// win; otherwise .env.local and ../.env.keys are read. Key values are never printed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const opt = (f: string) => args.find((a) => a.startsWith(`--${f}=`))?.slice(f.length + 3);

for (const file of [".env.local", path.join("..", ".env.keys")]) {
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const m = raw.replace(/\r$/, "").match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\r/g, "");
  }
}
// A laptop's leftover Vercel dev token is not a way into the bucket.
delete process.env.VERCEL_OIDC_TOKEN;

if (flag("remote")) {
  const url = process.env.SWEEP_URL || "https://tagout-recalls.vercel.app/api/cron/sweep";
  if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not set");
  const r = await fetch(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(320_000) });
  console.log(`HTTP ${r.status}`);
  console.log(await r.text());
  process.exit(r.ok ? 0 : 1);
}

const prefix = opt("prefix");
if (prefix !== undefined) process.env.SWEEP_PREFIX = prefix;
if (flag("gcloud")) {
  process.env.GCS_BUCKET ||= "tagout-checks-1948";
  const win = process.platform === "win32";
  process.env.GCS_ACCESS_TOKEN = execFileSync(win ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], { encoding: "utf8", shell: win }).trim();
}
// Without a store the read cache lives in .data/ too, so a local re-run doesn't read the same notice twice.
if (!process.env.GCS_BUCKET && !process.env.BLOB_READ_WRITE_TOKEN) process.env.TAGOUT_READ_CACHE ||= "local";

// The library logs each model call with console.log; keep stdout for the report alone.
const print = console.log.bind(console);
console.log = (...a: unknown[]) => console.error(...a);

const { runSweep } = await import("../lib/sweep/run.ts");
const report = await runSweep({
  dryRun: flag("dry"),
  useModel: !flag("no-model"),
  tavily: flag("no-tavily") ? false : undefined,
  maxReads: opt("max-reads") ? Number(opt("max-reads")) : undefined,
  lookbackDays: opt("lookback") ? Number(opt("lookback")) : undefined,
  watchIds: opt("watch")?.split(",").filter(Boolean),
  deadlineMs: 15 * 60_000,
});
print(JSON.stringify(report, null, 2));
const c = report.cost;
console.error(
  `sweep ${report.runId}: ${report.notices.total} recalls (${report.notices.newSinceLastRun} new since last run), ${report.notices.candidatePairs} watched-thing matches to check, ` +
    `${report.reads.fresh} fresh reads + ${report.reads.cached} cached, ${report.events.added} events; ` +
    `Token Factory ${c.tokenFactory.calls} calls, ${c.tokenFactory.prompt}+${c.tokenFactory.completion} tokens, ${c.tokenFactory.cents}¢; Tavily ${c.tavily.credits} credits; ${c.agencyCalls} agency calls; ${(report.ms / 1000).toFixed(1)} s`,
);
process.exit(Object.values(report.sources).some((s) => s.ok) || report.skipped ? 0 : 1);

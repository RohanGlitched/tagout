// Replays one case from the eval cache only (no live calls, no spend) and prints the items, the notices read and
// the verdict with its proof. Usage: npx tsx --conditions=react-server eval/replay.ts <arm> <case id>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CACHE = path.join(ROOT, "eval", ".cache", "http");
process.env.NEBIUS_API_KEY ||= "replay";
delete process.env.TAVILY_API_KEY;
process.env.TAGOUT_TODAY ||= "2026-10-15";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === "string" ? init.body : "";
  const keyUrl = url.replace(/([?&])_=\d+&?/, "$1").replace(/[?&]$/, "");
  const key = crypto.createHash("sha256").update(`${init?.method ?? "GET"} ${keyUrl} ${body}`).digest("hex");
  const file = path.join(CACHE, key.slice(0, 2), `${key}.json`);
  if (!fs.existsSync(file)) throw new Error(`not cached: ${url.slice(0, 120)}`);
  const hit = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type } });
}) as typeof fetch;

const { runCheck } = await import("../lib/agent/run.ts");
const { MODELS } = await import("../lib/nebius.ts");
const [armName, id] = process.argv.slice(2);
const res = JSON.parse(fs.readFileSync(path.join(ROOT, "eval", "results", `${armName}.json`), "utf8"));
const { cases } = JSON.parse(fs.readFileSync(path.join(ROOT, "eval", "cases.json"), "utf8"));
const c = cases.find((x: { id: string }) => x.id === id);
const cfg = res.config;
if (cfg.kind !== "pipeline") throw new Error("only pipeline arms replay");
MODELS.agent.splice(0, MODELS.agent.length, ...cfg.agent);
MODELS.reader.splice(0, MODELS.reader.length, ...cfg.reader);
if (cfg.intake) MODELS.intake.splice(0, MODELS.intake.length, ...cfg.intake);
for await (const e of runCheck({ text: c.text, photos: [] }, cfg.useModel, { agent: cfg.useAgent })) {
  if (e.t === "items") console.log("ITEMS", JSON.stringify(e.items));
  else if (e.t === "step") console.log("STEP ", e.step.label, "→", e.step.found, "new", e.step.fresh, e.step.error ?? "");
  else if (e.t === "read") console.log("READ ", e.noticeId, "codes", e.codes, "struck", e.struck.join(", "));
  else if (e.t === "verdict") {
    const v = e.verdict;
    console.log("TAG  ", v.level, "|", v.headline, "|", v.notice?.id);
    console.log("     proof", JSON.stringify(v.proof));
    if (v.notice) console.log("     text", JSON.stringify((v.notice.text ?? "").slice(0, 600)));
    if (v.notice) console.log("     models", JSON.stringify(v.notice.models), "lots", JSON.stringify(v.notice.lots), "made", JSON.stringify(v.notice.madeRanges));
    console.log("     related", (v.related ?? []).map((n) => `${n.source}:${n.id} models=${JSON.stringify(n.models)} lots=${JSON.stringify(n.lots)}`).join(" | "));
  }
}

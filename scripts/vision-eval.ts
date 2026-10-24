// Label photos through the app's own photo path (readItems with one photo), one vision model at a time, so the
// models are compared on the same prompt and schema the app sends. Prints what each model read, whether every
// expected code came back exactly, and latency and tokens per photo.
// Usage: npx tsx --conditions=react-server scripts/vision-eval.ts [manifest.json] [--models a,b] [--out file.json]
// A manifest is [{ "id", "file", "expect": { "brand"?, "codes": ["SRTH", ...] } }]; paths are relative to it.
// Costs a few Token Factory calls per photo (well under a cent each).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
for (const f of [path.join(ROOT, ".env.local"), path.join(ROOT, "..", ".env.keys")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const manifestFile = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : path.join(ROOT, "eval", "photos", "photos.json");
type Photo = { id: string; file: string; expect: { brand?: string; codes: string[] }; note?: string };
const photos = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Photo[];
const models = (flag("models") ?? "nvidia/Nemotron-3.5-Super-VL,Qwen/Qwen3.8-27B,google/gemma-3-27b-it").split(",");

const { readItems } = await import("../lib/agent/intake.ts");
const { MODELS, usageScope } = await import("../lib/nebius.ts");
const { norm } = await import("../lib/match.ts");

const rows: Record<string, unknown>[] = [];
for (const p of photos) {
  const file = path.resolve(path.dirname(manifestFile), p.file);
  const mime = file.endsWith(".png") ? "png" : file.endsWith(".webp") ? "webp" : "jpeg";
  const url = `data:image/${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  for (const model of models) {
    MODELS.vision.splice(0, MODELS.vision.length, model);
    const usage = { calls: 0, prompt: 0, completion: 0 };
    const t0 = Date.now();
    const r = await usageScope.run(usage, () => readItems("", [url], true)).catch((e: Error) => ({ items: [], error: e.message }) as never);
    const ms = Date.now() - t0;
    const it = r.items?.[0];
    // Everything the reader returned, as one string: a code counts as read when it appears exactly (ignoring case,
    // spaces and dashes) in one field, never split across two.
    const fields = it ? [it.model, it.lot, it.serial, it.upc, it.ndc, it.made, ...(it.codes ?? [])].filter(Boolean).map((s) => norm(String(s))) : [];
    const read = p.expect.codes.map((c) => ({ code: c, ok: fields.some((f) => f.includes(norm(c))) }));
    const brandOk = p.expect.brand ? Boolean(it?.brand && norm(it.brand).includes(norm(p.expect.brand))) : null;
    const row = { photo: p.id, model, answered: r.visionModel ?? null, ms, tokens: usage, brandOk, codes: read, allCodes: read.every((x) => x.ok), item: it ?? null };
    rows.push(row);
    console.log(p.id.padEnd(14), model.padEnd(34), r.visionModel ? "answered" : "FAILED  ", `${ms}ms`, `${usage.prompt}+${usage.completion} tok`, "brand", brandOk, read.map((x) => `${x.code}:${x.ok ? "ok" : "MISS"}`).join(" "));
    if (it) console.log("   ", JSON.stringify({ brand: it.brand, product: it.product, model: it.model, lot: it.lot, serial: it.serial, upc: it.upc, made: it.made, codes: it.codes }));
  }
}
const out = flag("out");
if (out) fs.writeFileSync(path.resolve(out), JSON.stringify({ at: new Date().toISOString(), manifest: path.relative(ROOT, manifestFile).replace(/\\/g, "/"), rows }, null, 1) + "\n");

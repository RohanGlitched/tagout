// Checks the eval cache for secrets before anyone shares it, and with --fix copies it to a scrubbed folder.
// Usage: node scripts/cache-scrub.mjs [--fix out-dir]
// It looks for the real key values from .env.local and ../.env.keys (never printed) and for key-shaped strings
// (Tavily tvly- keys, JWTs, bearer tokens, api_key= query values). It prints file names and the kind of match only.
// With --fix, every match is replaced by "[REDACTED]" in a copy under out-dir; the cache itself is left alone.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CACHE = process.env.EVAL_CACHE ? path.resolve(process.env.EVAL_CACHE) : path.join(ROOT, "eval", ".cache");
const args = process.argv.slice(2);
const fixDir = args.includes("--fix") ? path.resolve(args[args.indexOf("--fix") + 1]) : null;

const secrets = [];
for (const f of [path.join(ROOT, ".env.local"), path.join(ROOT, "..", ".env.keys")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*(\w+)\s*=\s*(.*)$/);
    const v = m?.[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (m && v && v.length >= 12 && /KEY|TOKEN|SECRET/i.test(m[1])) secrets.push({ name: m[1], value: v });
  }
}
const PATTERNS = [
  ["tavily key", /tvly-[A-Za-z0-9_-]{10,}/g],
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{20,}/g],
  ["api_key query", /api_key=[A-Za-z0-9]{16,}/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["Stripe-style key", /[sp]k_(?:live|test)_[A-Za-z0-9]{10,}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["key=value secret", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\\?["']?\s*[:=]\s*\\?["']?[A-Za-z0-9_\-]{24,}/gi],
];

let files = 0, hits = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(CACHE)) {
  files++;
  let text = fs.readFileSync(f, "utf8");
  const found = [];
  for (const s of secrets) if (text.includes(s.value)) { found.push(`value of ${s.name}`); text = text.split(s.value).join("[REDACTED]"); }
  for (const [kind, re] of PATTERNS) {
    const n = (text.match(re) ?? []).length;
    if (n) { found.push(`${n} ${kind}`); text = text.replace(re, "[REDACTED]"); }
  }
  if (found.length) {
    hits++;
    console.log(path.relative(CACHE, f).replace(/\\/g, "/"), "→", found.join(", "));
  }
  if (fixDir) {
    const out = path.join(fixDir, path.relative(CACHE, f));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
  }
}
console.log(`${files} files checked against ${secrets.length} key values and ${PATTERNS.length} patterns; ${hits} with matches${fixDir ? `; scrubbed copy in ${fixDir}` : ""}`);

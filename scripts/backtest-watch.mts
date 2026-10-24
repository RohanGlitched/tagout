// A replayed watch: what a list saved on Oct 13 2026 would have received from the daily sweep over the recalls
// published Oct 14-22. Clearly labelled on its page ("Replayed: what this watch would have received").
//
//   npx tsx --conditions=react-server scripts/backtest-watch.mts                     build it locally (.data/)
//   npx tsx --conditions=react-server scripts/backtest-watch.mts --publish --gcloud  upload the local build to the bucket
//
// Build (the default) writes only under .data/: the store env vars are removed first, so nothing reaches
// production storage. It runs the sweep's own pieces, unchanged: the list is read by the app's intake (Nemotron 3
// Ultra), the watched things go into the sweep's inverted index (lib/sweep/index.ts), every recall of the window
// is looked up in it, the ones that touch a watched brand or code are read once by the notice reader (through the
// read cache) and tagged by the matcher, and each red or orange result becomes the sweep's own new-recall event,
// dated the morning after the recall was published (the sweep runs at 06:00 UTC). The recalls of the window:
// - CPSC's database, recalls dated Oct 14-22 (live API, free);
// - openFDA's drug, food and device enforcement reports dated Oct 14-22 (live API, free);
// - the FDA company announcements and the USDA FSIS release of Oct 16-22 saved in eval/notices-holdout/ (the
//   sweep finds these through one Tavily search a day; their full pages are read with Tavily Extract, about 2
//   credits, or the saved excerpt is used when Extract doesn't answer).
// Cost: one intake call and a few notice readings on Token Factory, under a cent.
//
// Publish uploads exactly what the build wrote (.data/watches/<id>.json and .data/events/<id>.json) to
// watches/<id>.json and events/<id>.json in the bucket: no model or Tavily calls. It refuses to overwrite a watch
// that is already there unless --force. --id=<10 lowercase letters or digits> (default replay1013).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const opt = (f: string) => args.find((a) => a.startsWith(`--${f}=`))?.slice(f.length + 3);
const ID = opt("id") ?? "replay1013";
if (!/^[a-z0-9]{10}$/.test(ID)) throw new Error("--id must be 10 lowercase letters or digits");
const AS_OF = "2026-10-13";
const WINDOW = { from: "2026-10-14", to: "2026-10-22" };
const LIST = ["Gelatelli coffee & vanilla gelato, lot 085261", "WinCo hoagie rolls 16 oz, UPC 2-70552-00649-2", "Scotch thermal laminator, model TL1302Z"].join("\n");
const NOTE =
  "The list holds a Lidl Gelatelli gelato lot and a WinCo hoagie-roll UPC, both recalled through FDA company announcements on Oct 16 and Oct 22, and a Scotch laminator model CPSC recalled on Oct 15. The recalls are CPSC's and openFDA's records of Oct 14-22 and the FDA and USDA announcements of those days; each alert is the sweep's own event, dated the morning after its recall was published.";

for (const file of [".env.local", path.join("..", ".env.keys")]) {
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const m = raw.replace(/\r$/, "").match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\r/g, "");
  }
}
delete process.env.VERCEL_OIDC_TOKEN;
const LOCAL = path.join(process.cwd(), ".data");
const localWatch = path.join(LOCAL, "watches", `${ID}.json`);
const localEvents = path.join(LOCAL, "events", `${ID}.json`);

if (flag("publish")) {
  // Upload the local build as it is; nothing is re-run.
  if (!fs.existsSync(localWatch) || !fs.existsSync(localEvents)) throw new Error(`Build it first: ${localWatch} and ${localEvents} are missing.`);
  if (flag("gcloud")) {
    process.env.GCS_BUCKET ||= "tagout-checks-1948";
    const win = process.platform === "win32";
    process.env.GCS_ACCESS_TOKEN = execFileSync(win ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], { encoding: "utf8", shell: win }).trim();
  }
  delete process.env.SWEEP_PREFIX;
  const { storage } = await import("../lib/storage.ts");
  const s = storage();
  if (!s) throw new Error("No store configured: pass --gcloud (or set GCS_BUCKET with GCS_SA_KEY or GCS_ACCESS_TOKEN).");
  const watch = JSON.parse(fs.readFileSync(localWatch, "utf8"));
  if (!watch.replay) throw new Error("The local watch has no replay label; refusing to publish it.");
  const there = await s.read(`watches/${ID}.json`);
  if (there && !flag("force")) throw new Error(`watches/${ID}.json already exists in the bucket; pass --force to replace it.`);
  await s.write(`watches/${ID}.json`, JSON.stringify(watch));
  await s.write(`events/${ID}.json`, fs.readFileSync(localEvents, "utf8"));
  const events = JSON.parse(fs.readFileSync(localEvents, "utf8")).events.length;
  console.log(`Published watches/${ID}.json and events/${ID}.json (${events} events) to ${process.env.GCS_BUCKET}. Page: https://tagout-recalls.vercel.app/watch/${ID}`);
  process.exit(0);
}

// Build: local files only.
for (const k of Object.keys(process.env)) if (/^(GCS_|BLOB_)/.test(k)) delete process.env[k];
process.env.TAGOUT_READ_CACHE ||= "local";
const print = console.log.bind(console);
console.log = (...a: unknown[]) => console.error(...a);

const { readItems } = await import("../lib/agent/intake.ts");
const { datelineDate, fillWebText, readNotice, textHash } = await import("../lib/agent/read-notice.ts");
const { buildVerdict } = await import("../lib/agent/verdict.ts");
const { MODELS, usageScope } = await import("../lib/nebius.ts");
const { latestCpsc } = await import("../lib/sources/cpsc.ts");
const { fdaSince } = await import("../lib/sources/fda.ts");
const { tavilyScope } = await import("../lib/sources/web.ts");
const { buildIndex, candidates, itemKey } = await import("../lib/sweep/index.ts");
const { newRecallEvent, mergeEvents } = await import("../lib/sweep/events.ts");
type Notice = import("../lib/types.ts").Notice;
type Watched = import("../lib/sweep/index.ts").Watched;

const usage = { calls: 0, prompt: 0, completion: 0, usd: 0 };
const tavily = { searches: 0, extracts: 0, extractUrls: 0, credits: 0 };
await usageScope.run(usage, () =>
  tavilyScope.run(tavily, async () => {
    const asOfIso = `${AS_OF}T12:00:00.000Z`;
    const intake = await readItems(LIST, [], true);
    if (intake.items.length !== 3) throw new Error(`the intake read ${intake.items.length} items, not 3`);
    const entries: Watched[] = intake.items.map((item) => ({ watchId: ID, key: itemKey(item), item, checkedAt: asOfIso, known: new Set<string>() }));
    const idx = buildIndex(entries);

    const inWindow = (n: Notice) => Boolean(n.date) && n.date >= WINDOW.from && n.date <= WINDOW.to;
    const cpsc = (await latestCpsc(WINDOW.from)).filter(inWindow);
    const fda = (await Promise.all((["drug", "food", "device"] as const).map((k) => fdaSince(k, WINDOW.from)))).flat().filter(inWindow);
    // The saved FDA and FSIS announcements: "Source: <url>", then the title line, then the text.
    const dir = path.join("eval", "notices-holdout");
    const web: Notice[] = fs.readdirSync(dir).map((f) => {
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      const url = t.match(/^Source:\s*(\S+)/m)![1];
      const body = t.split("\n").slice(2).join("\n").trim();
      const title = body.split("\n").find((l) => l.trim() && !/^\d{3}-\d{4}\s/.test(l))!.trim();
      return { source: "web", id: /fsis/.test(url) ? "USDA FSIS" : "FDA website", title, date: datelineDate(body), url, models: [], lots: [], upcs: [], text: `${title}\n${body}` } as Notice;
    });
    const notices = [...cpsc, ...fda, ...web.filter(inWindow)];

    const pairs: { entry: Watched; notice: Notice }[] = [];
    for (const n of notices) for (const c of candidates(idx, n)) pairs.push({ entry: c.entry, notice: n });
    const toRead = [...new Set(pairs.map((p) => p.notice))];
    // The excerpts are kept when Extract has nothing better.
    const saved = new Map(toRead.map((n) => [n, n.text]));
    await fillWebText(toRead);
    for (const n of toRead) if ((n.text?.length ?? 0) < (saved.get(n)?.length ?? 0)) n.text = saved.get(n);
    const reads = new Map(await Promise.all(toRead.map(async (n) => [n, await readNotice(n, true, MODELS.reader)] as const)));

    const events = [];
    for (const p of pairs) {
      const r = reads.get(p.notice);
      if (!r || r.failed) continue;
      // The morning after the recall was published: the sweep's 06:00 UTC run.
      const at = new Date(Date.parse(`${r.notice.date || p.notice.date}T06:00:00.000Z`) + 86_400_000).toISOString();
      const v = buildVerdict(p.entry.item, [r.notice], [r.notice.source], at);
      const e = newRecallEvent(p.entry, v, at, textHash(p.notice, (p.notice.text ?? "").slice(0, 12_000)));
      if (e) events.push(e);
    }
    const log = { watchId: ID, updatedAt: new Date().toISOString(), events: mergeEvents([], events).events };
    const watch = { id: ID, createdAt: asOfIso, text: LIST, checks: [], replay: { asOf: AS_OF, note: NOTE } };
    fs.mkdirSync(path.dirname(localWatch), { recursive: true });
    fs.mkdirSync(path.dirname(localEvents), { recursive: true });
    fs.writeFileSync(localWatch, JSON.stringify(watch, null, 2));
    fs.writeFileSync(localEvents, JSON.stringify(log, null, 2));
    const report = {
      id: ID,
      asOf: AS_OF,
      window: WINDOW,
      items: intake.items.map((i) => ({ said: i.said, kind: i.kind, brand: i.brand, model: i.model, lot: i.lot, upc: i.upc })),
      recalls: { cpsc: cpsc.length, openFda: fda.length, announcements: web.filter(inWindow).length, total: notices.length },
      matched: pairs.map((p) => `${p.entry.item.said} ← ${p.notice.source.toUpperCase()} ${p.notice.id} ${p.notice.title.slice(0, 70)}`),
      events: log.events.map((e) => ({ at: e.at, level: e.level, item: e.item.said, ref: e.notice?.ref, headline: e.headline })),
      cost: { tokenFactory: { ...usage, cents: Math.round((usage.usd ?? 0) * 1e4) / 100 }, tavily },
      wrote: [localWatch, localEvents],
    };
    fs.mkdirSync(path.join(LOCAL, "backtest"), { recursive: true });
    fs.writeFileSync(path.join(LOCAL, "backtest", `${ID}.json`), JSON.stringify(report, null, 2));
    print(JSON.stringify(report, null, 2));
  }),
);

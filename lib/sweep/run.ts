import "server-only";
import type { CheckRecord } from "../checks";
import type { Notice, Verdict } from "../types";
import { fillWebText, readNotice, textHash, type ReadResult } from "../agent/read-notice";
import { buildVerdict } from "../agent/verdict";
import { docPrefix, sha256 } from "../docs";
import { deadlineScope, hasKey, MODELS, usageScope, type Usage } from "../nebius";
import { cpscByNumber, cpscRss, editedCpsc, latestCpsc } from "../sources/cpsc";
import { fdaByNumber, fdaSince } from "../sources/fda";
import { childSeatRecalls, nhtsaCampaignExists, vehicleRecalls } from "../sources/nhtsa";
import { tavilyScope, webSearch, type TavilyTally } from "../sources/web";
import { loadCheck } from "../store";
import { listWatchIds, loadWatch } from "../watches";
import { changeEvent, droppedEvent, newRecallEvent, sameRecord, type EventKind, type EventLog, type WatchEvent } from "./events";
import { buildIndex, candidates, itemKey, noticeKey, noticeKeys, type Watched } from "./index";
import { appendEvents, claimRun, finishRun, loadEventLog, loadState, releaseRun, saveReport } from "./store";

/**
 * The daily recall sweep: read each new recall once, then match it against every watch by rules.
 *
 * 1. Load every watch and the newest finished check of each, and build an inverted index of the watched things'
 *    brands and printed codes (lib/sweep/index.ts).
 * 2. Pull the recalls published in the last LOOKBACK days: CPSC's database (by recall date, and records it
 *    re-published since the last run), its newsroom feed (a week ahead of the database), openFDA's drug, food
 *    and device enforcement reports, NHTSA's recalls for each distinct watched vehicle and car-seat brand (NHTSA
 *    has no "published since" query), and USDA FSIS through one Tavily search.
 * 3. Look each recall up in the index. Only a recall that names a watched brand (for the same kind of product)
 *    or prints a watched code goes on; the rest cost nothing.
 * 4. Nemotron reads each of those once, through the read cache (source, number, text hash, model), so a recall
 *    is never read twice; the deterministic matcher then tags each watched thing it could cover.
 * 5. The recalls each watch already cites are compared with the agency's current record: a changed record is
 *    re-read and re-matched ("recall changed"), and one missing on two sweeps running is "recall dropped".
 * 6. Events go to each watch's log (and so its Atom feed); the run's report, with its Token Factory calls,
 *    tokens and cost, its Tavily credits and agency calls, goes to sweep/runs/.
 *
 * Model cost therefore grows with the number of new recalls that touch someone's brands, not with households:
 * a watch adds two small storage reads a day.
 */

export type SweepOptions = {
  /** Days of recalls to consider (default 30; the read cache makes a long window free after the first run). */
  lookbackDays?: number;
  /** Fresh (uncached) notice reads allowed in one run (default 40); the rest wait for the next run. */
  maxReads?: number;
  /** False: no model at all (a dry measure of what would be read). */
  useModel?: boolean;
  /** Don't write events, state or the report. */
  dryRun?: boolean;
  /** Use Tavily for the CPSC newsroom (when cpsc.gov turns the host away) and USDA FSIS (default true). */
  tavily?: boolean;
  /** Stop starting model reads after this long (default 240 s; the cron route has 300). */
  deadlineMs?: number;
  /** Only these watches (a trial run). */
  watchIds?: string[];
  now?: Date;
};

type SourceReport = { ok: boolean; notices: number; calls: number; error?: string };

export type SweepReport = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  skipped?: string;
  options: { lookbackDays: number; maxReads: number; useModel: boolean; dryRun: boolean; tavily: boolean; prefix: string; since: string };
  sources: Record<string, SourceReport>;
  notices: { total: number; newSinceLastRun: number; changedSinceLastRun: number; matchedIndex: number; candidatePairs: number };
  reads: { needed: number; cached: number; fresh: number; failed: number; deferred: number };
  watches: { total: number; indexed: number; things: number; brands: number; codes: number; vehicles: number; seatBrands: number; skipped: number };
  tracked: { recalls: number; same: number; changed: number; missing: number; unknown: number };
  events: { added: number; watches: number; byKind: Partial<Record<EventKind, number>> };
  cost: { tokenFactory: Usage & { cents: number }; tavily: TavilyTally; agencyCalls: number };
};

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Runs `fn` over `xs` with at most `n` at a time. */
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await fn(xs[k]);
      }
    }),
  );
  return out;
}

const noticesOf = (v: Verdict | undefined) => (v ? [v.notice, ...(v.related ?? [])].filter((n): n is Notice => Boolean(n)) : []);

/** A cited recall the sweep compares with the agency's current record. */
type Tracked = { entry: Watched; stored: Notice; storedHash?: string };

/** An event's copy of a recall, as a notice again (codes kept, text not). */
const asNotice = (e: WatchEvent): Notice | null =>
  e.notice && e.notice.source !== "web"
    ? { source: e.notice.source, id: e.notice.id, title: e.notice.title, date: e.notice.date, url: e.notice.url, firm: e.notice.firm, hazard: e.notice.hazard, remedy: e.notice.remedy, contact: e.notice.contact, urgent: e.notice.urgent, image: e.notice.image, status: e.notice.status, models: e.notice.models, lots: e.notice.lots, upcs: e.notice.upcs }
    : null;

async function loadWatched(ids: string[]): Promise<{ entries: Watched[]; tracked: Tracked[]; logs: Map<string, EventLog>; skipped: number }> {
  const entries: Watched[] = [];
  const tracked: Tracked[] = [];
  const logs = new Map<string, EventLog>();
  let skipped = 0;
  await pool(ids, 8, async (id) => {
    const w = await loadWatch(id).catch(() => null);
    if (!w) return void skipped++;
    let check: CheckRecord | null = null;
    for (const c of [...w.checks].reverse().slice(0, 3)) {
      const r = await loadCheck(c.id).catch(() => null);
      if (r?.status === "done" && r.items?.length) {
        check = r;
        break;
      }
    }
    if (!check) return void skipped++;
    const log = await loadEventLog(id);
    logs.set(id, log);
    const checkedAt = check.finishedAt ?? check.createdAt;
    for (const item of check.items ?? []) {
      const v = check.verdicts?.find((x) => x.itemId === item.id);
      const key = itemKey(item);
      const mine = log.events.filter((e) => e.item.key === key);
      const entry: Watched = {
        watchId: id,
        key,
        item,
        checkId: check.id,
        checkedAt,
        level: v?.level,
        known: new Set([...noticesOf(v).flatMap(noticeKeys), ...mine.flatMap((e) => (e.notice ? noticeKeys(e.notice) : []))]),
      };
      entries.push(entry);
      const seen = new Set<string>();
      for (const n of noticesOf(v)) {
        if (n.source === "web" || seen.has(noticeKey(n))) continue;
        seen.add(noticeKey(n));
        tracked.push({ entry, stored: n });
      }
      // Recalls the sweep itself found for this thing are tracked from the copy it recorded.
      for (const e of mine) {
        const n = e.kind === "new-recall" || e.kind === "recall-changed" ? asNotice(e) : null;
        if (!n || seen.has(noticeKey(n))) continue;
        seen.add(noticeKey(n));
        tracked.push({ entry, stored: n, storedHash: e.notice?.textHash });
      }
    }
  });
  return { entries, tracked, logs, skipped };
}

export async function runSweep(opts: SweepOptions = {}): Promise<SweepReport> {
  const usage: Usage = { calls: 0, prompt: 0, completion: 0, usd: 0 };
  const tavily: TavilyTally = { searches: 0, extracts: 0, extractUrls: 0, credits: 0 };
  const t0 = opts.now ? opts.now.getTime() : Date.now();
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  return usageScope.run(usage, () => tavilyScope.run(tavily, () => deadlineScope.run({ at: deadline }, () => sweep(opts, usage, tavily, t0, deadline))));
}

async function sweep(opts: SweepOptions, usage: Usage, tavilyTally: TavilyTally, t0: number, deadline: number): Promise<SweepReport> {
  const startedAt = new Date(t0).toISOString();
  const runId = sha256(`${startedAt}|${Math.random()}`).slice(0, 10);
  const lookbackDays = opts.lookbackDays ?? 30;
  const maxReads = opts.maxReads ?? 40;
  const useModel = (opts.useModel ?? true) && hasKey();
  const dryRun = Boolean(opts.dryRun);
  const useTavily = opts.tavily ?? Boolean(process.env.TAVILY_API_KEY);
  const since = day(t0 - lookbackDays * 86_400_000);
  const report: SweepReport = {
    runId,
    startedAt,
    finishedAt: "",
    ms: 0,
    options: { lookbackDays, maxReads, useModel, dryRun, tavily: useTavily, prefix: docPrefix(), since },
    sources: {},
    notices: { total: 0, newSinceLastRun: 0, changedSinceLastRun: 0, matchedIndex: 0, candidatePairs: 0 },
    reads: { needed: 0, cached: 0, fresh: 0, failed: 0, deferred: 0 },
    watches: { total: 0, indexed: 0, things: 0, brands: 0, codes: 0, vehicles: 0, seatBrands: 0, skipped: 0 },
    tracked: { recalls: 0, same: 0, changed: 0, missing: 0, unknown: 0 },
    events: { added: 0, watches: 0, byKind: {} },
    cost: { tokenFactory: { calls: 0, prompt: 0, completion: 0, usd: 0, cents: 0 }, tavily: tavilyTally, agencyCalls: 0 },
  };
  const finish = () => {
    report.finishedAt = new Date().toISOString();
    report.ms = Date.now() - t0;
    const usd = usage.usd ?? 0;
    report.cost.tokenFactory = { ...usage, usd: Math.round(usd * 1e6) / 1e6, cents: Math.round(usd * 1e4) / 100 };
    return report;
  };

  const state = await loadState();
  if (!dryRun && !(await claimRun(runId, startedAt))) {
    report.skipped = "Another sweep is running.";
    return finish();
  }

  try {
    // 1. Watches and the index.
    const ids = opts.watchIds ?? (await listWatchIds());
    const { entries, tracked, logs, skipped } = await loadWatched(ids);
    const idx = buildIndex(entries);
    report.watches = { total: ids.length, indexed: logs.size, things: entries.length, brands: idx.brands.size, codes: idx.codes.size, vehicles: idx.vehicles.size, seatBrands: idx.seats.size, skipped };

    // 2. Sources, each on its own: one that fails is reported and left out.
    const lastRun = state.lastRunAt ? Date.parse(state.lastRunAt) : t0 - lookbackDays * 86_400_000;
    const editedSince = day(Math.max(lastRun - 2 * 86_400_000, t0 - lookbackDays * 86_400_000));
    const src = async (name: string, calls: number, f: () => Promise<Notice[] | null>): Promise<Notice[]> => {
      report.cost.agencyCalls += calls;
      try {
        const ns = (await f()) ?? [];
        report.sources[name] = { ok: true, notices: ns.length, calls };
        return ns;
      } catch (e) {
        report.sources[name] = { ok: false, notices: 0, calls, error: (e as Error).message.slice(0, 160) };
        return [];
      }
    };
    const vehicleQueries = [...idx.vehicles.values()];
    const seatQueries = [...idx.seats.values()];
    const [cpscApi, cpscEdited, rss, drug, food, device, vehicles, seats] = await Promise.all([
      src("cpsc", 1, () => latestCpsc(since)),
      src("cpsc-edited", 1, () => editedCpsc(editedSince)),
      src("cpsc-newsroom", 1, async () => {
        const feed = await cpscRss();
        if (feed) return feed;
        if (!useTavily) return [];
        // cpsc.gov turns some cloud hosts away; the week's recall pages through one Tavily search instead.
        const { notices } = await webSearch({ query: "CPSC recalls this week", domains: ["cpsc.gov"], days: 7, max: 15 });
        return notices.filter((n) => /cpsc\.gov\/Recalls\/\d{4}\//i.test(n.url));
      }),
      src("fda-drug", 1, () => fdaSince("drug", since)),
      src("fda-food", 1, () => fdaSince("food", since)),
      src("fda-device", 1, () => fdaSince("device", since)),
      src("nhtsa-vehicles", vehicleQueries.length, async () => {
        return (await pool(vehicleQueries, 4, (q) => vehicleRecalls(q.make, q.model, q.year))).flat();
      }),
      src("nhtsa-car-seats", seatQueries.length, async () => (await pool(seatQueries, 4, (q) => childSeatRecalls(q.brand))).flat()),
    ]);
    const fsis = useTavily
      ? await src("usda-fsis", 0, async () => {
          // Tavily gives these pages no date, so the search is limited to the past month; a recall page is
          // /recalls-alerts/<slug> (the /recalls?f[...] pages are filtered lists, never notices).
          const { notices } = await webSearch({ query: "recalls meat poultry products", domains: ["fsis.usda.gov"], days: 31, max: 10 });
          return notices.filter((n) => /fsis\.usda\.gov\/recalls-alerts\/[^?]+/i.test(n.url)).map((n) => ({ ...n, firm: n.title.split(/\s+(?:Recalls|Issues)/)[0] || undefined }));
        })
      : [];

    // One copy of each recall: the database record before a newsroom or web copy of it.
    const all = new Map<string, Notice>();
    const alias = new Map<string, string>();
    for (const n of [...cpscApi, ...cpscEdited, ...drug, ...food, ...device, ...vehicles, ...seats, ...rss, ...fsis]) {
      const keys = noticeKeys(n);
      if (keys.some((k) => alias.has(k))) continue;
      all.set(keys[0], n);
      for (const k of keys) alias.set(k, keys[0]);
    }
    const notices = [...all.values()];
    report.notices.total = notices.length;
    const hashOf = (n: Notice) => sha256(`${n.title}\n${n.text ?? ""}\n${n.remedy ?? ""}`).slice(0, 16);
    const seen: Record<string, string> = {};
    for (const n of notices) {
      const k = noticeKey(n), h = hashOf(n);
      seen[k] = h;
      if (!(k in state.seen)) report.notices.newSinceLastRun++;
      else if (state.seen[k] !== h) report.notices.changedSinceLastRun++;
    }

    // 3. Which recalls touch which watched things.
    const pairs: { entry: Watched; notice: Notice; why: "code" | "brand" }[] = [];
    for (const n of notices) {
      const c = candidates(idx, n);
      if (c.length) report.notices.matchedIndex++;
      for (const x of c) pairs.push({ entry: x.entry, notice: n, why: x.why });
    }
    report.notices.candidatePairs = pairs.length;

    // 5 (fetch half). The agency's current record of every cited recall.
    report.tracked.recalls = new Set(tracked.map((t) => noticeKey(t.stored))).size;
    const fresh = new Map<string, Notice | null | undefined>(); // undefined: couldn't tell
    const byId = [...new Set(tracked.map((t) => noticeKey(t.stored)))];
    await pool(byId, 4, async (k) => {
      const t = tracked.find((x) => noticeKey(x.stored) === k)!.stored;
      const have = all.get(alias.get(k) ?? "");
      if (have) return void fresh.set(k, have);
      report.cost.agencyCalls++;
      try {
        if (t.source === "cpsc") fresh.set(k, await cpscByNumber(t.id));
        else if (t.source === "fda") fresh.set(k, await fdaByNumber(t.id));
        // NHTSA's queries return a campaign in words that depend on the query, so one the daily queries didn't
        // return is only asked whether it still exists; if it does, the watch's copy stands.
        else if (t.source === "nhtsa") fresh.set(k, (await nhtsaCampaignExists(t.id)) ? t : null);
        else fresh.set(k, undefined);
      } catch {
        fresh.set(k, undefined);
      }
    });

    // 4. Reads: every candidate recall, and every cited recall the agency changed; cache first, then fresh reads
    // up to the cap (code hits first) while there's time.
    type Want = { n: Notice; prio: number };
    const want = new Map<Notice, Want>();
    for (const p of pairs) {
      if (p.notice.vehicleModel) continue;
      const w = want.get(p.notice);
      const prio = p.why === "code" ? 0 : 1;
      if (!w || prio < w.prio) want.set(p.notice, { n: p.notice, prio });
    }
    const changedTracked: { t: Tracked; now: Notice }[] = [];
    const missing = { ...state.missing };
    for (const t of tracked) {
      const k = noticeKey(t.stored);
      const now = fresh.get(k);
      if (now === undefined) {
        report.tracked.unknown++;
        continue;
      }
      if (now === null) continue;
      delete missing[k];
      const nowText = (now.text ?? "").slice(0, 12_000);
      if (sameRecord(t.stored, now, t.storedHash, t.storedHash ? textHash(now, nowText) : undefined)) {
        report.tracked.same++;
        continue;
      }
      report.tracked.changed++;
      changedTracked.push({ t, now });
      if (!now.vehicleModel && !want.has(now)) want.set(now, { n: now, prio: 0 });
    }
    const gone = byId.filter((k) => fresh.get(k) === null);
    report.tracked.missing = gone.length;
    for (const k of gone) missing[k] = (missing[k] ?? 0) + 1;

    const toRead = [...want.values()].sort((a, b) => a.prio - b.prio).map((w) => w.n);
    report.reads.needed = toRead.length;
    const read = new Map<Notice, ReadResult>();
    if (useModel && toRead.length) {
      await fillWebText(toRead);
      // Cache only, eight at a time; then fresh reads, three at a time, up to the cap and the deadline.
      const cachedFirst = await pool(toRead, 8, async (n) => ({ n, r: await readNotice(n, true, MODELS.reader, { allowFresh: false }) }));
      let budget = maxReads;
      const misses: Notice[] = [];
      for (const { n, r } of cachedFirst) {
        if (r.deferred) misses.push(n);
        else {
          read.set(n, r);
          report.reads.cached++;
        }
      }
      await pool(misses, 3, async (n) => {
        if (budget <= 0 || Date.now() > deadline - 40_000) {
          report.reads.deferred++;
          return;
        }
        budget--;
        const r = await readNotice(n, true, MODELS.reader);
        if (r.failed) report.reads.failed++;
        else {
          report.reads.fresh++;
          read.set(n, r);
        }
      });
    } else report.reads.deferred = toRead.length;

    // Matching: a thing's tag against the one new recall. Without a reading (deferred, failed, no model) a
    // recall is left for the next run, except a car's, which needs none.
    const at = new Date().toISOString();
    const out = new Map<string, WatchEvent[]>();
    const emit = (watchId: string, e: WatchEvent | null) => {
      if (!e) return;
      out.set(watchId, [...(out.get(watchId) ?? []), e]);
    };
    for (const p of pairs) {
      const r = p.notice.vehicleModel ? { notice: p.notice } : read.get(p.notice);
      if (!r) continue;
      const v = buildVerdict(p.entry.item, [r.notice], [r.notice.source], at);
      emit(p.entry.watchId, newRecallEvent(p.entry, v, at, textHash(p.notice, (p.notice.text ?? "").slice(0, 12_000))));
    }
    for (const { t, now } of changedTracked) {
      const r = now.vehicleModel ? { notice: now } : read.get(now);
      if (!r) continue;
      emit(t.entry.watchId, changeEvent(t.entry, t.stored, r.notice, at, textHash(now, (now.text ?? "").slice(0, 12_000))));
    }
    for (const t of tracked) {
      const k = noticeKey(t.stored);
      if ((missing[k] ?? 0) < 2 || fresh.get(k) !== null) continue;
      const rest = tracked.filter((x) => x.entry === t.entry && noticeKey(x.stored) !== k).map((x) => x.stored);
      emit(t.entry.watchId, droppedEvent(t.entry, t.stored, rest, at));
    }

    // 6. Write.
    for (const [watchId, evs] of out) {
      const added = dryRun ? evs : await appendEvents(watchId, evs).catch((e) => {
        console.error("[sweep] events write failed", watchId, (e as Error).message);
        return [] as WatchEvent[];
      });
      if (added.length) report.events.watches++;
      report.events.added += added.length;
      for (const e of added) report.events.byKind[e.kind] = (report.events.byKind[e.kind] ?? 0) + 1;
    }
    finish();
    if (!dryRun) {
      await finishRun(runId, { lastRunAt: startedAt, seen, missing });
      await saveReport(report).catch((e) => console.error("[sweep] report write failed", (e as Error).message));
    }
    return report;
  } catch (e) {
    if (!dryRun) await releaseRun(runId);
    throw e;
  }
}


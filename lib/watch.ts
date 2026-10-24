import type { CheckRecord } from "./checks";
import type { Item, TagLevel, Verdict } from "./types";
import { normBrand } from "./match";

/**
 * A watched household: the list someone typed, and every check run on it, oldest first. A daily sweep
 * (lib/sweep) reads each newly published recall once and matches it against every watch, writing what it finds
 * to the watch's event log and Atom feed; opening the watch page no longer runs anything. "Check again now"
 * queues a full check of the list, at most once per RECHECK_MIN_MS, under the same budget as any check (the
 * lite tier first for the showcase watches), and the page shows what changed between the last two checks.
 */
export type WatchRecord = {
  id: string;
  createdAt: string;
  /** The typed list, one thing per line (photos aren't kept, so photo items can't be watched). */
  text: string;
  checks: { id: string; at: string }[];
};

/** A watch was re-checked on a visit once its newest check was this old (kept for the old page; see `due`). */
export const RECHECK_AFTER_MS = 24 * 3600_000;

/** "Check again now" is allowed once the newest check is this old: an hour, six for a showcase watch. */
export const RECHECK_MIN_MS = { normal: 3600_000, showcase: 6 * 3600_000 };

/** The watches the site links to as worked examples (SHOWCASE_WATCH_IDS, comma-separated, overrides). */
export function showcaseWatchIds(): string[] {
  return (process.env.SHOWCASE_WATCH_IDS ?? "5ehharz7sr").split(",").map((s) => s.trim()).filter(Boolean);
}
export const isShowcaseWatch = (id: string) => showcaseWatchIds().includes(id);

export type NoticeLink = { ref: string; title: string; url: string };

/** The four kinds the original watch page renders. */
export type ChangeKind = "worse" | "better" | "new-recall" | "new-item";
/** Every kind: also the cited recall changing (another recall leads the same tag) and recalls no longer cited. */
export type WatchChangeKind = ChangeKind | "cited-changed" | "recall-dropped";

export type Change<K extends string = ChangeKind> = {
  said: string;
  kind: K;
  from?: TagLevel;
  to: TagLevel;
  /** The recall behind the new tag, or the recalls that weren't there last time. */
  notices: NoticeLink[];
  /** Recalls the earlier check cited for this thing that this one doesn't. */
  dropped: NoticeLink[];
  /** cited-changed: the recall that led the tag before. */
  before?: NoticeLink;
};
export type WatchChange = Change<WatchChangeKind>;

const RANK: Record<TagLevel, number> = { inspected: 0, warning: 1, danger: 2 };
const key = (s: string) => normBrand(s).replace(/\s+/g, " ");
const ref = (n: NonNullable<Verdict["notice"]>) => `${n.source}:${n.id}:${n.url}`;
const noticesOf = (v: Verdict) => [v.notice, ...(v.related ?? [])].filter((n): n is NonNullable<Verdict["notice"]> => Boolean(n));
const link = (n: NonNullable<Verdict["notice"]>): NoticeLink => ({ ref: `${n.source.toUpperCase()} ${n.id}`, title: n.title, url: n.url });

/** The same thing in two checks: same position and brand, or else the same words. */
export function partner(item: Item, prev: Item[]): Item | undefined {
  const byPlace = prev.find((p) => p.id === item.id && p.kind === item.kind && key(p.brand ?? p.said) === key(item.brand ?? item.said));
  return byPlace ?? prev.find((p) => key(p.said) === key(item.said)) ?? prev.find((p) => p.kind === item.kind && p.brand && item.brand && key(p.brand) === key(item.brand) && key(p.product ?? "") === key(item.product ?? ""));
}

type Side = Pick<CheckRecord, "items" | "verdicts"> & { createdAt?: string; finishedAt?: string };

/**
 * What changed from one check of a household to the next: a tag that got worse or better, a recall published
 * since the earlier check, a thing that wasn't checked before, and (with `{ all: true }`) a tag that kept its
 * colour but now cites a different recall, or that no longer cites a recall it did. Every change lists the
 * recalls dropped as well as the ones added. Unchanged things are left out. Without `all`, only the four kinds
 * the original watch page knows are returned.
 */
export function diffChecks(prev: Side, next: Side): Change[];
export function diffChecks(prev: Side, next: Side, opts: { all: true }): WatchChange[];
export function diffChecks(prev: Side, next: Side, opts?: { all?: boolean }): WatchChange[] {
  // A recall counts as new only if it was published after the earlier check; an old recall the search happened to
  // surface this time isn't news.
  const since = (prev.finishedAt ?? prev.createdAt ?? "").slice(0, 10);
  const out: WatchChange[] = [];
  const pv = new Map((prev.verdicts ?? []).map((v) => [v.itemId, v]));
  for (const v of next.verdicts ?? []) {
    const item = next.items?.find((i) => i.id === v.itemId);
    if (!item) continue;
    const before = partner(item, prev.items ?? []);
    const was = before ? pv.get(before.id) : undefined;
    if (!was) {
      out.push({ said: item.said, kind: "new-item", to: v.level, notices: v.notice ? [link(v.notice)] : [], dropped: [] });
      continue;
    }
    const now = new Set(noticesOf(v).map(ref));
    const old = new Set(noticesOf(was).map(ref));
    // A green tag's related recalls are only what it was compared with; losing one isn't news.
    const dropped = was.level === "inspected" && v.level === "inspected" ? [] : noticesOf(was).filter((n) => !now.has(ref(n))).map(link);
    if (RANK[v.level] !== RANK[was.level]) {
      out.push({ said: item.said, kind: RANK[v.level] > RANK[was.level] ? "worse" : "better", from: was.level, to: v.level, notices: v.notice ? [link(v.notice)] : [], dropped });
      continue;
    }
    if (v.level === "inspected") continue;
    const added = noticesOf(v).filter((n) => !old.has(ref(n)) && Boolean(n.date) && n.date >= since);
    if (added.length) {
      out.push({ said: item.said, kind: "new-recall", from: was.level, to: v.level, notices: added.map(link), dropped });
      continue;
    }
    if (!opts?.all) continue;
    if (v.notice && was.notice && ref(v.notice) !== ref(was.notice)) {
      out.push({ said: item.said, kind: "cited-changed", from: was.level, to: v.level, notices: [link(v.notice)], before: link(was.notice), dropped });
    } else if (dropped.length) {
      out.push({ said: item.said, kind: "recall-dropped", from: was.level, to: v.level, notices: [], dropped });
    }
  }
  // Worst news first.
  const order: Record<WatchChangeKind, number> = { worse: 0, "new-recall": 1, "cited-changed": 2, "recall-dropped": 3, "new-item": 4, better: 5 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || RANK[b.to] - RANK[a.to]);
}

/** The newest check is old enough that opening the watch should run the list again (the original page's rule;
 *  the watch page now passes false and the sweep does the daily looking). */
export function due(w: WatchRecord, now = Date.now()): boolean {
  const last = w.checks.at(-1);
  return !last || now - Date.parse(last.at) > RECHECK_AFTER_MS;
}

/** When "check again now" next becomes available for this watch, or null when it is available now. */
export function nextRecheckAt(w: WatchRecord, showcase: boolean, now = Date.now()): string | null {
  const last = w.checks.at(-1);
  if (!last) return null;
  const at = Date.parse(last.at) + (showcase ? RECHECK_MIN_MS.showcase : RECHECK_MIN_MS.normal);
  return at > now ? new Date(at).toISOString() : null;
}

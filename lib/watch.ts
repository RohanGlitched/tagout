import type { CheckRecord } from "./checks";
import type { Item, TagLevel, Verdict } from "./types";
import { normBrand } from "./match";

/**
 * A watched household: the list someone typed, and every check run on it, oldest first. Opening the watch page
 * re-runs the list when the newest check is more than a day old, and the page shows what changed between the
 * last two checks. Nothing runs in the background: there is no scheduler, so a watch only moves when someone
 * opens it.
 */
export type WatchRecord = {
  id: string;
  createdAt: string;
  /** The typed list, one thing per line (photos aren't kept, so photo items can't be watched). */
  text: string;
  checks: { id: string; at: string }[];
};

/** A watch is re-checked on a visit once its newest check is this old. */
export const RECHECK_AFTER_MS = 24 * 3600_000;

export type Change = {
  said: string;
  kind: "worse" | "better" | "new-recall" | "new-item";
  from?: TagLevel;
  to: TagLevel;
  /** The recall behind the new tag, or the recalls that weren't there last time. */
  notices: { ref: string; title: string; url: string }[];
};

const RANK: Record<TagLevel, number> = { inspected: 0, warning: 1, danger: 2 };
const key = (s: string) => normBrand(s).replace(/\s+/g, " ");
const ref = (n: NonNullable<Verdict["notice"]>) => `${n.source}:${n.id}:${n.url}`;
const noticesOf = (v: Verdict) => [v.notice, ...(v.related ?? [])].filter((n): n is NonNullable<Verdict["notice"]> => Boolean(n));

/** The same thing in two checks: same position and brand, or else the same words. */
function partner(item: Item, prev: Item[]): Item | undefined {
  const byPlace = prev.find((p) => p.id === item.id && p.kind === item.kind && key(p.brand ?? p.said) === key(item.brand ?? item.said));
  return byPlace ?? prev.find((p) => key(p.said) === key(item.said)) ?? prev.find((p) => p.kind === item.kind && p.brand && item.brand && key(p.brand) === key(item.brand) && key(p.product ?? "") === key(item.product ?? ""));
}

/**
 * What changed from one check of a household to the next: a tag that got worse or better, a recall published
 * since the earlier check, or a thing that wasn't checked before. Unchanged things are left out.
 */
export function diffChecks(prev: Pick<CheckRecord, "items" | "verdicts"> & { createdAt?: string; finishedAt?: string }, next: Pick<CheckRecord, "items" | "verdicts">): Change[] {
  // A recall counts as new only if it was published after the earlier check; an old recall the search happened to
  // surface this time isn't news.
  const since = (prev.finishedAt ?? prev.createdAt ?? "").slice(0, 10);
  const out: Change[] = [];
  const pv = new Map((prev.verdicts ?? []).map((v) => [v.itemId, v]));
  for (const v of next.verdicts ?? []) {
    const item = next.items?.find((i) => i.id === v.itemId);
    if (!item) continue;
    const before = partner(item, prev.items ?? []);
    const was = before ? pv.get(before.id) : undefined;
    const link = (n: NonNullable<Verdict["notice"]>) => ({ ref: `${n.source.toUpperCase()} ${n.id}`, title: n.title, url: n.url });
    if (!was) {
      out.push({ said: item.said, kind: "new-item", to: v.level, notices: v.notice ? [link(v.notice)] : [] });
      continue;
    }
    if (RANK[v.level] !== RANK[was.level]) {
      out.push({ said: item.said, kind: RANK[v.level] > RANK[was.level] ? "worse" : "better", from: was.level, to: v.level, notices: v.notice ? [link(v.notice)] : [] });
      continue;
    }
    const old = new Set(noticesOf(was).map(ref));
    const added = noticesOf(v).filter((n) => !old.has(ref(n)) && Boolean(n.date) && n.date >= since);
    if (added.length && v.level !== "inspected") out.push({ said: item.said, kind: "new-recall", from: was.level, to: v.level, notices: added.map(link) });
  }
  // Worst news first.
  const order = { worse: 0, "new-recall": 1, "new-item": 2, better: 3 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind] || RANK[b.to] - RANK[a.to]);
}

/** The newest check is old enough that opening the watch should run the list again. */
export function due(w: WatchRecord, now = Date.now()): boolean {
  const last = w.checks.at(-1);
  return !last || now - Date.parse(last.at) > RECHECK_AFTER_MS;
}

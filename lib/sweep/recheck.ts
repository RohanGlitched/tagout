import "server-only";
import type { Notice } from "../types";
import { loadCheck } from "../store";
import { diffChecks } from "../watch";
import { loadWatch } from "../watches";
import { recheckEvents, type WatchEvent } from "./events";
import { appendEvents } from "./store";

/**
 * After a watch's "check again now" finishes: what changed since the check before it, written to the watch's
 * event log (and so its feed) next to what the sweep found.
 */
export async function recordRecheck(watchId: string, checkId: string): Promise<WatchEvent[]> {
  const w = await loadWatch(watchId);
  if (!w) return [];
  const i = w.checks.findIndex((c) => c.id === checkId);
  const cur = await loadCheck(checkId);
  if (!cur || cur.status !== "done" || i < 0) return [];
  let prev = null;
  for (const c of w.checks.slice(0, i).reverse()) {
    const r = await loadCheck(c.id).catch(() => null);
    if (r?.status === "done") {
      prev = r;
      break;
    }
  }
  if (!prev) return [];
  const changes = diffChecks(prev, cur, { all: true });
  const cited = (cur.verdicts ?? []).flatMap((v) => [v.notice, ...(v.related ?? [])]).filter((n): n is Notice => Boolean(n));
  return appendEvents(watchId, recheckEvents(watchId, changes, cur.items ?? [], cited, checkId, cur.finishedAt ?? new Date().toISOString()));
}

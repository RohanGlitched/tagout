import "server-only";
import { SITE_URL } from "../site";
import { isShowcaseWatch, nextRecheckAt, RECHECK_MIN_MS, type WatchRecord } from "../watch";
import type { WatchEvent } from "./events";
import { loadEventLog, loadLatestSweep } from "./store";

/** When the sweep runs (vercel.json's cron), in words the page can print. */
export const SWEEP_SCHEDULE = { cron: "0 6 * * *", label: "every day at about 06:00 UTC" };

/** Everything the watch page needs about the watch's automatic checking, in one object (also served as JSON at
 *  /api/watches/<id>/events). */
export type WatchFeed = {
  watchId: string;
  feedUrl: string;
  schedule: typeof SWEEP_SCHEDULE;
  /** The newest sweep across all watches (null before the first). `matched` says whether it found anything for
   *  this watch. */
  lastSweep: { at: string; ok: boolean; recallsChecked: number; newRecalls: number; matched: number } | null;
  /** Newest first. */
  events: WatchEvent[];
  recheck: { available: boolean; nextAt: string | null; tier: "lite" | "full"; minIntervalMinutes: number; url: string };
};

export async function watchFeed(w: WatchRecord): Promise<WatchFeed> {
  const [log, sweep] = await Promise.all([loadEventLog(w.id), loadLatestSweep()]);
  const showcase = isShowcaseWatch(w.id);
  const next = nextRecheckAt(w, showcase);
  const sweepAt = sweep?.finishedAt || sweep?.startedAt;
  return {
    watchId: w.id,
    feedUrl: `${SITE_URL}/watch/${w.id}/feed.xml`,
    schedule: SWEEP_SCHEDULE,
    lastSweep: sweep && !sweep.skipped
      ? {
          at: sweepAt!,
          ok: Object.values(sweep.sources).some((s) => s.ok),
          recallsChecked: sweep.notices.total,
          newRecalls: sweep.notices.newSinceLastRun,
          matched: log.events.filter((e) => e.origin === "sweep" && sweepAt && e.at >= sweep.startedAt).length,
        }
      : null,
    events: log.events,
    recheck: {
      available: next === null,
      nextAt: next,
      tier: showcase ? "lite" : "full",
      minIntervalMinutes: (showcase ? RECHECK_MIN_MS.showcase : RECHECK_MIN_MS.normal) / 60_000,
      url: `/api/watches/${w.id}/recheck`,
    },
  };
}

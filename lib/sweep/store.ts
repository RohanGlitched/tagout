import "server-only";
import { CHECK_ID } from "../checks";
import { docKey, readDoc, updateDoc, writeDoc } from "../docs";
import { mergeEvents, type EventLog, type WatchEvent } from "./events";
import type { SweepReport } from "./run";

/**
 * Where the sweep keeps its documents (all under SWEEP_PREFIX when set):
 * - events/<watchId>.json: the watch's event log, newest first;
 * - sweep/state.json: when it last ran, a hash of every recall it saw (to count what's new or changed), and how
 *   many sweeps in a row each cited recall has been missing from its agency;
 * - sweep/latest.json and sweep/runs/<time>.json: each run's report, with its measured cost.
 */
export const eventsKey = (watchId: string) => docKey(`events/${watchId}.json`);
const STATE = () => docKey("sweep/state.json");
const LATEST = () => docKey("sweep/latest.json");
const runKey = (stamp: string) => docKey(`sweep/runs/${stamp}.json`);

export async function loadEventLog(watchId: string): Promise<EventLog> {
  const empty: EventLog = { watchId, updatedAt: "", events: [] };
  if (!CHECK_ID.test(watchId)) return empty;
  const r = await readDoc<EventLog>(eventsKey(watchId)).catch((e) => {
    console.error("[events] read failed", (e as Error).message);
    return null;
  });
  return r?.value ?? empty;
}

/** Adds events to a watch's log (those it doesn't already hold); returns the ones added. */
export async function appendEvents(watchId: string, events: WatchEvent[]): Promise<WatchEvent[]> {
  if (!CHECK_ID.test(watchId) || !events.length) return [];
  let added: WatchEvent[] = [];
  await updateDoc<EventLog>(
    eventsKey(watchId),
    () => ({ watchId, updatedAt: "", events: [] }),
    (cur) => {
      const m = mergeEvents(cur.events, events);
      added = m.added;
      return m.added.length ? { watchId, updatedAt: new Date().toISOString(), events: m.events } : null;
    },
  );
  return added;
}

export type SweepState = {
  lastRunAt?: string;
  /** Set while a run is in progress, so a second trigger (a retried cron call) doesn't run alongside it. */
  runningSince?: string;
  runId?: string;
  /** noticeKey → hash of the text last seen. */
  seen: Record<string, string>;
  /** noticeKey of a cited recall → sweeps in a row it was missing from its agency's records. */
  missing: Record<string, number>;
};

export async function loadState(): Promise<SweepState> {
  const r = await readDoc<SweepState>(STATE()).catch(() => null);
  return { seen: {}, missing: {}, ...(r?.value ?? {}) };
}

/** Claims the run: false when another run started less than `staleMs` ago. */
export async function claimRun(runId: string, now: string, staleMs = 10 * 60_000): Promise<boolean> {
  const r = await updateDoc<SweepState>(
    STATE(),
    () => ({ seen: {}, missing: {} }),
    (cur) => (cur.runningSince && Date.parse(now) - Date.parse(cur.runningSince) < staleMs ? null : { ...cur, runningSince: now, runId }),
  ).catch(() => null);
  return Boolean(r && r.runId === runId);
}

export async function finishRun(runId: string, patch: Pick<SweepState, "lastRunAt" | "seen" | "missing">): Promise<void> {
  await updateDoc<SweepState>(
    STATE(),
    () => ({ seen: {}, missing: {} }),
    (cur) => (cur.runId && cur.runId !== runId ? null : { ...cur, ...patch, runningSince: undefined, runId }),
  );
}

export async function releaseRun(runId: string): Promise<void> {
  await updateDoc<SweepState>(
    STATE(),
    () => ({ seen: {}, missing: {} }),
    (cur) => (cur.runId === runId ? { ...cur, runningSince: undefined } : null),
  ).catch(() => {});
}

export async function saveReport(r: SweepReport): Promise<void> {
  const stamp = r.startedAt.replace(/[:.]/g, "-");
  await writeDoc(runKey(stamp), r);
  await writeDoc(LATEST(), r);
}

export async function loadLatestSweep(): Promise<SweepReport | null> {
  return (await readDoc<SweepReport>(LATEST()).catch(() => null))?.value ?? null;
}

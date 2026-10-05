import type { Item, Verdict } from "./types";
import type { Engine, Event } from "./agent/run";

/** One household check, as stored. Photos are kept only until the check has run. */
export type CheckRecord = {
  id: string;
  createdAt: string;
  status: "queued" | "running" | "done" | "failed";
  startedAt?: string;
  finishedAt?: string;
  input: { text: string; photoCount: number };
  photos?: string[];
  items?: Item[];
  dropped?: number;
  verdicts?: Verdict[];
  /** The agent's steps and notice reads, kept so the log replays on a revisit. */
  log?: Extract<Event, { t: "step" | "read" }>[];
  engine?: Engine;
  error?: string;
  /** Curated examples shown on the home page. */
  showcase?: boolean;
};

export const CHECK_ID = /^[a-z0-9]{10}$/;

export function newCheckId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

/** A record as sent to the browser: no photos. */
export function publicCheck(r: CheckRecord): Omit<CheckRecord, "photos"> {
  const { photos: _photos, ...rest } = r;
  return rest;
}

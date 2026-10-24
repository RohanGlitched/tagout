import type { Item, Verdict } from "./types";
import type { Engine, Event } from "./agent/run";
import { relatedForBrand } from "./agent/verdict";

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
  /** The watch this check was queued for ("check again now"); its changes go into the watch's event log. */
  watchId?: string;
  /** "lite": run on the lite tier first (showcase watches), then rules only; never the full tier. */
  prefer?: "lite";
};

export const CHECK_ID = /^[a-z0-9]{10}$/;

export function newCheckId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

/** A record as sent to the browser: no photos. Each tag's "other recalls for this brand" is filtered again, so a
 *  check stored before that filter existed shows only the item's own brand's recalls. */
export function publicCheck(r: CheckRecord): Omit<CheckRecord, "photos"> {
  const { photos: _photos, ...rest } = r;
  if (!rest.verdicts?.length) return rest;
  const items = new Map((rest.items ?? []).map((it) => [it.id, it]));
  const verdicts = rest.verdicts.map((v) => {
    const it = items.get(v.itemId);
    if (!v.related?.length || !it) return v;
    // Stored tags don't say which related notices the matcher hit, so for an item with no brand they all stay.
    return { ...v, related: it.brand ? relatedForBrand(it, v.related) : relatedForBrand(it, v.related, v.related) };
  });
  return { ...rest, verdicts };
}

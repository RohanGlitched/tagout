import { createHash } from "node:crypto";
import type { Item, ItemKind, Notice, Proof, Source, TagLevel, Verdict } from "../types";
import { matchItem, norm } from "../match";
import { buildVerdict } from "../agent/verdict";
import type { WatchChange } from "../watch";
import { itemKey, noticeKey, type Watched } from "./index";

/**
 * A watch's event log: what Tagout found for it, newest first. The daily sweep writes three kinds (a new recall
 * that tags one of the watched things red or orange, a recall the watch already cites that the agency changed,
 * and a cited recall the agency no longer lists); a "check again now" adds what changed between its check and
 * the one before. Every event has a stable id, so a sweep that runs twice, or re-reads the same recall, never
 * adds it twice, and the Atom feed's entry ids never change.
 */
export type EventKind = "new-recall" | "recall-changed" | "recall-dropped" | "tag-changed";

/** A recall as an event carries it: enough for the page and the feed, and the codes it was matched on. */
export type EventNotice = {
  source: Source;
  id: string;
  /** "CPSC 26-532". */
  ref: string;
  title: string;
  date: string;
  url: string;
  firm?: string;
  hazard?: string;
  remedy?: string;
  contact?: string;
  urgent?: string;
  image?: string;
  status?: string;
  models: string[];
  lots: string[];
  upcs: string[];
  /** Hash of the agency text the sweep read (to tell later whether the agency changed it). */
  textHash?: string;
};

export type WatchEvent = {
  id: string;
  kind: EventKind;
  /** When Tagout found it (ISO). */
  at: string;
  origin: "sweep" | "recheck";
  /** The thing's tag now, and before when known. */
  level: TagLevel;
  from?: TagLevel;
  item: { key: string; said: string; kind: ItemKind; brand?: string; model?: string; lot?: string };
  /** One plain sentence. */
  headline: string;
  notice?: EventNotice;
  /** recall-changed: what changed. */
  changes?: ("level" | "codes" | "remedy")[];
  /** Recalls no longer cited (recall-dropped, and tag changes found by a re-check). */
  dropped?: { ref: string; title: string; url: string }[];
  /** A re-check's new-recall event can name more than one recall: all of them, `notice` being the first. */
  also?: { ref: string; title: string; url: string }[];
  proof: Proof[];
  /** What to do, in order. */
  steps: string[];
  /** The check this came from (a re-check), or the check the sweep compared with. */
  checkId?: string;
};

export type EventLog = { watchId: string; updatedAt: string; events: WatchEvent[] };

export const MAX_EVENTS = 200;

export function eventId(...parts: string[]): string {
  return `e${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 15)}`;
}

export const refOf = (n: Pick<Notice, "source" | "id">) => `${n.source === "web" ? n.id : n.source.toUpperCase()} ${n.source === "web" ? "" : n.id}`.trim();

export function eventNotice(n: Notice, textHash?: string): EventNotice {
  return {
    source: n.source,
    id: n.id,
    ref: refOf(n),
    title: n.title,
    date: n.date,
    url: n.url,
    firm: n.firm,
    hazard: n.hazard,
    remedy: n.remedy,
    contact: n.contact,
    urgent: n.urgent,
    image: n.image,
    status: n.status,
    models: n.models,
    lots: n.lots,
    upcs: n.upcs,
    textHash,
  };
}

const itemOf = (it: Item, key = itemKey(it)): WatchEvent["item"] => ({ key, said: it.said, kind: it.kind, brand: it.brand, model: it.model ?? it.codes?.[0], lot: it.lot });

/** A newly published recall that tags a watched thing red or orange (the matcher's verdict on that one recall). */
export function newRecallEvent(e: Watched, v: Verdict, at: string, textHash?: string): WatchEvent | null {
  if (v.level === "inspected" || !v.notice) return null;
  return {
    id: eventId(e.watchId, "new-recall", e.key, noticeKey(v.notice), v.level),
    kind: "new-recall",
    at,
    origin: "sweep",
    level: v.level,
    from: e.level,
    item: itemOf(e.item, e.key),
    headline: v.headline,
    notice: eventNotice(v.notice, textHash),
    proof: v.proof,
    steps: v.steps,
    checkId: e.checkId,
  };
}

const codeSet = (n: Pick<Notice, "models" | "lots" | "upcs">) => new Set([...n.models, ...n.lots, ...n.upcs].map(norm).filter(Boolean));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const squash = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Whether the agency's record still says what it said when the watch cited it. A check's copy of an agency
 * record can carry a recall page Tavily read after it (read_page appends it), so the stored text only has to
 * start with the agency's own text; a child-seat campaign is compared on its subject and summary, since the
 * seats listed after them depend on the search. A sweep event's copy is compared by the hash it recorded.
 */
export function sameRecord(stored: Pick<Notice, "source" | "id" | "text" | "remedy">, fresh: Notice, storedHash?: string, freshHash?: string): boolean {
  if (squash(stored.remedy) !== squash(fresh.remedy)) return false;
  if (storedHash && freshHash) return storedHash === freshHash;
  const a = squash(stored.text), b = squash(fresh.text);
  if (fresh.source === "nhtsa" && /C\d{3}000$/.test(fresh.id)) {
    const head = (t: string | undefined) => squash((t ?? "").split("\n").slice(0, 2).join("\n"));
    return head(stored.text) === head(fresh.text);
  }
  return a === b || a.startsWith(b);
}

/**
 * A recall the watch cites that the agency has changed: the tag the recall now gives the thing, its code list or
 * its remedy (FDA's status is part of the remedy line). `stored` is the copy the watch was tagged with (already
 * read), `fresh` the agency's record read again. Returns null when nothing that matters changed.
 */
export function changeEvent(e: Watched, stored: Notice, fresh: Notice, at: string, textHash?: string): WatchEvent | null {
  const before = matchItem(e.item, stored).level ?? "inspected";
  const nowV = buildVerdict(e.item, [fresh], [fresh.source], at);
  const now = nowV.level;
  // A recall the thing was only compared with (it didn't cover it) matters again only if it now does.
  if (before === "inspected" && now === "inspected") return null;
  const changes: NonNullable<WatchEvent["changes"]> = [];
  if (before !== now) changes.push("level");
  if (!sameSet(codeSet(stored), codeSet(fresh))) changes.push("codes");
  if (squash(stored.remedy) !== squash(fresh.remedy)) changes.push("remedy");
  if (!changes.length) return null;
  const ref = refOf(fresh);
  const RANK = { inspected: 0, warning: 1, danger: 2 } as const;
  const headline =
    before !== now
      ? RANK[now] > RANK[before]
        ? `${ref} was updated, and it now covers yours: ${nowV.headline}`
        : `${ref} was updated, and it no longer lists yours.`
      : changes.includes("codes")
        ? `${ref} was updated: its list of affected models or lots changed. Your tag stays the same.`
        : `${ref} was updated: ${squash(fresh.remedy).slice(0, 180) || "its remedy changed"}`;
  return {
    id: eventId(e.watchId, "recall-changed", e.key, noticeKey(fresh), textHash ?? squash(fresh.text).length.toString(), squash(fresh.remedy)),
    kind: "recall-changed",
    at,
    origin: "sweep",
    level: now,
    from: before,
    item: itemOf(e.item, e.key),
    headline,
    notice: eventNotice(fresh, textHash),
    changes,
    proof: nowV.proof,
    steps: now === "inspected" ? ["Nothing to do for this recall. Tagout keeps watching the others."] : nowV.steps,
    checkId: e.checkId,
  };
}

/** A recall the watch cites that the agency no longer lists (missing on two sweeps running). `rest` are the
 *  other recalls still cited for the thing, which decide its tag now. */
export function droppedEvent(e: Watched, gone: Notice, rest: Notice[], at: string): WatchEvent {
  const v = buildVerdict(e.item, rest, [], at);
  const ref = refOf(gone);
  return {
    id: eventId(e.watchId, "recall-dropped", e.key, noticeKey(gone)),
    kind: "recall-dropped",
    at,
    origin: "sweep",
    level: v.level === "inspected" && e.level && e.level !== "inspected" ? "warning" : v.level,
    from: e.level,
    item: itemOf(e.item, e.key),
    headline: `${ref} is no longer listed in the agency's database. It may have been withdrawn or merged into another recall; confirm on the agency's site before you rely on it either way.`,
    notice: eventNotice(gone),
    dropped: [{ ref, title: gone.title, url: gone.url }],
    proof: [],
    steps: [`Look ${ref} up on the agency's site.`, "Run “check again now” on this watch to tag it against today's recalls."],
    checkId: e.checkId,
  };
}

const WORDS: Record<TagLevel, string> = { danger: "Do not use", warning: "Check the label", inspected: "Checked" };

/**
 * What a "check again now" found, as events: tag changes, new recalls, a different cited recall, recalls
 * dropped. `notices` are the recalls the new check cites, to describe each event's lead recall in full.
 */
export function recheckEvents(watchId: string, changes: WatchChange[], items: Item[], notices: Notice[], checkId: string, at: string): WatchEvent[] {
  const out: WatchEvent[] = [];
  const full = (l: { ref: string; url: string } | undefined) => (l ? notices.find((n) => `${n.source.toUpperCase()} ${n.id}` === l.ref && n.url === l.url) : undefined);
  for (const c of changes) {
    if (c.kind === "new-item") continue;
    const it = items.find((i) => i.said === c.said);
    const key = it ? itemKey(it) : `product:${c.said.toLowerCase()}`;
    const item = it ? itemOf(it, key) : { key, said: c.said, kind: "product" as ItemKind };
    const lead = c.notices[0];
    const kind: EventKind = c.kind === "new-recall" ? "new-recall" : c.kind === "cited-changed" ? "recall-changed" : c.kind === "recall-dropped" ? "recall-dropped" : "tag-changed";
    const headline =
      c.kind === "worse" || c.kind === "better"
        ? `A new check moved this from ${WORDS[c.from ?? "inspected"]} to ${WORDS[c.to]}${lead ? ` (${lead.ref})` : ""}.`
        : c.kind === "new-recall"
          ? `A new check found ${c.notices.length === 1 ? "a recall" : `${c.notices.length} recalls`} published since the last one: ${c.notices.map((n) => n.ref).join(", ")}.`
          : c.kind === "cited-changed"
            ? `The tag stays ${WORDS[c.to]}, but it now cites ${lead?.ref ?? "another recall"}${c.before ? ` instead of ${c.before.ref}` : ""}.`
            : `The tag stays ${WORDS[c.to]}, but it no longer cites ${c.dropped.map((d) => d.ref).join(", ")}.`;
    out.push({
      id: eventId(watchId, "recheck", checkId, kind, key, c.notices.map((n) => n.ref).join(","), c.dropped.map((n) => n.ref).join(",")),
      kind,
      at,
      origin: "recheck",
      level: c.to,
      from: c.from,
      item,
      headline,
      notice: full(lead) ? eventNotice(full(lead)!) : undefined,
      also: c.notices.length ? c.notices : undefined,
      dropped: c.dropped.length ? c.dropped : undefined,
      proof: [],
      steps: [`Open the check for the full tag, the recall's own wording and what to do.`],
      checkId,
    });
  }
  return out;
}

/** Adds events not already in the log (by id), newest first, at most MAX_EVENTS. */
export function mergeEvents(existing: WatchEvent[], add: WatchEvent[]): { events: WatchEvent[]; added: WatchEvent[] } {
  const have = new Set(existing.map((e) => e.id));
  const added = add.filter((e, i) => !have.has(e.id) && add.findIndex((x) => x.id === e.id) === i);
  const events = [...added, ...existing].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, MAX_EVENTS);
  return { events, added };
}

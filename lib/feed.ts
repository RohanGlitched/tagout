import type { TagLevel } from "./types";
import type { WatchEvent } from "./sweep/events";

/**
 * A watch's Atom feed (RFC 4287): one entry per event, newest first, each with an id that never changes (a tag:
 * URI built from the watch and event ids), linking to the watch page. Any feed reader then tells the owner about
 * a new recall without Tagout holding an email address. Nothing here touches storage.
 */
export const TAG_WORDS: Record<TagLevel, string> = { danger: "Do not use", warning: "Check the label", inspected: "Checked" };

const KIND_WORDS: Record<WatchEvent["kind"], string> = {
  "new-recall": "New recall",
  "recall-changed": "Recall changed",
  "recall-dropped": "Recall no longer listed",
  "tag-changed": "Tag changed",
};

const TAG_AUTHORITY = "tagout-recalls.vercel.app,2026-10-01";

export const feedId = (watchId: string) => `tag:${TAG_AUTHORITY}:watch/${watchId}`;
export const entryId = (watchId: string, eventId: string) => `tag:${TAG_AUTHORITY}:watch/${watchId}/${eventId}`;

/** XML text: the five entities escaped, and characters XML 1.0 can't carry dropped. */
export function xml(s: string | undefined): string {
  return (s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** HTML text inside an entry's content (then escaped again as XML): &#39; rather than &apos;, which HTML 4 lacks. */
const h = (s: string | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The entry's plain summary: the headline, then the recall it is about. */
export function entrySummary(e: WatchEvent): string {
  return e.notice ? `${e.headline} ${e.notice.ref}: ${e.notice.title}` : e.headline;
}

/** "Do not use: Vornado space heater (new recall, CPSC 27-041)". */
export function entryTitle(e: WatchEvent): string {
  return `${TAG_WORDS[e.level]}: ${e.item.said} (${KIND_WORDS[e.kind].toLowerCase()}${e.notice ? `, ${e.notice.ref}` : ""})`;
}

function entryHtml(e: WatchEvent): string {
  const n = e.notice;
  const parts = [`<p><strong>${h(TAG_WORDS[e.level])}</strong>: ${h(e.item.said)}</p>`, `<p>${h(e.headline)}</p>`];
  if (n) parts.push(`<p><a href="${h(n.url)}">${h(n.ref)}</a>${n.date ? ` (${h(n.date)})` : ""}: ${h(n.title)}</p>`);
  if (n?.hazard) parts.push(`<p>Hazard: ${h(n.hazard)}</p>`);
  if (e.steps.length) parts.push(`<ol>${e.steps.map((s) => `<li>${h(s)}</li>`).join("")}</ol>`);
  return parts.join("");
}

export type FeedInput = {
  site: string;
  watchId: string;
  createdAt: string;
  /** How many things the watch holds. */
  things: number;
  events: WatchEvent[];
  /** The newest sweep's time, so the feed's <updated> moves when the watch was checked even with no news. */
  lastSweepAt?: string;
};

export function atomFeed(f: FeedInput): string {
  const page = `${f.site}/watch/${f.watchId}`;
  const self = `${page}/feed.xml`;
  const events = [...f.events].sort((a, b) => b.at.localeCompare(a.at));
  const updated = [events[0]?.at, f.lastSweepAt, f.createdAt].filter(Boolean).sort().at(-1)!;
  const started = `  <entry>
    <id>${entryId(f.watchId, "started")}</id>
    <title>Watching ${f.things} ${f.things === 1 ? "thing" : "things"} for recalls</title>
    <updated>${xml(f.createdAt)}</updated>
    <published>${xml(f.createdAt)}</published>
    <link rel="alternate" type="text/html" href="${xml(page)}"/>
    <summary>Tagout checks every new CPSC, FDA and NHTSA recall against this list once a day and adds an entry here when one covers something on it.</summary>
  </entry>`;
  const entries = events.map(
    (e) => `  <entry>
    <id>${entryId(f.watchId, e.id)}</id>
    <title>${xml(entryTitle(e))}</title>
    <updated>${xml(e.at)}</updated>
    <published>${xml(e.at)}</published>
    <link rel="alternate" type="text/html" href="${xml(`${page}#${e.id}`)}"/>${e.notice?.url ? `\n    <link rel="related" type="text/html" href="${xml(e.notice.url)}"/>` : ""}
    <category term="${xml(e.kind)}" label="${xml(KIND_WORDS[e.kind])}"/>
    <category term="${xml(e.level)}" label="${xml(TAG_WORDS[e.level])}"/>
    <summary>${xml(entrySummary(e))}</summary>
    <content type="html">${xml(entryHtml(e))}</content>
  </entry>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${feedId(f.watchId)}</id>
  <title>Tagout watch: recalls for your things</title>
  <subtitle>New recalls that cover something on this watched list, checked daily against CPSC, FDA and NHTSA.</subtitle>
  <updated>${xml(updated)}</updated>
  <link rel="self" type="application/atom+xml" href="${xml(self)}"/>
  <link rel="alternate" type="text/html" href="${xml(page)}"/>
  <author><name>Tagout</name><uri>${xml(f.site)}</uri></author>
  <generator uri="${xml(f.site)}">Tagout</generator>
  <icon>${xml(`${f.site}/icon.svg`)}</icon>
${[...entries, started].join("\n")}
</feed>
`;
}

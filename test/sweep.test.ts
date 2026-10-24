import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, candidates, itemKey, lookup, noticeKeys, relevant, type Watched } from "../lib/sweep/index.ts";
import { changeEvent, droppedEvent, eventId, mergeEvents, newRecallEvent, recheckEvents, sameRecord, type WatchEvent } from "../lib/sweep/events.ts";
import { atomFeed, entryId } from "../lib/feed.ts";
import { buildVerdict } from "../lib/agent/verdict.ts";
import { diffChecks } from "../lib/watch.ts";
import type { Item, Notice } from "../lib/types.ts";

const N = (o: Partial<Notice> & Pick<Notice, "id">): Notice => ({ source: "cpsc", title: `Recall ${o.id}`, date: "2026-10-22", url: `https://www.cpsc.gov/Recalls/2026/${o.id}`, models: [], lots: [], upcs: [], ...o });
const W = (watchId: string, item: Item, o: Partial<Watched> = {}): Watched => ({ watchId, key: itemKey(item), item, checkedAt: "2026-10-15T09:00:00Z", known: new Set(), ...o });

const heater: Item = { id: "i1", kind: "product", said: "Vornado space heater, TYPE SRTH on the label", brand: "Vornado", product: "space heater", codes: ["SRTH"] };
const lasko: Item = { id: "i5", kind: "product", said: "Lasko ceramic tower heater, model CT22425", brand: "Lasko", product: "ceramic tower heater", model: "CT22425" };
const tylenol: Item = { id: "i2", kind: "drug", said: "Tylenol Extra Strength caplets, lot EJA022", brand: "Tylenol", product: "Extra Strength caplets", lot: "EJA022" };
const crv: Item = { id: "i3", kind: "vehicle", said: "2019 Honda CR-V", brand: "Honda", product: "CR-V", year: 2019 };
const seat: Item = { id: "i4", kind: "car-seat", said: "Evenflo car seat", brand: "Evenflo", product: "car seat" };
const seeds: Item = { id: "i1", kind: "food", said: "Gardeners Basics broccoli sprouting seeds", brand: "Gardeners Basics", product: "broccoli sprouting seeds" };

const towerRecall = N({ id: "27-041", title: "Vornado Air Recalls Tower Heaters Due to Fire Hazard", firm: "Vornado Air", text: "Vornado Air Recalls Tower Heaters\nThe recall involves tower heaters with TYPE SRTH and TYPE TVH printed on the label." });
const steamerRecall = N({ id: "27-050", title: "Vornado Recalls Garment Steamers Due to Burn Hazard", firm: "Vornado Air", text: "This recall involves Vornado garment steamers, model ST100." });

test("the index finds a watched brand in a recall's title and a watched code in its text", () => {
  const a = W("aaaaaaaaaa", heater), b = W("bbbbbbbbbb", lasko), c = W("cccccccccc", tylenol);
  const idx = buildIndex([a, b, c]);
  assert.deepEqual(lookup(idx, towerRecall), [a]);
  // A code printed in another brand's recall is found too (the relevance rules then decide).
  const other = N({ id: "27-060", title: "Acme Recalls Heaters", firm: "Acme", text: "Models CT22425B and CT22425 are affected." });
  assert.deepEqual(lookup(idx, other), [b]);
  const fda = N({ source: "fda", id: "D-0001-2027", title: "TYLENOL, Acetaminophen, Extra Strength, 24 Caplets", firm: "Kenvue", category: "Drugs", text: "TYLENOL Extra Strength\nLot EJA023, EJA024" });
  assert.deepEqual(lookup(idx, fda), [c]);
  assert.equal(idx.brands.has("vornado"), true);
  assert.equal(idx.codes.has("CT22425"), true);
});

test("each distinct vehicle and car-seat brand is one NHTSA query, however many watches hold it", () => {
  const idx = buildIndex([W("aaaaaaaaaa", crv), W("bbbbbbbbbb", { ...crv, id: "i9" }), W("aaaaaaaaaa", seat), W("bbbbbbbbbb", seat)]);
  assert.equal(idx.vehicles.size, 1);
  assert.equal([...idx.vehicles.values()][0].entries.length, 2);
  assert.equal(idx.seats.size, 1);
});

test("same brand is not enough: the recall must be the same kind of product", () => {
  const e = W("aaaaaaaaaa", { ...heater, codes: undefined });
  assert.equal(relevant(e, towerRecall), "brand");
  assert.equal(relevant(e, steamerRecall), null);
  // A drug never matches a CPSC record.
  assert.equal(relevant(W("x", tylenol), N({ id: "27-1", title: "Tylenol Extra Strength caplet toy", firm: "Tylenol" })), null);
});

test("a distinctive code in another brand's recall counts; a short one doesn't", () => {
  const e = W("aaaaaaaaaa", lasko);
  assert.equal(relevant(e, N({ id: "27-060", title: "Acme Recalls Heaters", firm: "Acme", text: "Model CT22425 is affected." })), "code");
  const short = W("aaaaaaaaaa", { ...lasko, model: "1200" });
  assert.equal(relevant(short, N({ id: "27-061", title: "Acme Recalls Fans", firm: "Acme", text: "Model 1200 is affected." })), null);
});

test("a recall the watch already cites, or one older than its last check by more than the lag, is not new", () => {
  const known = W("aaaaaaaaaa", heater, { known: new Set(noticeKeys(towerRecall)) });
  assert.equal(candidates(buildIndex([known]), towerRecall).length, 0);
  const fresh = buildIndex([W("aaaaaaaaaa", heater)]);
  assert.equal(candidates(fresh, towerRecall).length, 1);
  assert.equal(candidates(fresh, { ...towerRecall, date: "2026-08-01" }).length, 0);
  // The CPSC newsroom page (web) and the database record of one recall are known as one.
  const web: Notice = { ...towerRecall, source: "web", id: "CPSC newsroom", title: "Vornado Air Recalls Tower Heaters Due to Fire Hazard | CPSC.gov" };
  assert.ok(noticeKeys(web).some((k) => noticeKeys(towerRecall).includes(k)));
});

test("a new recall that lists the watched code becomes a red event with a stable id", () => {
  const e = W("aaaaaaaaaa", heater, { level: "inspected", checkId: "kj6iutme8c" });
  const read = { ...towerRecall, models: ["SRTH", "TVH"] };
  const ev = newRecallEvent(e, buildVerdict(e.item, [read], ["cpsc"], "2026-10-26T06:00:00Z"), "2026-10-26T06:00:00Z")!;
  assert.equal(ev.kind, "new-recall");
  assert.equal(ev.level, "danger");
  assert.equal(ev.from, "inspected");
  assert.equal(ev.notice?.ref, "CPSC 27-041");
  // Same watch, thing, recall and tag on another day: the same id, so it is never added twice.
  const again = newRecallEvent(e, buildVerdict(e.item, [read], ["cpsc"], "2026-10-27T06:00:00Z"), "2026-10-27T06:00:00Z")!;
  assert.equal(again.id, ev.id);
  const m = mergeEvents([ev], [again]);
  assert.equal(m.added.length, 0);
  assert.equal(m.events.length, 1);
  // A recall that names the brand but no code is orange; one whose list doesn't include the code gives no event.
  const plain = { ...heater, codes: undefined };
  assert.equal(newRecallEvent(W("aaaaaaaaaa", plain), buildVerdict(plain, [towerRecall], ["cpsc"], "2026-10-26"), "2026-10-26")?.level, "warning");
  const other = N({ id: "27-070", title: "Lasko Recalls Tower Heaters", firm: "Lasko", models: ["CT22410"], text: "Lasko tower heaters model CT22410" });
  assert.equal(newRecallEvent(W("bbbbbbbbbb", lasko), buildVerdict(lasko, [other], ["cpsc"], "2026-10-26"), "2026-10-26"), null);
});

test("merging keeps the newest first and drops repeats", () => {
  const mk = (id: string, at: string): WatchEvent => ({ id, kind: "new-recall", at, origin: "sweep", level: "warning", item: { key: "k", said: "x", kind: "product" }, headline: "", proof: [], steps: [] });
  const m = mergeEvents([mk("e1", "2026-10-20")], [mk("e2", "2026-10-26"), mk("e2", "2026-10-26"), mk("e1", "2026-10-27")]);
  assert.deepEqual(m.events.map((e) => e.id), ["e2", "e1"]);
  assert.deepEqual(m.added.map((e) => e.id), ["e2"]);
  assert.notEqual(eventId("a", "b"), eventId("a", "c"));
});

test("a cited recall that now lists the watched code is a 'recall changed' event; an unchanged one is not", () => {
  const e = W("aaaaaaaaaa", lasko, { level: "warning" });
  const stored = N({ id: "26-900", title: "Lasko Recalls Ceramic Tower Heaters", firm: "Lasko", text: "Lasko ceramic tower heaters. Model numbers are printed on the label." });
  const updated = { ...stored, text: `${stored.text}\nAffected: CT22425 and CT22410.`, models: ["CT22425", "CT22410"] };
  assert.equal(sameRecord(stored, stored), true);
  // A check's copy can carry a page Tavily read after the agency's text.
  assert.equal(sameRecord({ ...stored, text: `${stored.text}\nPage read by Tavily` }, stored), true);
  assert.equal(sameRecord(stored, updated), false);
  const ev = changeEvent(e, stored, updated, "2026-10-26T06:00:00Z")!;
  assert.equal(ev.kind, "recall-changed");
  assert.equal(ev.from, "warning");
  assert.equal(ev.level, "danger");
  assert.deepEqual(ev.changes, ["level", "codes"]);
  assert.equal(changeEvent(e, stored, stored, "2026-10-26"), null);
  // A remedy change (FDA's status lives in it) is reported with the tag unchanged.
  assert.deepEqual(changeEvent(e, stored, { ...stored, remedy: "This recall is terminated." }, "2026-10-26")?.changes, ["remedy"]);
});

test("a dropped recall names itself and doesn't turn the thing green on its own", () => {
  const e = W("aaaaaaaaaa", seat, { level: "warning" });
  const gone = N({ source: "nhtsa", id: "25C003000", title: "Evenflo car seats: Missing registration card", firm: "Evenflo" });
  const ev = droppedEvent(e, gone, [], "2026-10-26");
  assert.equal(ev.kind, "recall-dropped");
  assert.equal(ev.level, "warning");
  assert.deepEqual(ev.dropped?.map((d) => d.ref), ["NHTSA 25C003000"]);
});

test("a re-check's changes become events, with one id per check", () => {
  const n1 = N({ id: "26-532", title: "Vornado SRTH" });
  const prev = { items: [heater], verdicts: [{ itemId: "i1", level: "inspected" as const, headline: "", proof: [], steps: [], checkedAt: "", searched: [] }] };
  const next = { items: [heater], verdicts: [{ itemId: "i1", level: "danger" as const, headline: "", notice: n1, proof: [], steps: [], checkedAt: "", searched: [] }] };
  const evs = recheckEvents("aaaaaaaaaa", diffChecks(prev, next, { all: true }), [heater], [n1], "chk1234567", "2026-10-26T10:00:00Z");
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, "tag-changed");
  assert.equal(evs[0].notice?.ref, "CPSC 26-532");
  assert.match(evs[0].headline, /from Checked to Do not use/);
  assert.notEqual(recheckEvents("aaaaaaaaaa", diffChecks(prev, next, { all: true }), [heater], [n1], "chk7654321", "2026-10-26T10:00:00Z")[0].id, evs[0].id);
});

test("an FDA company announcement is matched to its watched food by brand and product words, a bread recall isn't", () => {
  const e = W("aaaaaaaaaa", seeds);
  const web = N({ source: "web", id: "FDA website", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/gardeners-basics-recalls", title: "Gardeners Basics Recalls Waltham 29 Broccoli Sprouting Seeds", text: "Gardeners Basics recalls broccoli sprouting seeds because of possible Salmonella." });
  assert.equal(relevant(e, web), "brand");
  const bread = N({ source: "web", id: "FDA website", url: "https://www.fda.gov/x", title: "Prince Sesame FRENCH BREAD; LONG FRENCH; Net Wt. 10 oz", text: "Prince Sesame bread" });
  assert.equal(relevant(e, bread), null);
});

test("the Atom feed has stable entry ids, escapes text and links each entry to the watch page", () => {
  const e = W("5ehharz7sr", heater, { level: "inspected" });
  const read = { ...towerRecall, title: "Vornado <Tower> Heaters & Fans", models: ["SRTH"] };
  const ev = newRecallEvent(e, buildVerdict(e.item, [read], ["cpsc"], "2026-10-26T06:00:00Z"), "2026-10-26T06:00:00Z")!;
  const xml = atomFeed({ site: "https://tagout-recalls.vercel.app", watchId: "5ehharz7sr", createdAt: "2026-10-15T09:16:55.101Z", things: 5, events: [ev], lastSweepAt: "2026-10-26T06:02:00Z" });
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.ok(xml.includes(`<id>${entryId("5ehharz7sr", ev.id)}</id>`));
  assert.ok(xml.includes(`<id>tag:tagout-recalls.vercel.app,2026-10-01:watch/5ehharz7sr/started</id>`));
  assert.ok(xml.includes(`href="https://tagout-recalls.vercel.app/watch/5ehharz7sr#${ev.id}"`));
  assert.ok(xml.includes(`rel="self" type="application/atom+xml" href="https://tagout-recalls.vercel.app/watch/5ehharz7sr/feed.xml"`));
  assert.ok(xml.includes("Vornado &lt;Tower&gt; Heaters &amp; Fans"));
  assert.ok(!/<Tower>/.test(xml));
  assert.match(xml, /<updated>2026-10-26T06:02:00Z<\/updated>/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2);
  assert.equal((xml.match(/<entry>/g) ?? []).length, (xml.match(/<\/entry>/g) ?? []).length);
  // The same events give the same feed.
  assert.equal(atomFeed({ site: "https://tagout-recalls.vercel.app", watchId: "5ehharz7sr", createdAt: "2026-10-15T09:16:55.101Z", things: 5, events: [ev], lastSweepAt: "2026-10-26T06:02:00Z" }), xml);
});

test("FDA recalls of one event (one link, several recall numbers) and pages that differ in their query stay apart", () => {
  const a = N({ source: "fda", id: "D-0001-2027", url: "https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=1" });
  const b = N({ source: "fda", id: "D-0002-2027", url: "https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=1" });
  assert.ok(!noticeKeys(a).some((k) => noticeKeys(b).includes(k)));
  const c = N({ source: "web", id: "FDA website", url: "https://www.fda.gov/x?id=1" });
  const d = N({ source: "web", id: "FDA website", url: "https://www.fda.gov/x?id=2", title: "Other" });
  assert.ok(!noticeKeys(c).some((k) => noticeKeys(d).includes(k)));
  assert.ok(!noticeKeys(a).some((k) => noticeKeys(b).includes(k)));
});

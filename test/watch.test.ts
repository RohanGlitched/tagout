import { test } from "node:test";
import assert from "node:assert/strict";
import { diffChecks, due, RECHECK_AFTER_MS, type WatchRecord } from "../lib/watch.ts";
import type { Item, Notice, Verdict } from "../lib/types.ts";

const notice = (id: string): Notice => ({ source: "cpsc", id, title: `Recall ${id}`, date: "2026-10-01", url: `https://www.cpsc.gov/Recalls/${id}`, models: [], lots: [], upcs: [] });
const item = (id: string, said: string, brand: string): Item => ({ id, kind: "product", said, brand });
const verdict = (itemId: string, level: Verdict["level"], n?: Notice, related: Notice[] = []): Verdict => ({ itemId, level, headline: "", notice: n, related, proof: [], steps: [], checkedAt: "2026-10-15", searched: ["cpsc"] });

const heater = item("i1", "Vornado heater, TYPE SRTH", "Vornado");
const fan = item("i2", "Lasko fan", "Lasko");

test("a tag that got worse leads the changes", () => {
  const prev = { items: [heater, fan], verdicts: [verdict("i1", "inspected"), verdict("i2", "inspected")] };
  const next = { items: [heater, fan], verdicts: [verdict("i1", "danger", notice("26-532")), verdict("i2", "inspected")] };
  const d = diffChecks(prev, next);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, "worse");
  assert.equal(d[0].from, "inspected");
  assert.equal(d[0].to, "danger");
  assert.equal(d[0].notices[0].ref, "CPSC 26-532");
});

test("an unchanged household has no changes", () => {
  const prev = { items: [heater], verdicts: [verdict("i1", "warning", notice("26-1"))] };
  assert.deepEqual(diffChecks(prev, prev), []);
});

test("a new recall for the same orange tag is reported, a green one is not", () => {
  const prev = { items: [heater, fan], verdicts: [verdict("i1", "warning", notice("26-1")), verdict("i2", "inspected", undefined, [notice("25-9")])] };
  const next = { items: [heater, fan], verdicts: [verdict("i1", "warning", notice("26-1"), [notice("27-3")]), verdict("i2", "inspected", undefined, [notice("25-9"), notice("27-4")])] };
  const d = diffChecks(prev, next);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, "new-recall");
  assert.deepEqual(d[0].notices.map((n) => n.ref), ["CPSC 27-3"]);
});

test("things are paired by words when the reader numbers them differently", () => {
  const prev = { items: [item("i2", "Vornado heater, TYPE SRTH", "Vornado"), item("i1", "Lasko fan", "Lasko")], verdicts: [verdict("i2", "danger", notice("26-532")), verdict("i1", "inspected")] };
  const next = { items: [heater, fan], verdicts: [verdict("i1", "danger", notice("26-532")), verdict("i2", "inspected")] };
  assert.deepEqual(diffChecks(prev, next), []);
});

test("better news sorts last, new things in between", () => {
  const prev = { items: [heater], verdicts: [verdict("i1", "danger", notice("26-532"))] };
  const next = { items: [heater, fan], verdicts: [verdict("i1", "warning", notice("26-532")), verdict("i2", "warning", notice("27-1"))] };
  assert.deepEqual(diffChecks(prev, next).map((c) => c.kind), ["new-item", "better"]);
});

test("a watch is due once its newest check is a day old", () => {
  const w: WatchRecord = { id: "abcdefghij", createdAt: "2026-10-01T00:00:00Z", text: "x", checks: [{ id: "a", at: "2026-10-14T10:00:00Z" }] };
  const t = Date.parse("2026-10-14T10:00:00Z");
  assert.equal(due(w, t + RECHECK_AFTER_MS - 1), false);
  assert.equal(due(w, t + RECHECK_AFTER_MS + 1), true);
  assert.equal(due({ ...w, checks: [] }, t), true);
});

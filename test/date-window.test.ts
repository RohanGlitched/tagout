// A best-by or use-by window printed in a record's own code field, compared without a model (held-out set #2 found a
// listed UPC tagged red although its best-by date was outside the window). Made-up products.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateWindowIn, looseDate, matchItem } from "../lib/match.ts";
import type { Item, Notice } from "../lib/types.ts";

test("dates in the forms households and records print them", () => {
  assert.equal(looseDate("06/20/2027"), "2027-06-20");
  assert.equal(looseDate("best by 2/14/27"), "2027-02-14");
  assert.equal(looseDate("2027-03-30"), "2027-03-30");
  assert.equal(looseDate("August 14th, 2026"), "2026-08-14");
  assert.equal(looseDate("lot 26-225"), null);
  assert.equal(looseDate("13/40/2026"), null);
});

test("one best-by window per record, or none", () => {
  assert.deepEqual(dateWindowIn("Best By: all dates through 3/30/2027"), { from: "1900-01-01", to: "2027-03-30" });
  assert.deepEqual(dateWindowIn("Best If Used By Dates from August 14th, 2026 to September 25th, 2026."), { from: "2026-08-14", to: "2026-09-25" });
  assert.equal(dateWindowIn("Lot 552013 EXP 01/2028"), null);
  assert.equal(dateWindowIn("Best by 1/1/2027 through 2/1/2027; Best by 5/1/2027 through 6/1/2027"), null);
});

const record = (code: string): Notice => ({
  source: "fda",
  id: "H-0001-2027",
  title: "Pizzeria frozen cheese pizza",
  date: "2026-10-14",
  url: "https://example.org",
  models: [],
  lots: [],
  upcs: ["012345678905"],
  text: `Pizzeria Frozen Cheese Pizza, 17 oz, UPC 0 12345 67890 5\n${code}\nUndeclared soy`,
});
const pizza = (said: string, made?: string): Item => ({ id: "i1", kind: "food", said, brand: "Pizzeria", product: "frozen cheese pizza", upc: "012345678905", made });

test("a listed UPC is red inside the best-by window and not red outside it", () => {
  const n = record("Best By: all dates through 3/30/2027");
  assert.equal(matchItem(pizza("Pizzeria pizza UPC 012345678905 best by 2/14/27", "best by 2/14/27"), n).level, "danger");
  assert.notEqual(matchItem(pizza("Pizzeria pizza UPC 012345678905 best by 06/20/2027", "06/20/2027"), n).level, "danger");
  // No date given: the UPC alone still decides, as before.
  assert.equal(matchItem(pizza("Pizzeria pizza UPC 012345678905"), n).level, "danger");
});

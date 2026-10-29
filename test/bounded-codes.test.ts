// Codes a notice bounds instead of listing (held-out set #2, g01 and g03), on made-up notices in the agencies' own
// wording: a two-group serial inside a printed from-to pair, and a prefix followed by a number in a printed range.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedCode, matchItem } from "../lib/match.ts";
import type { Item, Notice } from "../lib/types.ts";

const LOCKS =
  "Only keys made after March 2023 are included. Name Serial number From To ACME LOCK 1 DT 00000 2303 00000 2607 ACME FLEX COIL 15 00010 2303 00010 2607 ACME FLEX COIL 12 00011 2303 00011 2607";
const CLEANER =
  "The recall involves scented Shinewell cleaners with date codes beginning with the prefix “QX02” and followed by a five-digit number between 25091 and 26168, which represents products produced between April 1, 2025 to June 17, 2026.";

const notice = (title: string, text: string): Notice => ({ source: "cpsc", id: "27-999", title, date: "2026-10-01", url: "https://example.org", models: [], lots: [], upcs: [], text });
const item = (n: Partial<Item>): Item => ({ id: "i1", kind: "product", said: "x", ...n });

test("a two-group serial is compared with the from-to pair of its own first group", () => {
  assert.deepEqual(boundedCode(item({ serial: "00010 2450" }), LOCKS), { yours: "00010 2450", theirs: "serial range 00010 2303 to 00010 2607", inside: true, how: "range" });
  assert.equal(boundedCode(item({ serial: "00010 2650" }), LOCKS)?.inside, false);
  // Another line's first group, or one the notice doesn't print: no bound.
  assert.equal(boundedCode(item({ serial: "00012 2450" }), LOCKS), null);
  assert.equal(boundedCode(item({ serial: "2450" }), LOCKS), null);
});

test("a prefix and a number are compared with the printed number range", () => {
  assert.equal(boundedCode(item({ made: "QX02 25230" }), CLEANER)?.inside, true);
  assert.equal(boundedCode(item({ codes: ["date code QX02 26200"] }), CLEANER)?.inside, false);
  assert.equal(boundedCode(item({ made: "QX03 25230" }), CLEANER), null);
  assert.equal(boundedCode(item({ made: "QX02 2523" }), CLEANER), null);
});

test("inside the bound is red, outside it the recall doesn't cover the item", () => {
  const locks = notice("Acme Recalls LED-Light Keys Included with Flex Bike Lock Sets", LOCKS);
  assert.equal(matchItem(item({ brand: "Acme", product: "Flex Coil 15 bike lock", serial: "00010 2450" }), locks).level, "danger");
  assert.equal(matchItem(item({ brand: "Acme", product: "Flex Coil 15 bike lock", serial: "00010 2650" }), locks).level, null);
  const cleaner = notice("Shinewell Recalls Scented Cleaners Due to Risk of Exposure to Bacteria", CLEANER);
  assert.equal(matchItem(item({ brand: "Shinewell", product: "cleaner", made: "QX02 25230" }), cleaner).level, "danger");
  assert.notEqual(matchItem(item({ brand: "Shinewell", product: "cleaner", made: "QX02 26200" }), cleaner).level, "danger");
  // Another brand's item never borrows the bound.
  assert.notEqual(matchItem(item({ brand: "Brightly", product: "cleaner", made: "QX02 25230" }), cleaner).level, "danger");
});

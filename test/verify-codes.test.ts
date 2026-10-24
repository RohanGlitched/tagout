import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCodes } from "../lib/agent/verify-codes.ts";

const v = (codes: Partial<{ models: string[]; lots: string[]; upcs: string[] }>, text: string) => verifyCodes({ models: [], lots: [], upcs: [], ...codes }, text);

test("a code spelled across a word edge is not printed", () => {
  const text = "This recall involves model number NS-RGFGSS1. Model NS-RGFGSS3 is not included in this recall.";
  const r = v({ models: ["NS-RGFGSS1", "SS1MODEL", "RGFG", "GSS"] }, text);
  assert.deepEqual(r.models, ["NS-RGFGSS1"]);
  assert.deepEqual(r.struck, ["SS1MODEL", "RGFG", "GSS"]);
});

test("a code printed only in a 'not included' sentence is struck", () => {
  const text = "This recall involves model number NS-RGFGSS1. Model NS-RGFGSS3 is not included in this recall.";
  const r = v({ models: ["NS-RGFGSS1", "NS-RGFGSS3"] }, text);
  assert.deepEqual(r.models, ["NS-RGFGSS1"]);
  assert.deepEqual(r.excluded, ["NS-RGFGSS3"]);
  // Printed in a listing sentence as well: it stands.
  assert.deepEqual(v({ models: ["NS-RGFGSS3"] }, "Models NS-RGFGSS1 and NS-RGFGSS3 are recalled. Model NS-RGFGSS3 sold after June is not affected.").models, ["NS-RGFGSS3"]);
});

test("a range needs both ends printed", () => {
  const text = "Affected units have serial numbers 2LC1234 through 2LC1240 on the rating label.";
  assert.deepEqual(v({ lots: ["2LC1234 through 2LC1240"] }, text).lots, ["2LC1234 through 2LC1240"]);
  const r = v({ lots: ["2LC1234 through 2LC1299"] }, text);
  assert.deepEqual(r.lots, []);
  assert.deepEqual(r.struck, ["2LC1234 through 2LC1299"]);
});

test("prose and paths a reader strays into are dropped without being reported as struck codes", () => {
  const r = v({ models: ["/usr/local/bin/python", "the notice lists every unit sold since spring"] }, "Model 5160 heaters.");
  assert.deepEqual(r.models, []);
  assert.deepEqual(r.struck, []);
});

test("a UPC printed in groups passes with or without its spaces; a lot glued to its label passes", () => {
  const text = "Gelatelli Coffee & Vanilla Gelato 16 FL OZ (1 PT) UPC 4 0564897 22458 Lot: 085261 Best By MAR/26/2028. Also LOT123456.";
  const r = v({ upcs: ["4 0564897 22458", "4056489722458", "0564897224"], lots: ["085261", "123456"] }, text);
  assert.deepEqual(r.upcs, ["4 0564897 22458", "4056489722458"]);
  assert.deepEqual(r.lots, ["085261", "123456"]);
});

test("a two-part lot survives; its neighbour and a part of a longer code don't", () => {
  const text = "Gatorade Lemon Lime 28 oz, Lot 091026 DL - JUN 07 27 and Lot 091026 TL.";
  const r = v({ lots: ["091026 DL", "091026DL", "091226 DL", "0607"] }, text);
  assert.deepEqual(r.lots, ["091026 DL", "091026DL"]);
  assert.deepEqual(r.struck, ["091226 DL", "0607"]);
});

test("product names: accents, symbols, a plural and a sentence end the name itself prints", () => {
  const text = "This recall involves bébé brand baby food makers and Colorful Hearts Teddy Bears. LEADER™ Eye Drops. 28 oz. Gatorade Lemon Lime.";
  const r = v({ models: ["bébé brand baby food maker", "Colorful Hearts Teddy Bear", "LEADER™", "28 oz. Gatorade Lemon Lime"] }, text);
  assert.equal(r.models.length, 4);
});

test("a wildcard family code must be printed with its star", () => {
  assert.deepEqual(v({ models: ["5160*"] }, "Models 5160* and 5170 are included.").models, ["5160*"]);
  assert.deepEqual(v({ models: ["5160*"] }, "Model 5160 is included.").models, []);
});

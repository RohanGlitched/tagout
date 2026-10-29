// A USDA FSIS recall's product list (a PDF read through Tavily Extract, lib/sources/web.ts) appended to the page:
// a UPC and a lot count together only on the same row. Made-up products in the list's own layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchItem, PRODUCT_LIST_MARK, splitProductList } from "../lib/match.ts";
import { productRows } from "../lib/sources/web.ts";
import type { Item, Notice } from "../lib/types.ts";

const PDF =
  "SKU # UPC Code Master UPC Code Unit Lot # Name Expiration date Manufacturing date Establishment Number Shelf Life " +
  "2001 4012302001 040123020016 26-203 BRANDO DELI 12OZ FRANK 2026-10-15 2026-07-22 1234 85 " +
  "2018 4012302018 040123020184 26-225 BRANDO 8:1 LOWER SODIUM HOT DOG 2026-10-25 2026-08-13 1234 73 " +
  "2042 4012302042 040123020429 26-208 BRANDO BEEF FRANK 2026-10-20 2026-07-27 1234 85";

const page = "026-2026 HIGH - CLASS I\nBrando Foods Recalls Meat and Poultry Products Due to Possible Temperature Abuse\nThe products bear establishment number EST. 1234.";
const notice = (withList: boolean): Notice => ({
  source: "web",
  id: "USDA FSIS",
  title: "Brando Foods Recalls Meat and Poultry Products",
  date: "2026-10-17",
  url: "https://www.fsis.usda.gov/recalls-alerts/brando-foods-recalls",
  models: [],
  lots: [],
  upcs: [],
  text: withList ? `${page}${PRODUCT_LIST_MARK}https://example.org/list.pdf\n${productRows(PDF)}` : page,
});
const hotdog = (n: Partial<Item>): Item => ({ id: "i1", kind: "food", said: "Brando hot dogs", brand: "Brando", product: "hot dogs", ...n });

test("the product list is cut into one line per product row", () => {
  const rows = productRows(PDF).split("\n");
  assert.equal(rows.length, 4);
  assert.ok(rows[2].startsWith("2018 4012302018 040123020184 26-225"));
  const [own, list] = splitProductList(notice(true).text);
  assert.equal(own, page);
  assert.ok(list?.includes("26-208"));
  assert.deepEqual(splitProductList(page), [page, undefined]);
});

test("a UPC and a pack code on the same row of the list are red", () => {
  const m = matchItem(hotdog({ upc: "040123020184", made: "26-225" }), notice(true));
  assert.equal(m.level, "danger");
});

test("a UPC with another row's lot is not red; neither is a lot the list doesn't print", () => {
  assert.notEqual(matchItem(hotdog({ upc: "040123020184", lot: "26-203" }), notice(true)).level, "danger");
  assert.notEqual(matchItem(hotdog({ upc: "040123020184", made: "26-203" }), notice(true)).level, "danger");
  assert.notEqual(matchItem(hotdog({ upc: "040123020184", lot: "26-290" }), notice(true)).level, "danger");
});

test("without the list, the same items fall back to what the page itself prints", () => {
  assert.notEqual(matchItem(hotdog({ upc: "040123020184", made: "26-225" }), notice(false)).level, "danger");
});

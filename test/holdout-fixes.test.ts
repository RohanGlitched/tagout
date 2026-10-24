// The failure modes the held-out eval found (eval/HOLDOUT.md), each on made-up examples, with the near misses
// that must still not match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { brandIn, codeCuts, joinCodeParts, lotLike, matchItem, printedIn, splitIds } from "../lib/match.ts";
import { lotsIn } from "../lib/sources/fda.ts";
import { mainText } from "../lib/sources/web.ts";
import { datelineDate } from "../lib/agent/read-notice.ts";
import { wholeRange } from "../lib/agent/investigate.ts";
import type { Item, Notice } from "../lib/types.ts";

const notice = (n: Partial<Notice>): Notice => ({ source: "fda", id: "H-0001-2027", title: "Recalled drink", date: "2026-10-01", url: "https://example.org", models: [], lots: [], upcs: [], ...n });
const drink: Item = { id: "i1", kind: "food", said: "Fizzo lemon drink 20 oz", brand: "Fizzo", product: "lemon drink 20 oz" };

// 1. Lot codes printed in parts.

const LIST = "Lot 552013 QR - JAN 03 28; Lot 552113 QR - JAN 04 28; Lot 560213 TW - FEB 11 28";

test("a lot with a line code is read as one lot, from the record and from a reader's list", () => {
  assert.deepEqual(lotsIn(LIST).slice(0, 3), ["552013 QR", "03", "28"]);
  assert.ok(lotsIn(LIST).includes("560213 TW"));
  assert.ok(splitIds("552013 QR", true).includes("552013QR"));
  assert.deepEqual(splitIds("552013 QR - JAN 03 28", true).filter((t) => /\d/.test(t)), ["552013QR"]);
  // Units, labels and joining words are never taken as a line code.
  assert.deepEqual(joinCodeParts(["12345", "OZ"]), ["12345", "OZ"]);
  assert.deepEqual(joinCodeParts(["A100", "AND", "A200"]), ["A100", "AND", "A200"]);
  assert.deepEqual(joinCodeParts(["4410", "KX", "B"]), ["4410 KX", "B"]);
  // Model lists keep each word apart, as before.
  assert.deepEqual(splitIds("Models 5160 5165 XL", false), ["5160", "5165"]);
});

test("printedIn finds a code printed in parts, and only where the code itself breaks", () => {
  assert.equal(printedIn("552013 QR", LIST), true);
  assert.equal(printedIn("552013QR", LIST), true);
  assert.equal(printedIn("552013-QR", LIST), true);
  assert.equal(printedIn("D44-0917", "Product Code: Best before 27.11.2027 LOT: D44 0917"), true);
  assert.deepEqual([...codeCuts("552013QR")], [6]);
  assert.deepEqual([...codeCuts("D44-0917")], [1, 3]);
  // Near misses: a neighbouring lot, the same number on another line, digits glued across a date.
  assert.equal(printedIn("552213 QR", LIST), false);
  assert.equal(printedIn("552013 TW", LIST), false);
  assert.equal(printedIn("0328", LIST), false);
  assert.equal(printedIn("0304", "best by JAN 03 04"), false);
  // The number alone, when the notice prints it with a line code: that could be another line's lot.
  assert.equal(printedIn("552013", LIST), false);
  // ...but a number followed by a unit or a label is still that number.
  assert.equal(printedIn("552013", "Lot 552013 EXP 01/2028"), true);
});

test("a two-part lot is red, its neighbours are not, and the bare number is orange", () => {
  const rec = notice({ lots: lotsIn(LIST), text: `Fizzo Lemon Drink 20 oz.\n${LIST}`, firm: "Fizzo Beverages" });
  assert.equal(matchItem({ ...drink, lot: "552013 QR" }, rec).level, "danger");
  assert.equal(matchItem({ ...drink, lot: "552013QR" }, rec).level, "danger");
  assert.equal(matchItem({ ...drink, lot: "552213 QR" }, rec).level, null);
  assert.equal(matchItem({ ...drink, lot: "552013 TW" }, rec).level, null);
  assert.equal(matchItem({ ...drink, lot: "552013" }, rec).level, "warning");
  // A reader that dropped the line code: the notice's own text still decides.
  const dropped = notice({ lots: ["552013", "552113"], text: `Fizzo Lemon Drink 20 oz.\n${LIST}`, firm: "Fizzo Beverages" });
  assert.equal(matchItem({ ...drink, lot: "552013 QR" }, dropped).level, "danger");
  assert.equal(matchItem({ ...drink, lot: "552213 QR" }, dropped).level, null);
});

// 2. A whole product line recalled, with no codes.

test("a brand written with its company suffix still names the brand", () => {
  const n = notice({ source: "cpsc", title: "KestrelUSA Recalls Gale Air Rifles Due to Injury Hazard", firm: undefined });
  assert.equal(brandIn("Kestrel", n), true);
  assert.equal(brandIn("Kestrelline", n), false);
  assert.equal(brandIn("Kest", notice({ source: "cpsc", title: "KestUSA Recalls Gale Air Rifles" })), true);
});

test("a recall of every unit is orange for an item with no model, never green", () => {
  const n = notice({ source: "cpsc", title: "Northwind Recalls Gale Air Rifles", text: "This recall involves all units of the Kestrel Gale and Gale 900 air rifles." });
  const rifle: Item = { id: "i1", kind: "product", said: "Kestrel Gale air rifle", brand: "Kestrel", product: "Gale air rifle" };
  assert.equal(matchItem(rifle, n).level, "warning");
  // Another brand's recall that prints no codes and never names this brand still says nothing about it.
  assert.equal(matchItem({ ...rifle, brand: "Osprey" }, n).level, null);
  // A recall that lists models still compares them.
  assert.equal(matchItem({ ...rifle, model: "G-700" }, { ...n, models: ["G-900"] }).level, null);
});

// 3. FSIS pages: the text behind 28,000 characters of menus, ranges instead of product names, datelines.

test("a long page is read from its dateline, a short one whole", () => {
  const menu = "Recalls & Public Health Alerts\nSummary of Recall Cases in Calendar Year 2021\n".repeat(400);
  const body = "999-2026 High - Class I\nAcme Meats Recalls Meat and Poultry Products\nFSIS Announcement\nWASHINGTON, Oct. 2, 2026 – Acme Meats, a Springfield establishment, is recalling 10,000 pounds of hot dogs.";
  const t = mainText(`${menu}${body}\nfooter`);
  assert.ok(t.includes("WASHINGTON, Oct. 2, 2026"));
  assert.ok(t.length <= 16_000);
  assert.ok(t.indexOf("WASHINGTON") < 1000);
  const short = `${"menu\n".repeat(100)}${body}`;
  assert.equal(mainText(short), short);
  // No dateline: the first 16,000 characters, as before.
  assert.equal(mainText("x".repeat(20_000)).length, 16_000);
});

test("a press release's dateline dates it; other dates don't", () => {
  assert.equal(datelineDate("menu\nWASHINGTON, Oct. 17, 2026 – Acme Meats is recalling"), "2026-10-17");
  assert.equal(datelineDate("WASHINGTON, April 20, 2015  Acme Foods, a Springfield establishment"), "2015-04-20");
  assert.equal(datelineDate("Company Announcement Date: October 16, 2026\nFDA Publish Date: October 17, 2026"), "2026-10-16");
  assert.equal(datelineDate("SPRINGFIELD, N.J., (October 21, 2026) - Acme Pharmacy is recalling"), "2026-10-21");
  assert.equal(datelineDate("The items were produced March 31, 2026, to Oct. 7, 2026."), "");
});

test("a brand's recall of a whole range of products counts as the same product line", () => {
  const item: Item = { id: "i1", kind: "food", said: "Acme hot dogs", brand: "Acme", product: "hot dogs" };
  const w = (title: string) => notice({ source: "web", id: "USDA FSIS", title, url: "https://www.fsis.usda.gov/recalls-alerts/x" });
  assert.equal(wholeRange(item, w("Acme Foods Inc. Recalls Meat and Poultry Products Due to Possible Temperature Abuse")), true);
  assert.equal(wholeRange(item, w("Acme Foods Inc. Recalls Chicken Breast Due to Misbranding")), false);
  // "Products" in the firm's name isn't a range.
  assert.equal(wholeRange(item, w("Acme Products Inc. Recalls Chicken Breast")), false);
  // Another brand's range recall isn't this brand's.
  assert.equal(wholeRange(item, w("Zenith Foods Recalls Meat and Poultry Products")), false);
});

// 4. Lag-window announcements: the deciding code typed without the word "lot".

test("a pack date or bare code that the lot list lists is the lot; one it doesn't stays orange", () => {
  const ann = notice({ source: "web", id: "FDA website", title: "Acme Grocers Recalls Organic Lentils", lots: ["31-102", "31-140", "31-188"], upcs: ["000012345678"], text: "Acme Grocers organic lentils, UPC 000012345678. Pack dates: 31-102, 31-140, 31-188." });
  const lentils: Item = { id: "i1", kind: "food", said: "Acme Grocers organic lentils", brand: "Acme Grocers", product: "organic lentils", upc: "000012345678", made: "31-140" };
  assert.deepEqual(lotLike(lentils), ["31-140"]);
  assert.equal(matchItem(lentils, ann).level, "danger");
  assert.equal(matchItem({ ...lentils, upc: undefined, made: undefined, codes: ["31-188"] }, ann).level, "danger");
  // Near miss: a pack date the list doesn't print.
  assert.equal(matchItem({ ...lentils, made: "31-141" }, ann).level, "warning");
  // A calendar date is never taken for a lot.
  assert.deepEqual(lotLike({ ...lentils, made: "03/2026" }), []);
  assert.deepEqual(lotLike({ ...lentils, made: "JUN 07 2027" }), []);
  // Without the brand, the UPC or a model tying it to the recall, a matching code alone is never red.
  assert.notEqual(matchItem({ ...lentils, brand: "Zenith", upc: undefined }, ann).level, "danger");
});

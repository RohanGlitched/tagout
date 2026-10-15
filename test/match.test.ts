import { test } from "node:test";
import assert from "node:assert/strict";
import { compareId, decide, looksLikeCode, matchItem, norm, parseMade, printedIn, splitIds } from "../lib/match.ts";
import type { Item, Notice } from "../lib/types.ts";

const notice = (n: Partial<Notice>): Notice => ({ source: "cpsc", id: "25-001", title: "Heaters recalled", date: "2025-01-01", url: "https://example.org", models: [], lots: [], upcs: [], ...n });
const heater: Item = { id: "h", kind: "product", said: "heater", brand: "Lasko", product: "Ceramic tower heater", model: "CT-22425" };

test("norm drops punctuation and case", () => {
  assert.equal(norm(" ct-22.425/b "), "CT22425B");
});

test("splitIds reads lists, ranges and labels", () => {
  assert.deepEqual(splitIds("Model numbers 5160, 5165 and 5170"), ["5160", "5165", "5170"]);
  assert.deepEqual(splitIds("Lot 2LC1234 through 2LC1240"), ["2LC1234..2LC1240"]);
  assert.deepEqual(splitIds("Date codes 2201-2215"), ["2201..2215"]);
  assert.deepEqual(splitIds("Blue and green"), []);
});

test("compareId: exact, range, wildcard, variant, miss", () => {
  assert.equal(compareId("CT 22425", "CT-22425"), "exact");
  assert.equal(compareId("2LC1237", "2LC1234..2LC1240"), "range");
  assert.equal(compareId("2LC1241", "2LC1234..2LC1240"), null);
  assert.equal(compareId("2LD1237", "2LC1234..2LC1240"), null);
  assert.equal(compareId("5160B", "5160X"), "wildcard");
  assert.equal(compareId("CT22425B", "CT22425"), "variant");
  assert.equal(compareId("5160", "51600"), null);
  assert.equal(compareId("12", "12"), null);
});

test("a listed model is red", () => {
  const m = matchItem(heater, notice({ models: ["CT22425, CT22430"] }));
  assert.equal(m.level, "danger");
  assert.equal(m.proof[0].matched, true);
});

test("an unlisted model clears that notice", () => {
  const m = matchItem(heater, notice({ models: ["CT30000"], firm: "Lasko Products" }));
  assert.equal(m.level, null);
  assert.equal(m.proof.at(-1)!.matched, false);
});

test("a close variant is orange, never red", () => {
  assert.equal(matchItem(heater, notice({ models: ["CT22425B"] })).level, "warning");
});

test("lot-limited recalls need the lot", () => {
  const drug: Item = { id: "d", kind: "drug", said: "ibuprofen", brand: "Example", model: "1234-5678", lot: "2LC1237" };
  const n = notice({ source: "fda", models: ["1234-5678"], lots: ["2LC1234 through 2LC1240"] });
  assert.equal(matchItem(drug, n).level, "danger");
  assert.equal(matchItem({ ...drug, lot: "9ZZ0001" }, n).level, null);
  assert.equal(matchItem({ ...drug, lot: undefined }, n).level, "warning");
});

test("brand only is orange", () => {
  const m = matchItem({ ...heater, model: undefined }, notice({ firm: "Lasko Products, LLC" }));
  assert.equal(m.level, "warning");
});

test("vehicles never go red on make/model/year", () => {
  const car: Item = { id: "c", kind: "vehicle", said: "2018 Honda Accord", brand: "Honda", product: "Accord", year: 2018 };
  const n = notice({ source: "nhtsa", make: "HONDA", vehicleModel: "ACCORD", years: [2018, 2019] });
  assert.equal(matchItem(car, n).level, "warning");
  assert.equal(matchItem({ ...car, year: 2016 }, n).level, null);
});

test("decide: red beats orange beats green", () => {
  const a = notice({ id: "a" }), b = notice({ id: "b" });
  assert.equal(decide([{ notice: a, match: { level: "warning", proof: [], why: "" } }, { notice: b, match: { level: "danger", proof: [], why: "" } }]).level, "danger");
  assert.equal(decide([{ notice: a, match: { level: null, proof: [], why: "" } }]).level, "inspected");
});

test("a TYPE code on the label counts as a model", () => {
  const vornado: Item = { id: "v", kind: "product", said: "heater", brand: "Vornado", model: "VH-SRTH-BLK", codes: ["SRTH"] };
  const m = matchItem(vornado, notice({ models: ["SRTH"] }));
  assert.equal(m.level, "danger");
  assert.equal(m.proof[0].yours, "SRTH");
});

test("a manufacture window gates a model match", () => {
  const seat: Item = { id: "s", kind: "car-seat", said: "seat", brand: "Evenflo", model: "38112345", made: "2025/03/14" };
  const n = notice({ source: "nhtsa", models: ["38112345"], madeRanges: [{ from: "2025-01-01", to: "2025-06-30" }] });
  assert.equal(matchItem(seat, n).level, "danger");
  assert.equal(matchItem({ ...seat, made: "2025/08/01" }, n).level, null);
  assert.equal(matchItem({ ...seat, made: undefined }, n).level, "warning");
});

test("parseMade reads common date forms and refuses bare codes", () => {
  assert.deepEqual(parseMade("2023/03/14"), { start: "2023-03-14", end: "2023-03-14" });
  assert.deepEqual(parseMade("03/14/2023"), { start: "2023-03-14", end: "2023-03-14" });
  assert.deepEqual(parseMade("03/2023"), { start: "2023-03-01", end: "2023-03-31" });
  assert.equal(parseMade("2211"), null);
});

test("a model match is orange when the notice limits the recall to date codes and yours isn't printed", () => {
  const n = notice({ models: ["LTD-SM23"], text: "Only units with model number LTD-SM23 and date code 7W15TN are included in this recall." });
  const item: Item = { id: "s", kind: "product", said: "sleep machine", brand: "Love To Dream", model: "LTD-SM23", made: "7W16TN" };
  assert.equal(matchItem(item, n).level, "warning");
  assert.equal(matchItem({ ...item, made: "7W15TN" }, n).level, "danger");
  // A calendar date isn't a date code, and a notice that names no codes stays red on the model.
  assert.equal(matchItem({ ...item, made: "2025-03" }, n).level, "danger");
  assert.equal(matchItem(item, notice({ models: ["LTD-SM23"], text: "All LTD-SM23 sleep machines are recalled." })).level, "danger");
});

test("printedIn finds whole codes outside 'not included' sentences", () => {
  const text = "Lot #: 9T20, 9T50, Exp Date: 4/30/2026; 4V15, Exp Date: 8/31/2026. Units with lot 7V99 are not included in this recall.";
  assert.equal(printedIn("4V15", text), true);
  assert.equal(printedIn("4v-15", text), true);
  assert.equal(printedIn("4V1", text), false);
  assert.equal(printedIn("7V99", text), false);
  assert.equal(printedIn("SRTH", "model TYPE SRTH"), false);
});

test("the notice's text outranks a reader's list that was cut short", () => {
  const n = notice({ source: "fda", title: "GenTeal Tears lubricant eye gel", lots: ["9T20", "9T50"], text: "GenTeal Tears. Lot #: 9T20, 9T50, Exp Date: 4/30/2026; 4V15, Exp Date: 8/31/2026." });
  const gel: Item = { id: "g", kind: "drug", said: "gel", brand: "GenTeal", lot: "4V15" };
  assert.equal(matchItem(gel, n).level, "danger");
  assert.equal(matchItem({ ...gel, lot: "4V16" }, n).level, null);
  // A model the reader missed entirely, printed in the description.
  const brush = notice({ title: "Cuisinart grill brushes recalled", firm: "Conair", text: "Cuisinart grill brushes. Model numbers CCB-100, CCB-5014 and CSBS-777 are included." });
  assert.equal(matchItem({ id: "b", kind: "product", said: "brush", brand: "Cuisinart", model: "CCB-5014" }, brush).level, "danger");
  assert.equal(matchItem({ id: "b", kind: "product", said: "brush", brand: "Cuisinart", model: "CCB-5015" }, brush).level, "warning");
});

test("a one-sided date window reads as before or after", () => {
  const jar = notice({ models: ["SK3000"], madeRanges: [{ from: "1900-01-01", to: "2023-07-31" }], text: "Model SK3000 manufactured before July 2023." });
  const item: Item = { id: "t", kind: "product", said: "jar", brand: "Thermos", model: "SK3000" };
  assert.equal(matchItem({ ...item, made: "2022-05" }, jar).level, "danger");
  assert.equal(matchItem({ ...item, made: "2024-02" }, jar).level, null);
  assert.match(matchItem(item, jar).why, /before 2023-07-31/);
});

test("a trailing X in a lot is a letter, not a family code", () => {
  const n = notice({ source: "fda", title: "Gas-X Extra Strength softgels", lots: ["TL8K", "YH9X", "YH9Y"], text: "Gas-X. Lots: TL8K, YH9X, YH9Y." });
  const softgels: Item = { id: "x", kind: "drug", said: "Gas-X", brand: "Gas-X", lot: "YH9Z" };
  assert.equal(matchItem(softgels, n).level, null);
  assert.equal(matchItem({ ...softgels, lot: "YH9X" }, n).level, "danger");
  assert.equal(compareId("5160B", "5160X"), "wildcard");
});

test("only code-like strings are reported as struck codes", () => {
  for (const c of ["SRTH", "CT-22425", "EJA022", "0 12345 67890 5", "LOT 2301A through LOT 2399Z", "Model 7110"]) assert.equal(looksLikeCode(c), true, c);
  for (const c of ["/usr/local/bin/python", "/home/user/script.py", "C:\\tools\\x.exe", "the notice lists every unit sold since spring", "n/a", "-"]) assert.equal(looksLikeCode(c), false, c);
});

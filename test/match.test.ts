import { test } from "node:test";
import assert from "node:assert/strict";
import { compareId, decide, matchItem, norm, parseMade, splitIds } from "../lib/match.ts";
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

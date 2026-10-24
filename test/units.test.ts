import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "../lib/sources/units.ts";

test("CPSC unit counts read decimals, thousands separators and million/thousand words", () => {
  assert.equal(parseUnits("About 1.2 million"), 1_200_000);
  assert.equal(parseUnits("About 255,000"), 255_000);
  assert.equal(parseUnits("Approximately 31,200 (in addition, about 1,800 were sold in Canada)"), 31_200);
  assert.equal(parseUnits("1,350"), 1350);
  assert.equal(parseUnits("About 45 thousand"), 45_000);
  assert.equal(parseUnits("About 2 Million units"), 2_000_000);
  assert.equal(parseUnits(""), undefined);
  assert.equal(parseUnits(undefined), undefined);
  assert.equal(parseUnits("Unknown"), undefined);
});

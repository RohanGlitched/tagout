import { test } from "node:test";
import assert from "node:assert/strict";
import { isListing } from "../lib/sources/listing.ts";

test("agency recall indexes are not notices", () => {
  assert.equal(isListing("https://www.fsis.usda.gov/recalls?f%5B0%5D=recall_reason%3A16"), true);
  assert.equal(isListing("https://www.fsis.usda.gov/recalls"), true);
  assert.equal(isListing("https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts"), true);
  assert.equal(isListing("https://www.fsis.usda.gov/recalls-alerts/ukrops-homestyle-foods-recalls-spaghetti-and-chicken-products"), false);
  assert.equal(isListing("https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/gardeners-basics-recalls-waltham-29"), false);
  assert.equal(isListing("https://www.cpsc.gov/Recalls/2026/Vornado-Air-Recalls-SRTH"), false);
});

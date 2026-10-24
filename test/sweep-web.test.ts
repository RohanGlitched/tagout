import { test } from "node:test";
import assert from "node:assert/strict";
import type { Notice } from "../lib/types.ts";
import type { WebQuery } from "../lib/sources/web.ts";

const { fdaAnnouncements, fsisRecalls } = await import("../lib/sweep/run.ts");
const { creditsFor } = await import("../lib/sources/web.ts");

const W = (url: string, title: string): Notice => ({ source: "web", id: "FDA website", title, date: "", url, models: [], lots: [], upcs: [], text: title });

/** A stand-in for Tavily: records the query and answers with `results`. */
function search(results: Notice[]) {
  const asked: WebQuery[] = [];
  return { asked, fn: async (q: WebQuery) => (asked.push(q), { notices: results, answerMs: 0 }) };
}

const BASE = "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts";

test("the sweep asks Tavily once for FDA company announcements, on fda.gov, over the past month", async () => {
  const s = search([]);
  await fdaAnnouncements(s.fn);
  assert.equal(s.asked.length, 1);
  assert.deepEqual(s.asked[0].domains, ["fda.gov"]);
  assert.equal(s.asked[0].days, 31);
  assert.ok((s.asked[0].max ?? 99) <= 10);
});

test("only announcement pages are kept: not the listing, not other fda.gov pages", async () => {
  const s = search([
    W(`${BASE}/natural-grocers-recalls-mung-beans-because-possible-salmonella-health-risk`, "Natural Grocers Recalls Mung Beans Because of Possible Salmonella Health Risk"),
    W(BASE, "Recalls, Market Withdrawals, & Safety Alerts"),
    W(`${BASE}?page=2`, "Recalls, Market Withdrawals, & Safety Alerts"),
    W("https://www.fda.gov/food/outbreaks-foodborne-illness/investigations", "Outbreak investigations"),
    W("https://www.fda.gov/drugs/drug-safety-and-availability/drug-recalls", "Drug Recalls"),
  ]);
  const got = await fdaAnnouncements(s.fn);
  assert.deepEqual(got.map((n) => n.url), [`${BASE}/natural-grocers-recalls-mung-beans-because-possible-salmonella-health-risk`]);
  assert.equal(got[0].firm, "Natural Grocers");
});

test("each announcement once, however Tavily spells its link, and at most ten", async () => {
  const page = `${BASE}/winco-foods-recalls-hoagie-rolls-because-undeclared-sesame`;
  const many = Array.from({ length: 14 }, (_, i) => W(`${BASE}/firm-${i}-recalls-product-${i}`, `Firm ${i} Recalls Product ${i}`));
  const s = search([W(page, "WinCo Foods Recalls Hoagie Rolls"), W(`${page}/`, "WinCo Foods Recalls Hoagie Rolls"), W(page.replace("https://www.", "https://"), "WinCo Foods Recalls Hoagie Rolls"), W(`${page}#main`, "WinCo Foods Recalls Hoagie Rolls"), ...many]);
  const got = await fdaAnnouncements(s.fn);
  assert.equal(got.filter((n) => n.url.includes("winco")).length, 1);
  assert.equal(got.length, 10);
});

test("FSIS keeps recall pages only, each once, with the firm read from the title", async () => {
  const p = "https://www.fsis.usda.gov/recalls-alerts/kayem-foods-recalls-hot-dog-products-due-possible-foreign-matter-contamination";
  const s = search([
    { ...W(p, "Kayem Foods Recalls Hot Dog Products Due to Possible Foreign Matter Contamination"), id: "USDA FSIS" },
    { ...W(`${p}/`, "Kayem Foods Recalls Hot Dog Products Due to Possible Foreign Matter Contamination"), id: "USDA FSIS" },
    { ...W("https://www.fsis.usda.gov/recalls?f%5B0%5D=status%3AActive", "Recalls"), id: "USDA FSIS" },
  ]);
  const got = await fsisRecalls(s.fn);
  assert.deepEqual(got.map((n) => n.url), [p]);
  assert.equal(got[0].firm, "Kayem Foods");
});

test("Tavily credits: a basic search is 1, an extract is 1 per 5 URLs read, and nothing when none came back", () => {
  assert.equal(creditsFor("/search", { search_depth: "basic" }, 0), 1);
  assert.equal(creditsFor("/search", { search_depth: "advanced" }, 0), 2);
  assert.equal(creditsFor("/extract", { extract_depth: "basic" }, 1), 1);
  assert.equal(creditsFor("/extract", { extract_depth: "basic" }, 5), 1);
  assert.equal(creditsFor("/extract", { extract_depth: "basic" }, 6), 2);
  assert.equal(creditsFor("/extract", { extract_depth: "basic" }, 0), 0);
  assert.equal(creditsFor("/extract", { extract_depth: "advanced" }, 3), 2);
});

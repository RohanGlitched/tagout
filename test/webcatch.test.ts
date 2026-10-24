import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fdaHasRecall, sameRecall, type RecallQuery } from "../lib/sources/fda.ts";
import { firmOfTitle, markAhead, titleNouns } from "../lib/agent/ahead.ts";
import { allergenOnly, noticeFacts, remedyAction, verifiedIn } from "../lib/notice-facts.ts";
import { buildVerdict } from "../lib/agent/verdict.ts";
import type { Item, Notice } from "../lib/types.ts";

const holdout = (f: string) => fs.readFileSync(new URL(`../eval/notices-holdout/${f}`, import.meta.url), "utf8");

const gelato: RecallQuery = { firm: "Lidl US", noticeDate: "2026-10-16", lots: ["085261"], upcs: ["4 0564897 22458"], nouns: ["gelatelli", "coffee", "vanilla", "gelato"], kinds: ["food"], today: "2026-10-25" };
const rec = (o: { product_description: string; code_info?: string; report_date: string; recall_initiation_date?: string; recall_number?: string }) => ({ code_info: "", recall_initiation_date: o.report_date, recall_number: "H-0000-2026", ...o });
// Lidl's other openFDA reports in the 90 days before the gelato announcement: cookies and a spice mix.
const lidlOthers = [
  rec({ recall_number: "H-1275-2026", product_description: "Favorina Chocolate Chip Cookies, 7 oz", code_info: "Best by 03/2027", report_date: "20260902", recall_initiation_date: "20260815" }),
  rec({ recall_number: "H-1274-2026", product_description: "Favorina Butter Cookies, 7 oz", code_info: "Best by 03/2027", report_date: "20260902", recall_initiation_date: "20260815" }),
  rec({ recall_number: "H-1243-2026", product_description: "Chef Select Taco Seasoning Mix", code_info: "Lot 25190", report_date: "20260826", recall_initiation_date: "20260801" }),
];

test("Ahead of the database is per recall: a firm's older reports about other products don't count (the Lidl and WinCo case)", () => {
  for (const r of lidlOthers) assert.equal(sameRecall(r, gelato), false, r.recall_number);
  // WinCo's salsa bean dip, reported Oct 14, is not the hoagie rolls announced Oct 22.
  const hoagie: RecallQuery = { firm: "WinCo Foods LLC", noticeDate: "2026-10-22", lots: [], upcs: ["2-70552-00649-2"], nouns: ["hoagie", "rolls"], kinds: ["food"], today: "2026-10-25" };
  assert.equal(sameRecall(rec({ product_description: "WinCo Foods Salsa Bean Dip, 16 oz", code_info: "Best if used by 9/2/2026", report_date: "20261014", recall_initiation_date: "20260929" }), hoagie), false);
  // The same recall, once openFDA has it: by lot, by UPC, by product word, or by date.
  assert.equal(sameRecall(rec({ product_description: "Gelatelli gelato 16 FL OZ", code_info: "Lot: 085261", report_date: "20261105" }), gelato), true);
  assert.equal(sameRecall(rec({ product_description: "Hoagie Rolls, UPC 270552006492", report_date: "20260101" }), hoagie), true);
  assert.equal(sameRecall(rec({ product_description: "Ice cream, vanilla bean", report_date: "20260801" }), gelato), true);
  assert.equal(sameRecall(rec({ product_description: "Something else", report_date: "20261012" }), gelato), true);
});

test("fdaHasRecall: no report for the lot, the UPC or the firm's product, and the tag says what was searched", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("recalling_firm")) return new Response(JSON.stringify({ results: lidlOthers }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
  }) as typeof fetch;
  try {
    const r = await fdaHasRecall(gelato);
    assert.equal(r.has, false);
    assert.equal(r.on, "2026-10-25");
    assert.deepEqual(r.searched, ["lot 085261: 0 results", "UPC 4 0564897 22458: 0 results", "Lidl US: 3 other reports, none for this product"]);

    const n: Notice = { source: "web", id: "FDA website", title: "Lidl US Recalls Gelatelli Coffee & Vanilla Gelato Due to Possible Health Risk", date: "2026-10-16", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/lidl-us-recalls-gelatelli-coffee-vanilla-gelato-due-possible-health-risk", models: [], lots: ["085261"], upcs: ["4 0564897 22458"] };
    const item: Item = { id: "i1", kind: "food", said: "Gelatelli coffee & vanilla gelato, lot 085261", brand: "Gelatelli", lot: "085261" };
    const [marked] = await markAhead([n], item, "2026-10-25T10:00:00.000Z");
    assert.equal(marked.notInDb, "fda");
    assert.equal(marked.dbCheck?.searched[0], "lot 085261: 0 results");
  } finally {
    globalThis.fetch = real;
  }
  // openFDA not answering says nothing either way: no badge.
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    assert.equal((await fdaHasRecall(gelato)).has, null);
  } finally {
    globalThis.fetch = real;
  }
});

test("the firm and the product words come from the announcement's title", () => {
  assert.equal(firmOfTitle("Lidl US Recalls Gelatelli Coffee & Vanilla Gelato Due to Possible Health Risk"), "Lidl US");
  assert.equal(firmOfTitle("WinCo Foods LLC Issues Allergy Alert on Undeclared Sesame in Hoagie Rolls"), "WinCo Foods LLC");
  assert.deepEqual(titleNouns("WinCo Foods LLC Issues Allergy Alert on Undeclared Sesame in Hoagie Rolls", "WinCo Foods LLC"), ["hoagie", "rolls"]);
  assert.deepEqual(titleNouns("Lidl US Recalls Gelatelli Coffee & Vanilla Gelato Due to Possible Health Risk", "Lidl US"), ["gelatelli", "coffee", "vanilla", "gelato"]);
});

test("a web notice's hazard, remedy and contact come from its own text: Gelatelli's hazard names Listeria", () => {
  const t = holdout("fda-lidl-gelatelli-gelato.txt");
  const f = noticeFacts(t, "Lidl US Recalls Gelatelli Coffee & Vanilla Gelato Due to Possible Health Risk");
  assert.match(f.hazard ?? "", /Listeria monocytogenes/);
  assert.ok(verifiedIn(f.hazard, t));

  const page = `COMPANY ANNOUNCEMENT\nARLINGTON, VA – OCTOBER 16, 2026 – Lidl US is recalling one lot of Gelatelli Coffee & Vanilla Gelato because it has the potential to be contaminated with Listeria monocytogenes, an organism which can cause serious and sometimes fatal infections.\nCustomers should immediately discard or return the recalled product to their nearest Lidl store for a full refund (a receipt is not required for return). Customers who have questions about this recall should call the Lidl US Customer Care Hotline at (844) 747-5435, Monday – Saturday between 8 am - 8 pm ET.`;
  const g = noticeFacts(page, "Lidl US Recalls Gelatelli Coffee & Vanilla Gelato Due to Possible Health Risk");
  assert.match(g.remedy ?? "", /discard or return the recalled product to their nearest Lidl store for a full refund/);
  assert.match(g.contact ?? "", /\(844\) 747-5435/);
  for (const k of ["hazard", "remedy", "contact"] as const) assert.ok(verifiedIn(g[k], page), k);
  assert.equal(g.allergen, undefined);
});

test("FSIS: the hazard, and a remedy that runs over two sentences glued by the page", () => {
  const t = holdout("fsis-026-2026-kayem.txt");
  assert.equal(noticeFacts(t, "Kayem Foods Inc. Recalls Meat and Poultry Products Due to Possible Temperature Abuse").hazard, "They may have experienced temperature abuse during storage.");
  const page = "FSIS Announcement\nWASHINGTON, Oct. 17, 2026 – Kayem Foods Inc., a Chelsea, Mass. establishment, is recalling approximately 1,584,361 pounds of products because they may have experienced temperature abuse during storage, the U.S. Department of Agriculture’s Food Safety and Inspection Service (FSIS) announced today.\nFSIS is concerned that some product may be in consumers’ refrigerators.Consumers who have purchased these products are urged not to consume them. These products should be thrown away or returned to the place of purchase.\nMembers of the media with questions about the recall can contact Kraig Naasz at 703-628-3669. Consumers may contact Kayem Foods Customer Service at 800-426-6100.";
  const f = noticeFacts(page, "Kayem Foods Inc. Recalls Meat and Poultry Products Due to Possible Temperature Abuse");
  assert.equal(f.remedy, "Consumers who have purchased these products are urged not to consume them. These products should be thrown away or returned to the place of purchase.");
  assert.equal(f.contact, "Consumers may contact Kayem Foods Customer Service at 800-426-6100.");
  assert.equal(remedyAction(f.remedy), "thrown away or returned to the place of purchase");
});

test("allergens: read from the notice, and only when the allergen is the only hazard", () => {
  const t = holdout("fda-winco-hoagie-rolls.txt");
  assert.equal(noticeFacts(t, "WinCo Foods LLC Issues Allergy Alert on Undeclared Sesame in Hoagie Rolls").allergen, "sesame");
  assert.equal(allergenOnly("Product contains undeclared milk."), "milk");
  assert.equal(allergenOnly("Undeclared allergens: soy and wheat"), "soy and wheat");
  assert.equal(allergenOnly("The product may contain undeclared tree nuts (almonds)."), "tree nuts (almonds)");
  assert.equal(allergenOnly("Products may contain undeclared peanuts and are contaminated with Listeria monocytogenes"), undefined);
  assert.equal(allergenOnly("Potential foreign material (pieces of plastic)"), undefined);
  assert.equal(noticeFacts(holdout("fda-lidl-gelatelli-gelato.txt"), "Lidl US Recalls Gelatelli").allergen, undefined);
});

const winco: Notice = {
  source: "web",
  id: "FDA website",
  title: "WinCo Foods LLC Issues Allergy Alert on Undeclared Sesame in Hoagie Rolls",
  date: "2026-10-22",
  url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/winco-foods-llc-issues-allergy-alert-undeclared-sesame-hoagie-rolls",
  models: [],
  lots: [],
  upcs: ["2-70552-00649-2"],
  allergen: "sesame",
  hazard: "Undeclared sesame.",
  remedy: "Consumers are advised not to consume the hoagie rolls if they have a sensitivity or allergy to sesame, and to return them to their nearest WinCo Foods location for a refund.",
  contact: "Consumers with questions or concerns are welcome to contact the WinCo Foods Customer Service Desk at 1-800-824-1706.",
  text: "WinCo Foods Hoagie Rolls with UPC 2-70552-00649-2 due to undeclared sesame.",
};

test("an allergy alert's red tag tells the household who must not eat it", () => {
  const item: Item = { id: "i2", kind: "food", said: "WinCo hoagie rolls 16 oz, UPC 2-70552-00649-2", brand: "WinCo", product: "hoagie rolls", upc: "2-70552-00649-2" };
  const v = buildVerdict(item, [winco], ["web"], "2026-10-25T10:00:00.000Z");
  assert.equal(v.level, "danger");
  assert.equal(v.allergen, "sesame");
  assert.equal(v.headline, "Do not eat if anyone in your home is allergic to sesame; return them to their nearest WinCo Foods location for a refund.");
  assert.match(v.steps[0], /UPC 2-70552-00649-2 is listed in this recall\. It is an allergy alert/);
  assert.ok(v.steps.includes(winco.contact!));
  assert.deepEqual(v.basis, { by: "record-list", how: "exact" });
  // Not an allergy alert: the plain red tag, with the notice's own remedy and contact.
  const plain = buildVerdict(item, [{ ...winco, allergen: undefined }], ["web"], "2026-10-25T10:00:00.000Z");
  assert.equal(plain.headline, "UPC 2-70552-00649-2 is listed in this recall.");
  assert.equal(plain.allergen, undefined);
});

test("FSIS: an establishment number is labelled as one, and a date window asks for the date", () => {
  const kayem: Notice = {
    source: "web",
    id: "USDA FSIS",
    title: "Kayem Foods Inc. Recalls Meat and Poultry Products Due to Possible Temperature Abuse",
    date: "2026-10-17",
    url: "https://www.fsis.usda.gov/recalls-alerts/kayem-foods-inc--recalls-meat-and-poultry-products-due-possible-temperature-abuse",
    models: [],
    lots: [],
    upcs: [],
    madeRanges: [{ from: "2026-03-31", to: "2026-10-07" }],
    whereToLook: "inside the USDA mark of inspection",
    text: "Kayem Foods Inc. Recalls Meat and Poultry Products\nThe products subject to recall bear establishment numbers “EST. M/P 7839,” “EST. P 20935A” and “EST. M 9520” inside the USDA mark of inspection.",
  };
  const older = (date: string, title: string): Notice => ({ ...kayem, title, date, url: `${kayem.url}-${date}`, madeRanges: undefined, text: `${title}. Kayem Foods.` });
  const item: Item = { id: "i3", kind: "food", said: "Kayem natural casing hot dogs, EST. 7839", brand: "Kayem", product: "natural casing hot dogs", codes: ["EST. 7839"] };
  const v = buildVerdict(item, [kayem, older("2016-01-16", "Kayem Foods Inc. Recalls Chicken Sausage Products Due To Misbranding"), older("2025-07-17", "Kayem Foods Inc. Recalls Chicken Sausage Products Due to Foreign Matter"), older("2015-04-20", "Kayem Foods Recalls Sausage Products")], ["web"], "2026-10-25T10:00:00.000Z");
  assert.equal(v.level, "warning");
  assert.equal(v.headline, "USDA establishment EST. 7839 is listed, but only products made between 31 Mar 2026 and 7 Oct 2026. Check the packed-on or use-by date on the package.");
  assert.equal(v.steps[0], "Check the packed-on or use-by date (31 Mar 2026 – 7 Oct 2026).");
  assert.ok(!v.steps.some((s) => /lot code|mark of inspection/i.test(s)));
  assert.deepEqual(v.proof[0], { field: "model", yours: "EST. 7839", theirs: "7839 (in the notice's text)", matched: true, label: "USDA establishment" });
  // Related recalls, newest first.
  assert.deepEqual(v.related?.map((n) => n.date), ["2025-07-17", "2016-01-16", "2015-04-20"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item, Notice } from "../lib/types.ts";

const { relatedForBrand, buildVerdict } = await import("../lib/agent/verdict.ts");
const { publicCheck } = await import("../lib/checks.ts");

const N = (o: Partial<Notice>): Notice => ({ source: "web", id: "CPSC newsroom", title: "", date: "", url: "", models: [], lots: [], upcs: [], ...o });

// Made-up records shaped like what a heater check meets: the brand's own recalls, another maker's heater recall
// (in English and as a translated copy), a category page, and the same recall twice.
const vornadoA = N({ source: "cpsc", id: "24-101", title: "Vornado Air Recalls Space Heaters Due to Fire Hazard", firm: "Vornado Air", url: "https://www.cpsc.gov/Recalls/2024/Vornado-Air-Recalls-Space-Heaters", models: ["VH200"] });
const vornadoB = N({ title: "Vornado Recalls Tower Heaters", url: "https://www.cpsc.gov/Recalls/2016/Vornado-Recalls-Tower-Heaters", models: ["SRTH"] });
const vornadoBAgain = N({ title: "Vornado Recalls Tower Heaters", url: "https://www.cpsc.gov/Recalls/2016/Vornado-Recalls-Tower-Heaters/" });
const trane = N({ title: "Trane and American Standard Recall Accessory Heaters Due to Fire Hazard", url: "https://www.cpsc.gov/Recalls/2015/Trane-and-American-Standard-Recall-Accessory-Heaters" });
const traneZh = N({ title: "Trane and American Standard Recall Accessory Heaters", url: "https://www.cpsc.gov/zh-CN/Recalls/2015/Trane-and-American-Standard-Recall-Accessory-Heaters" });
const vornadoZh = N({ title: "Vornado Recalls Tower Heaters (Chinese)", url: "https://www.cpsc.gov/zhT-CN/Recalls/2016/Vornado-Recalls-Tower-Heaters" });
const category = N({ title: "Electric Heaters", url: "https://www.cpsc.gov/Business--Manufacturing/Business-Education/Business-Guidance/Electric-Heaters" });
const listing = N({ title: "Vornado recalls", url: "https://www.cpsc.gov/Recalls" });

const heater: Item = { id: "i1", kind: "product", said: "Vornado heater, model VH-SRTH-BLK", brand: "Vornado", model: "VH-SRTH-BLK" };

test("other recalls for this brand list only the item's own brand", () => {
  const got = relatedForBrand(heater, [vornadoA, trane, traneZh, category, vornadoB]);
  assert.deepEqual(got.map((n) => n.title), [vornadoA.title, vornadoB.title]);
});

test("translated copies, listing pages and repeats of one recall are dropped", () => {
  const got = relatedForBrand(heater, [vornadoB, vornadoZh, vornadoBAgain, listing]);
  assert.deepEqual(got, [vornadoB]);
});

test("an item with no brand keeps only the notices the matcher hit", () => {
  const nobrand: Item = { id: "i2", kind: "product", said: "price tag", codes: ["2595301"] };
  assert.deepEqual(relatedForBrand(nobrand, [vornadoA, trane], [trane]), [trane]);
  assert.deepEqual(relatedForBrand(nobrand, [vornadoA, trane]), []);
});

test("a green heater tag never shows another maker's recall as related", () => {
  const v = buildVerdict(heater, [trane, traneZh, vornadoA, category], ["cpsc", "web"], "2026-10-25T00:00:00Z");
  assert.ok(v.related?.every((n) => /vornado/i.test(`${n.firm ?? ""} ${n.title}`)), JSON.stringify(v.related?.map((n) => n.title)));
});

test("a stored check is filtered again when it is sent to the browser", () => {
  const rec = publicCheck({
    id: "abcdefghij",
    createdAt: "2026-10-20T00:00:00Z",
    status: "done",
    input: { text: "Vornado heater", photoCount: 0 },
    items: [heater],
    verdicts: [{ itemId: "i1", level: "inspected", headline: "x", proof: [], steps: [], checkedAt: "2026-10-20T00:00:00Z", searched: ["cpsc"], related: [trane, traneZh, vornadoA, category] }],
  });
  assert.deepEqual(rec.verdicts?.[0].related?.map((n) => n.title), [vornadoA.title]);
});

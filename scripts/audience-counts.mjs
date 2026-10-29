// Sizes who Tagout's recalls reach, from public agency data only (GET requests, no keys, no model): 2026 CPSC recalls
// of children's products, 2026 CPSC recalls of stoves, ranges, ovens and refrigerators (the appliances California's
// AB 628 covers), and 2026 openFDA food enforcement reports for an undeclared ingredient (mostly allergens).
// Usage: node scripts/audience-counts.mjs  -> prints a summary and writes docs/audience-counts.json
import fs from "node:fs";

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

const cpscUrl = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${year}-01-01&RecallDateEnd=${today}`;
const cpsc = await (await fetch(cpscUrl, { headers: { accept: "application/json" } })).json();
const text = (r) => `${r.Title ?? ""} ${(r.Products ?? []).map((p) => `${p.Name ?? ""} ${p.Type ?? ""}`).join(" ")}`;

const CHILD = /\b(cribs?|bassinets?|car seats?|strollers?|toys?|infants?|bab(y|ies)|toddlers?|child(ren)?'?s?|kids?'?|high chairs?|play ?yards?|pacifiers?|teethers?|baby gates?|bouncers?|swings?)\b/i;
const KITCHEN = /\b(stoves?|(gas|electric|induction) ranges?|ranges? (with|and)|ovens?|cooktops?|refrigerators?|fridges?|freezers?)\b/i;

const all = Array.isArray(cpsc) ? cpsc : [];
// Child-resistant packaging recalls (medicines, fuel) mention children without being children's products.
const children = all.filter((r) => CHILD.test(text(r).replace(/child[- ]resistant|poison(ing)? prevention/gi, "")));
const kitchen = all.filter((r) => KITCHEN.test(text(r)) && !/\b(toys?|toaster|grills?|microwaves?)\b/i.test(text(r)));

// CPSC's own unit counts ("About 3,630 (In addition, 1,395 in Canada)"): the first number, the U.S. units.
const units = (rs) =>
  rs.reduce((sum, r) => sum + (r.Products ?? []).reduce((s, p) => s + Number(((p.NumberOfUnits ?? "").match(/\d[\d,]*(?:\.\d+)?\s*(?:million)?/i)?.[0] ?? "0").replace(/,/g, "").replace(/\s*million/i, "e6").replace(/^(\d+(?:\.\d+)?)e6$/, (_, n) => String(Number(n) * 1e6))), 0), 0);

const fdaUrl =`https://api.fda.gov/food/enforcement.json?search=report_date:[${year}0101+TO+${today.replace(/-/g, "")}]+AND+reason_for_recall:undeclared&limit=1`;
const fdaAllUrl = `https://api.fda.gov/food/enforcement.json?search=report_date:[${year}0101+TO+${today.replace(/-/g, "")}]&limit=1`;
const [undeclared, foodAll] = await Promise.all([fdaUrl, fdaAllUrl].map(async (u) => (await (await fetch(u)).json()).meta?.results?.total ?? null));

const out = {
  at: today,
  sources: { cpsc: cpscUrl, openFdaUndeclared: fdaUrl, openFdaAll: fdaAllUrl },
  cpscRecalls: all.length,
  childrensProducts: children.length,
  stovesOvensFridges: kitchen.length,
  childrensProductUnits: units(children),
  stovesOvensFridgesUnits: units(kitchen),
  allUnits: units(all),
  kitchenExamples: kitchen.slice(0, 8).map((r) => `${r.RecallNumber} ${r.Title}`),
  foodReports: foodAll,
  undeclaredIngredient: undeclared,
  note: "Approximate keyword counts: children's products and kitchen appliances are matched on each recall's title and product names (regular expressions in this script), and child-resistant packaging recalls are left out; a recall can be in both groups. Units are CPSC's own NumberOfUnits figures for the U.S.",
};
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/audience-counts.json", JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ ...out, kitchenExamples: out.kitchenExamples }, null, 1));

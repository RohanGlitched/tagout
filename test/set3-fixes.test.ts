// The two false alarms held-out set #3 found, on the records' own wording (CPSC 27-054 and 27-041, FDA Z-0151-2027
// and Z-0783-2022), fixed in-sample with general rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, madeWindowsIn, matchItem, serialBoundsFor } from "../lib/match.ts";
import type { Item, Notice } from "../lib/types.ts";

const CPSC_27054 =
  "This recall involves DREO space heaters, model number DR-HSH015. Only units manufactured from April 2025 through January 2026 are included in this recall. The manufacture date, in YYYY/MM format, and the model number are printed on a label on the heater's underside.";
const CPSC_27041 =
  "This recall involves Luminaires with certain adjustable tilt mounting arms manufactured between August 2019 to July 2020 and August 2024 to April 2026: AASP, AARP, AAWB, and AAWSC.";
const FDA_Z0151 =
  "Likorall Overhead Lifts Product Code: 3121001 Product Description: LIKORALL 200 Product Code: 3122005 Product Description: LIKORALL 242 ES, NATURAL\nProduct Code: 3121001 Product Description: LIKORALL 200 Lot/Serial Number: Intervals: 8400054-8450499 and 9000000-9000999 UDI-DI Number: 00887761981911 Product Code: 3122005 Product Description: LIKORALL 242 ES, NATURAL Lot/Serial Number: Greater than or equal to 8104548";
const FDA_Z0783 = "Distributed between 04JAN2021 and 24MAR2021. P/N Product name 3130001 Multirall 200 3121001 Likorall 200 3122005 Likorall 242 ES natural";

const cpsc = (id: string, text: string, models: string[] = []): Notice => ({ source: "cpsc", id, title: "Recall", date: "2026-10-29", url: "https://example.org", models, lots: [], upcs: [], text });
const fda = (id: string, text: string, models: string[] = []): Notice => ({ source: "fda", id, title: "Liko overhead lift", date: "2026-10-21", url: "https://example.org", models, lots: [], upcs: [], text, firm: "Liko" });

test("made-date windows read from CPSC's own sentences", () => {
  assert.deepEqual(madeWindowsIn(CPSC_27054), [{ from: "2025-04-01", to: "2026-01-31" }]);
  assert.deepEqual(madeWindowsIn(CPSC_27041), [
    { from: "2019-08-01", to: "2020-07-31" },
    { from: "2024-08-01", to: "2026-04-30" },
  ]);
  assert.deepEqual(madeWindowsIn("All units sold from April 2025 through January 2026."), []);
});

test("a listed model made outside the window is not red; inside it is; no date asks for one", () => {
  const n = cpsc("27-054", CPSC_27054, ["DR-HSH015"]);
  const heater = (made?: string): Item => ({ id: "i1", kind: "product", said: "DREO heater", brand: "DREO", product: "space heater", model: "DR-HSH015", made });
  assert.equal(matchItem(heater("2025/08"), n).level, "danger");
  assert.equal(matchItem(heater("2026/03"), n).level, null);
  assert.equal(matchItem(heater(), n).level, "warning");
});

test("serial intervals are read for the item's own product code, wherever the record prints them", () => {
  const lift = (serial: string): Item => ({ id: "i1", kind: "device", said: "Likorall 200", brand: "Liko", product: "Likorall 200 overhead lift", codes: ["3121001"], serial });
  assert.deepEqual(serialBoundsFor(lift("8412345"), FDA_Z0151), [
    { lo: "8400054", hi: "8450499" },
    { lo: "9000000", hi: "9000999" },
  ]);
  // No product code of the item's in the record: another product's intervals prove nothing.
  assert.deepEqual(serialBoundsFor({ ...lift("8412345"), codes: ["3999999"] }, FDA_Z0151), []);
  assert.equal(matchItem(lift("8412345"), fda("Z-0151-2027", FDA_Z0151)).level, "danger");
  assert.equal(matchItem(lift("8455120"), fda("Z-0151-2027", FDA_Z0151)).serialOutside, true);
});

test("a bare product-code match in an older recall is held at orange when the newer one's intervals exclude the serial", () => {
  const lift: Item = { id: "i1", kind: "device", said: "Likorall 200", brand: "Liko", product: "Likorall 200 overhead lift", codes: ["3121001"], serial: "8455120" };
  const newer = fda("Z-0151-2027", FDA_Z0151);
  const older = fda("Z-0783-2022", FDA_Z0783, ["3121001"]);
  const results = [newer, older].map((notice) => ({ notice, match: matchItem(lift, notice) }));
  assert.equal(results[1].match.level, "danger");
  assert.equal(decide(results).level, "warning");
  // Inside the interval: the newer recall is red on the serial itself.
  const inside = { ...lift, serial: "8412345" };
  assert.equal(decide([newer, older].map((notice) => ({ notice, match: matchItem(inside, notice) }))).level, "danger");
});

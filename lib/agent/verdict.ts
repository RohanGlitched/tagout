import type { Item, Notice, Source, Verdict } from "../types";
import { decide, matchItem } from "../match";

export const SOURCE_NAME: Record<Source, string> = {
  nhtsa: "NHTSA",
  cpsc: "CPSC",
  fda: "FDA",
  fsis: "USDA FSIS",
  web: "the web",
};

const WHERE: Record<Item["kind"], string> = {
  vehicle: "Your VIN is on the driver's side of the dashboard, seen through the windshield, and on the door-jamb sticker.",
  "car-seat": "The model number and date of manufacture are on a white label on the side, back or bottom of the seat.",
  product: "The model number is on the rating label, usually on the back or bottom.",
  device: "The model and serial numbers are on the label on the back or bottom of the device.",
  drug: "The lot number and expiry are printed on the end flap of the carton and on the bottle label.",
  food: "The lot code and best-by date are printed near the barcode, on the lid, or on the side of the pack.",
};

const FIELD_NAME: Record<Item["kind"], string> = {
  vehicle: "VIN",
  "car-seat": "model number and date of manufacture",
  product: "model number",
  device: "model and serial number",
  drug: "lot number",
  food: "lot code",
};

/**
 * A green tag's headline says only what was actually compared: "none lists your model number" needs a model
 * number and a recall that lists some; a car is cleared by make, model and year.
 */
function greenHeadline(item: Item, cleared: Notice[], what: string, old: Notice[]): string {
  if (item.kind === "vehicle" && item.year && item.brand && item.product) {
    return cleared.some((n) => n.vehicleModel) ? `No NHTSA recall covers the ${item.year} ${item.brand} ${item.product}.` : `No recall found for the ${item.year} ${item.brand} ${item.product}.`;
  }
  const code = item.kind === "drug" || item.kind === "food" ? item.lot : item.model ?? item.codes?.[0];
  const listing = cleared.filter((n) => n.models.length || n.lots.length || n.upcs.length);
  if (code && listing.length) return `${listing.length === 1 ? "A recall exists" : "Recalls exist"} for this brand, but none lists your ${FIELD_NAME[item.kind]}.`;
  if (old.length) {
    const year = old.map((n) => n.date.slice(0, 4)).filter(Boolean).sort().at(-1);
    return `Only older recalls found${year ? ` (latest ${year})` : ""}, too old to cover what you have now.`;
  }
  return `No recall found for ${what}.`;
}

/** Turns the matcher's result into the tag: a headline, the proof, and what to do, in order. */
export function buildVerdict(item: Item, notices: Notice[], searched: Source[], checkedAt: string): Verdict {
  // Food is eaten within months and medicine expires within about three years, so older recalls of those
  // can't cover what's in the cupboard now; they're listed as related instead. Products and cars keep theirs.
  const maxAge = item.kind === "food" ? 400 : item.kind === "drug" ? 3 * 365 : Infinity;
  const fresh = (n: Notice) => !n.date || Date.now() - Date.parse(n.date) < maxAge * 86_400_000;
  const old = notices.filter((n) => !fresh(n));
  const results = notices.filter(fresh).map((notice) => ({ notice, match: matchItem(item, notice) }));
  const d = decide(results);
  const top = d.top;
  const cleared = results.filter((r) => r.match.level === null).map((r) => r.notice);
  const related = [...d.related, ...cleared, ...old].filter((n, i, a) => a.indexOf(n) === i).slice(0, 4);
  const base = { itemId: item.id, checkedAt, searched, related };

  if (d.level === "inspected" || !top) {
    const what = item.model ? `${item.brand ? `${item.brand} ` : ""}model ${item.model}` : item.lot ? `lot ${item.lot}` : item.said;
    const where = searched.filter((s) => s !== "web").map((s) => SOURCE_NAME[s]);
    return {
      ...base,
      level: "inspected",
      headline: greenHeadline(item, cleared, what, old),
      proof: cleared.length ? results.flatMap((r) => r.match.proof.filter((p) => !p.matched)).slice(0, 3) : [],
      steps: [
        `Searched ${[...new Set(where)].join(", ") || "the agency databases"}${searched.includes("web") ? " and the web" : ""} on ${checkedAt.slice(0, 10)}.`,
        item.kind === "vehicle"
          ? "Recalls can be added at any time; check your VIN at nhtsa.gov/recalls once a year."
          : "Register it with the maker so they can tell you directly if it's recalled later.",
      ],
    };
  }

  const n = top.notice;
  const steps: string[] = [];
  if (n.urgent) steps.push(n.urgent);

  if (d.level === "danger") {
    if (!/stop using|do not use|don.t use|immediately/i.test(n.remedy ?? "")) steps.push("Stop using it until you've followed the recall's remedy.");
    if (n.remedy) steps.push(n.remedy);
    if (n.contact) steps.push(n.contact);
    return { ...base, level: "danger", headline: top.match.why, notice: n, proof: top.match.proof, steps };
  }

  // Orange: the product line is recalled; the deciding code isn't confirmed.
  if (item.kind === "vehicle" || n.vehicleModel) {
    steps.push(`Enter your VIN at nhtsa.gov/recalls to see whether your car is included and whether it's already been repaired.`);
    if (n.remedy) steps.push(`If it's included: ${n.remedy}`);
  } else {
    steps.push(n.whereToLook ? `Find the ${FIELD_NAME[item.kind]}: ${n.whereToLook.replace(/\.$/, "")}.` : WHERE[item.kind]);
    steps.push(`Add it to this check and run it again; Tagout will compare it with the recall's list.`);
    if (n.remedy) steps.push(`If yours is covered: ${n.remedy}`);
  }
  return { ...base, level: "warning", headline: top.match.why, notice: n, proof: top.match.proof, steps, whereToLook: n.whereToLook ?? WHERE[item.kind] };
}

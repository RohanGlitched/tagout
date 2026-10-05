/** Shared shapes: what a household owns, what an agency published, and what Tagout concluded. */

export type ItemKind = "vehicle" | "car-seat" | "product" | "drug" | "food" | "device";

/** One thing the household owns, as read from what they typed or photographed. */
export type Item = {
  id: string;
  kind: ItemKind;
  /** What the person wrote (or "Photo of a label"), kept for display. */
  said: string;
  brand?: string;
  product?: string;
  model?: string;
  serial?: string;
  lot?: string;
  vin?: string;
  year?: number;
  /** Date of manufacture or date code as printed. */
  made?: string;
  upc?: string;
  ndc?: string;
  /** Any other code printed on the label ("TYPE SRTH", a style or item number), tried against recalls too. */
  codes?: string[];
  /** Where the facts came from: typed, read from a photo, or decoded (VIN). */
  readFrom?: "typed" | "photo" | "vin";
};

export type Source = "nhtsa" | "cpsc" | "fda" | "fsis" | "web";

/** A recall notice, normalised from any agency. */
export type Notice = {
  source: Source;
  /** The agency's own number, e.g. NHTSA 24V123000, CPSC 25-123, FDA D-0123-2025. */
  id: string;
  title: string;
  /** ISO date the recall was published. */
  date: string;
  url: string;
  firm?: string;
  hazard?: string;
  remedy?: string;
  contact?: string;
  image?: string;
  /** Model numbers, names or ranges as the notice lists them. */
  models: string[];
  /** Lot codes, batch numbers, serial ranges or date codes the notice lists. */
  lots: string[];
  upcs: string[];
  /** Vehicles only. */
  make?: string;
  vehicleModel?: string;
  years?: number[];
  units?: number;
  /** "Built/made between" windows the notice gives, as ISO dates. */
  madeRanges?: { from: string; to: string }[];
  /** Stop-use flags: NHTSA "park it" / "park outside", or a do-not-use instruction. */
  urgent?: string;
  /** Where to find the deciding code on the product, when the notice says. */
  whereToLook?: string;
  /** FDA: "Drugs", "Food" or "Devices"; FDA severity class ("Class I" is the most serious). */
  category?: string;
  severity?: string;
  /** The agency's own wording the identifiers were read from; every extracted code must appear in it. */
  text?: string;
};

export type TagLevel = "danger" | "warning" | "inspected";

/** One field of the item that matched (or failed to match) a field of the notice. */
export type Proof = {
  field: "model" | "lot" | "vin" | "upc" | "year" | "make" | "product" | "made";
  yours: string;
  theirs: string;
  matched: boolean;
};

export type Verdict = {
  itemId: string;
  level: TagLevel;
  /** One plain sentence: the tag's headline. */
  headline: string;
  notice?: Notice;
  /** Other notices for the same product line that didn't match this item. */
  related?: Notice[];
  proof: Proof[];
  /** What to do, in order. */
  steps: string[];
  /** For orange tags: where the deciding field is printed on this kind of product. */
  whereToLook?: string;
  checkedAt: string;
  searched: Source[];
};

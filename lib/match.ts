import type { Item, Notice, Proof, TagLevel } from "./types";

/**
 * The deterministic half of a verdict. The model decides which notices are about the same kind of product; this
 * file decides whether the household's own identifiers (model, lot, UPC, VIN year) are actually listed. A red
 * tag needs a printed identifier on the item that the notice lists, character for character after
 * normalisation. Nothing here calls a model.
 */

/** Upper-case and drop spaces, dashes, dots, slashes and similar, so "CT-22425" and "ct 22425" compare equal. */
export function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9*]/g, "");
}

/** Lower-case words for brand comparison, with corporate suffixes dropped. */
/**
 * Whether a string a reader returned could be a product code (model, lot, UPC, or a range of them). A reader
 * that strays sometimes returns file paths or sentences; those are dropped quietly instead of being shown as
 * "struck codes".
 */
export function looksLikeCode(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 60 || !/^[A-Za-z0-9#]/.test(t) || /^(n\/?a|none|null|unknown|tbd|all)$/i.test(t)) return false;
  if (/(^|\s)\/|\\|\.(py|js|ts|sh|exe|json|txt|html?)\b|\b(usr|bin|home|tmp|var|etc)\//i.test(t)) return false;
  if (t.split(/\s+/).filter((w) => !/^(through|thru|to|and|[–—-])$/i.test(w)).length > 4) return false;
  return true;
}

export function normBrand(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|usa|us|america|of|the|mfg|manufacturing|brands?|products?|international|intl)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a notice's free-text list into identifier tokens: "Model 5160, 5165 and 5170" → ["5160","5165","5170"].
 * Keeps "A100 through A150" ranges as one "A100..A150" token; "1001-1050" only when `dashRanges` (lot lists, not
 * model lists, where a dash is usually part of the number, as in an NDC).
 */
export function splitIds(text: string, dashRanges = true): string[] {
  const out: string[] = [];
  const t = text.replace(/\b(through|thru|to)\b/gi, "..").replace(/\s*(–|—)\s*/g, "..");
  for (const part of t.split(/[,;\n]|\band\b|\bor\b|&/i)) {
    const p = part
      .replace(/\b(models?|model numbers?|model nos?\.?|item(?: numbers?)?|sku|style|type|lot(?: numbers?| codes?)?|lots?|batch(?: numbers?)?|date codes?|upc|no\.?|numbers?|#)\b:?/gi, " ")
      .trim();
    if (!p) continue;
    const range = p.match(/^([A-Z0-9][A-Z0-9 .\/-]*?)\s*\.\.\s*([A-Z0-9][A-Z0-9 .\/-]*)$/i);
    if (range) {
      out.push(`${norm(range[1])}..${norm(range[2])}`);
      continue;
    }
    // A short dashed range like "1001-1050" where both halves are numbers of the same length.
    const dash = p.match(/^(\d{3,})-(\d{3,})$/);
    if (dashRanges && dash && dash[1].length === dash[2].length && Number(dash[2]) > Number(dash[1])) {
      out.push(`${dash[1]}..${dash[2]}`);
      continue;
    }
    for (const tok of p.split(/\s+/)) {
      const n = norm(tok);
      // An identifier is at least three characters and has a digit, or is printed in capitals ("SRTH");
      // ordinary words like "blue" aren't ids.
      if (n.length >= 3 && (/\d/.test(n) || (/^[A-Z][A-Z0-9-]{2,}$/.test(tok) && !/^(THE|AND|FOR|WITH|ONLY|ALL|USA)$/.test(n)))) out.push(n);
    }
  }
  return [...new Set(out)];
}

/** Split an identifier into a letter prefix, its digits and any suffix: "2LC1234" → ["2LC", "1234", ""]. */
function parts(id: string): [string, string, string] | null {
  const m = id.match(/^(.*?)(\d+)([A-Z]*)$/);
  return m ? [m[1], m[2], m[3]] : null;
}

export type IdMatch = "exact" | "range" | "wildcard" | "variant" | null;

/**
 * Compare one of the household's identifiers to one listed by a notice.
 * - exact: same characters after normalisation.
 * - range: inside "A100..A150" (same prefix and suffix, same digit count).
 * - wildcard: the notice prints "5160X" (models only) or "5160*" for a family.
 * - variant: one is the other plus a short suffix ("CT22425" vs "CT22425B"). Never enough for a red tag.
 */
export function compareId(yours: string, listed: string, family = true): IdMatch {
  const y = norm(yours);
  if (y.length < 3) return null;
  if (listed.includes("..")) {
    const [a, b] = listed.split("..");
    const pa = parts(a), pb = parts(b), py = parts(y);
    if (!pa || !pb || !py) return null;
    if (pa[0] !== pb[0] || pa[2] !== pb[2] || pa[1].length !== pb[1].length) return null;
    if (py[0] !== pa[0] || py[2] !== pa[2] || py[1].length !== pa[1].length) return null;
    const v = Number(py[1]);
    return v >= Number(pa[1]) && v <= Number(pb[1]) ? "range" : null;
  }
  const l = norm(listed);
  if (!l) return null;
  if (y === l) return "exact";
  const wild = l.match(/^([A-Z0-9]{3,}?)(X+|\*+)$/);
  // A trailing X is a family code in model lists ("5160X"), but in a lot list it is just a letter ("YH9X").
  if (family && wild && y.startsWith(wild[1]) && y.length === l.length && wild[2][0] === "X") return "wildcard";
  if (wild && wild[2][0] === "*" && y.startsWith(wild[1])) return "wildcard";
  const [short, long] = y.length < l.length ? [y, l] : [l, y];
  if (short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2 && /^[A-Z]+$/.test(long.slice(short.length))) return "variant";
  return null;
}

/** Does the notice name this brand anywhere (firm, title or listed products)? */
export function brandIn(brand: string | undefined, notice: Notice): boolean {
  if (!brand) return false;
  const b = normBrand(brand);
  // Too short or too common to identify a maker ("my", "baby", "home").
  if (b.length < 3 || /^(my|our|the|old|new|hello|this|that|kids?|baby|home|children s?)$/.test(b)) return false;
  const hay = ` ${normBrand([notice.firm, notice.title, notice.make, ...notice.models].filter(Boolean).join(" "))} `;
  if (hay.includes(` ${b} `) || hay.includes(` ${b.replace(/ /g, "")} `)) return true;
  // A product brand and its company often share only the first word ("Hillshire Farm" / "Hillshire Brands").
  // Accept that when the word is long enough to be a name rather than an ordinary word.
  const first = b.split(" ")[0];
  return b.includes(" ") && first.length >= 6 && !COMMON.has(first) && hay.includes(` ${first} `);
}

const COMMON = new Set(["little", "simple", "nature", "natural", "healthy", "family", "global", "classic", "original", "premium", "summer", "golden", "garden", "kitchen", "comfort", "sunset", "spring", "silver", "united", "modern", "better", "bright"]);

export type Match = {
  level: TagLevel | null;
  proof: Proof[];
  /** One plain sentence explaining the outcome, for the tag. */
  why: string;
};

const listedIds = (list: string[], dashRanges: boolean) => [...new Set(list.flatMap((t) => splitIds(t, dashRanges)))];

const RANK = { exact: 4, range: 3, wildcard: 2, variant: 1 } as const;

/** Find the best match of `yours` among the notice's listed ids. */
function best(yours: string | undefined, listed: string[], family = true): { how: IdMatch; theirs: string } | null {
  if (!yours) return null;
  let found: { how: IdMatch; theirs: string } | null = null;
  for (const l of listed) {
    const how = compareId(yours, l, family);
    if (how && (!found || RANK[how] > RANK[found.how!])) found = { how, theirs: l.replace("..", " through ") };
  }
  return found;
}

/**
 * Match one item against one notice the model judged relevant.
 * Returns level null when the notice lists identifiers and the item's identifier is printed but not among them.
 */
export function matchItem(item: Item, notice: Notice): Match {
  const proof: Proof[] = [];

  if (item.kind === "vehicle" || notice.vehicleModel) {
    return matchVehicle(item, notice);
  }

  const models = listedIds(notice.models, false);
  const lots = listedIds(notice.lots, true);
  const upcs = notice.upcs.map(norm).filter((u) => u.length >= 8);

  // The model number and any other printed code (a TYPE, style or item number) are all tried.
  let m: { how: IdMatch; theirs: string } | null = null;
  let mYours = item.model;
  // Codes as typed may carry their label ("TYPE SRTH"); try the bare code too.
  const mine = [item.model, ...(item.codes ?? [])].filter((c): c is string => Boolean(c));
  for (const c of [...mine, ...mine.flatMap((c) => splitIds(c, false)).filter((c) => !mine.some((x) => norm(x) === c))]) {
    const b = best(c, models);
    if (b && (!m || RANK[b.how!] > RANK[m.how!])) {
      m = b;
      mYours = c;
    }
  }
  const l = best(item.lot, lots, false);
  const u = item.upc ? upcs.find((x) => x.replace(/^0+/, "") === norm(item.upc!).replace(/^0+/, "")) : undefined;

  if (m) proof.push({ field: "model", yours: mYours!, theirs: m.theirs, matched: m.how !== "variant" });
  if (l) proof.push({ field: "lot", yours: item.lot!, theirs: l.theirs, matched: l.how !== "variant" });
  if (u) proof.push({ field: "upc", yours: item.upc!, theirs: u, matched: true });

  let strongModel = Boolean(m && m.how !== "variant");
  const strongLot = l && l.how !== "variant";

  // The reader can miss a code the notice prints (a long lot list cut short, a model in a sentence it skipped).
  // A code of yours that the notice's own text prints, as a whole word and not in a "not included" sentence,
  // counts as listed: the text outranks the reader's list.
  const ownBrand = !item.brand || brandIn(item.brand, notice);
  const inText = (c: string | undefined) => Boolean(c && (ownBrand || distinctive(c)) && printedIn(c, notice.text));
  const lotInText = !strongLot && inText(item.lot);

  // When a notice lists lots, the lot decides. A model match alone isn't enough for a lot-limited recall.
  if (lots.length && item.lot) {
    if (strongLot) return { level: "danger", proof, why: `Lot ${item.lot} is listed in this recall.` };
    if (lotInText) {
      proof.push({ field: "lot", yours: item.lot, theirs: `${item.lot} (in the notice's text)`, matched: true });
      return { level: "danger", proof, why: `Lot ${item.lot} is printed in this recall.` };
    }
    proof.push({ field: "lot", yours: item.lot, theirs: lots.slice(0, 4).join(", ").replace(/\.\./g, " through "), matched: false });
    return { level: null, proof, why: `Lot ${item.lot} isn't among the lots this recall lists.` };
  }
  if (lots.length && !item.lot && (strongModel || u || brandIn(item.brand, notice))) {
    return { level: "warning", proof, why: "This recall is limited to certain lots. Check the lot number printed on yours." };
  }

  if (!strongModel && !u && m?.how !== "variant") {
    const printed = [...mine, ...mine.flatMap((c) => splitIds(c, false))].find(inText);
    if (printed) {
      strongModel = true;
      mYours = printed;
      proof.push({ field: "model", yours: printed, theirs: `${printed} (in the notice's text)`, matched: true });
    }
  }
  if (!lots.length && lotInText && !strongModel && !u) {
    proof.push({ field: "lot", yours: item.lot!, theirs: `${item.lot} (in the notice's text)`, matched: true });
    return { level: "danger", proof, why: `Lot ${item.lot} is printed in this recall.` };
  }

  if (strongModel || u) {
    const what = strongModel ? `${/^\d/.test(mYours!) ? "Model " : ""}${mYours}` : `UPC ${item.upc}`;
    const window = notice.madeRanges?.[0];
    if (window) {
      const made = parseMade(item.made);
      const span = window.from <= "1901" ? `before ${window.to}` : window.to >= "2998" ? `after ${window.from}` : `between ${window.from} and ${window.to}`;
      if (!made) return { level: "warning", proof, why: `${what} is listed, but only units made ${span}. Check the date of manufacture on the label.` };
      const inside = made.end >= window.from && made.start <= window.to;
      proof.push({ field: "made", yours: item.made!, theirs: `made ${span}`, matched: inside });
      if (!inside) return { level: null, proof, why: `${what} is listed, but only units made ${span} are recalled, and yours was made ${item.made}.` };
    }
    // The notice limits the recall to certain lots or date codes, but the list it was read into has none: the
    // notice's own text decides. A lot or date code on the label that the notice doesn't print can't be red.
    const limited = !lots.length && /\b(lot|batch|date code|serial number)s?\b/i.test(notice.text ?? "");
    const hay = norm(notice.text ?? "");
    const unlisted = limited ? labelCodes(item).find((c) => !hay.includes(norm(c))) : undefined;
    if (unlisted) {
      proof.push({ field: "lot", yours: unlisted, theirs: "not printed in the notice", matched: false });
      return { level: "warning", proof, why: `${what} is listed, but this recall names particular lot or date codes and ${unlisted} isn't one the notice prints. Compare the code on yours with the notice.` };
    }
    return { level: "danger", proof, why: `${what} is listed in this recall${m?.how === "range" ? " range" : ""}.` };
  }
  if (m?.how === "variant") {
    return { level: "warning", proof, why: `The recall lists ${m.theirs}, which is close to your ${item.model}. Compare the full model number on the label.` };
  }
  if (models.length && item.model) {
    proof.push({ field: "model", yours: item.model, theirs: models.slice(0, 4).join(", ").replace(/\.\./g, " through "), matched: false });
    return { level: null, proof, why: `Model ${item.model} isn't among the models this recall lists.` };
  }
  if (brandIn(item.brand, notice)) {
    proof.push({ field: "make", yours: item.brand!, theirs: notice.firm ?? notice.title, matched: true });
    return {
      level: "warning",
      proof,
      why: item.model
        ? "This recall doesn't print model numbers. Compare the product photo and description."
        : `This product line is recalled. Check the ${item.kind === "food" ? "lot code and dates" : item.kind === "drug" ? "lot number" : "model number"} on yours.`,
    };
  }
  return { level: null, proof, why: "Nothing on your label ties it to this recall." };
}

/** Long enough and mixed enough (letters and digits, 6+ characters) that finding it in another brand's notice isn't chance. */
export const distinctive = (c: string) => {
  const n = norm(c);
  return n.length >= 6 && /[A-Z]/.test(n) && /\d/.test(n);
};

const EXCLUDED = /\bnot\b[^.]{0,40}\b(included|affected|part of|subject|recalled|covered)\b|\bexclud(ed|es|ing)\b/i;

/**
 * Is this code printed in the text as a whole word (ignoring case, dashes and dots), outside any sentence that
 * says some units are not included? Codes shorter than four characters, or without a digit, are too easy to find
 * by accident and never count.
 */
export function printedIn(code: string | undefined, text: string | undefined): boolean {
  if (!code || !text) return false;
  const c = norm(code);
  if (c.length < 4 || !/\d/.test(c)) return false;
  for (const sentence of text.split(/(?<=[.;!?])\s+|\n+/)) {
    if (EXCLUDED.test(sentence)) continue;
    if (sentence.split(/[^A-Za-z0-9./+-]+/).some((t) => norm(t) === c)) return true;
  }
  return false;
}

/** The lot, serial or date code printed on the item (a date code that isn't a calendar date, like "7W16TN"). */
function labelCodes(item: Item): string[] {
  const made = item.made && !parseMade(item.made) && /[A-Z]/i.test(item.made) && /\d/.test(item.made) && norm(item.made).length >= 4 ? item.made : undefined;
  return [item.lot, item.serial, made].filter((c): c is string => Boolean(c && norm(c).length >= 3));
}

/**
 * Vehicle recalls (NHTSA) are filed by make, model and model year, but a campaign may cover only some VINs, and
 * the per-VIN lookup isn't a public API. So a make/model/year match is orange with a link to check the VIN,
 * never red.
 */
function matchVehicle(item: Item, notice: Notice): Match {
  const proof: Proof[] = [];
  const makeOk = item.brand && notice.make ? normBrand(item.brand) === normBrand(notice.make) : false;
  const modelOk = item.product && notice.vehicleModel ? norm(notice.vehicleModel).startsWith(norm(item.product)) || norm(item.product).startsWith(norm(notice.vehicleModel)) : false;
  const yearOk = item.year && notice.years?.length ? notice.years.includes(item.year) : false;
  if (item.brand && notice.make) proof.push({ field: "make", yours: item.brand, theirs: notice.make, matched: makeOk });
  if (item.product && notice.vehicleModel) proof.push({ field: "product", yours: item.product, theirs: notice.vehicleModel, matched: modelOk });
  if (item.year && notice.years?.length) proof.push({ field: "year", yours: String(item.year), theirs: yearsText(notice.years), matched: yearOk });
  if (makeOk && modelOk && yearOk) {
    return { level: "warning", proof, why: "This recall covers your make, model and year. Enter your VIN on NHTSA's site to see if your car is one of them." };
  }
  return { level: null, proof, why: "This recall is for a different make, model or year." };
}

/**
 * A printed manufacture date as an ISO span: "2023/03/14" is one day, "03/2023" a whole month. Returns null for
 * anything ambiguous (a bare "2211" date code means different things to different makers).
 */
export function parseMade(s: string | undefined): { start: string; end: string } | null {
  if (!s) return null;
  const t = s.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return day(+m[3], +m[1], +m[2]);
  m = t.match(/^(\d{4})[-/.](\d{1,2})$/) ?? (t.match(/^(\d{1,2})[-/.](\d{4})$/)?.slice(0, 3).reverse() as RegExpMatchArray | undefined) ?? null;
  if (m) {
    const y = Number(t.match(/\d{4}/)![0]);
    const mo = Number(t.replace(String(y), "").match(/\d{1,2}/)![0]);
    if (mo < 1 || mo > 12) return null;
    return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
  }
  return null;
  function day(y: number, mo: number, d: number) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    return { start: iso, end: iso };
  }
}

export function yearsText(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (ys.length > 2 && ys[ys.length - 1] - ys[0] === ys.length - 1) return `${ys[0]}–${ys[ys.length - 1]}`;
  return ys.join(", ");
}

/** Combine per-notice matches into the item's tag: any red wins, then orange, else green. */
export function decide(results: { notice: Notice; match: Match }[]): { level: TagLevel; top?: { notice: Notice; match: Match }; related: Notice[] } {
  const reds = results.filter((r) => r.match.level === "danger");
  const oranges = results.filter((r) => r.match.level === "warning");
  const pick = (rs: typeof results) => [...rs].sort(leadOrder)[0];
  if (reds.length) {
    const top = pick(reds);
    return { level: "danger", top, related: [...reds, ...oranges].map((r) => r.notice).filter((n) => n !== top.notice) };
  }
  if (oranges.length) {
    const top = pick(oranges);
    return { level: "warning", top, related: oranges.map((r) => r.notice).filter((n) => n !== top.notice) };
  }
  return { level: "inspected", related: [] };
}

/**
 * How closely a notice pins down this item: each of the item's own codes it lists counts most, then any other
 * matched field, then whether the notice prints a code list at all (a recall that names its models can be
 * compared on the label; one that doesn't, can't).
 */
export function specificity(r: { notice: Notice; match: Match }): number {
  const matched = r.match.proof.filter((p) => p.matched);
  const codes = matched.filter((p) => p.field === "model" || p.field === "lot" || p.field === "upc" || p.field === "vin").length;
  const lists = r.notice.models.length + r.notice.lots.length + r.notice.upcs.length > 0 ? 1 : 0;
  return codes * 10 + matched.length * 2 + lists;
}

/**
 * The order the lead notice is picked in, so the same recall leads every run whatever order the search returned
 * them in: the notice that pins the item down most closely, then the agency's own record before a web copy, then
 * the newest, then the recall number.
 */
export function leadOrder(a: { notice: Notice; match: Match }, b: { notice: Notice; match: Match }): number {
  const strength = (r: { notice: Notice; match: Match }) => Math.floor(specificity(r) / 2);
  return (
    strength(b) - strength(a) ||
    Number(a.notice.source === "web") - Number(b.notice.source === "web") ||
    (b.notice.date || "").localeCompare(a.notice.date || "") ||
    specificity(b) - specificity(a) ||
    `${a.notice.source}:${a.notice.id}:${a.notice.url}`.localeCompare(`${b.notice.source}:${b.notice.id}:${b.notice.url}`)
  );
}

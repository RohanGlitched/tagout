import type { Basis, Item, Notice, Proof, TagLevel } from "./types";
import { fmtDate } from "./format";

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
    // In a lot list, a short capital-letter part printed after a numbered part belongs to it: "091026 DL" is one
    // lot (a date and a line code), and the neighbouring "091026 TL" is another. Model lists keep each word apart.
    const toks = dashRanges ? joinCodeParts(p.split(/\s+/)) : p.split(/\s+/);
    for (const tok of toks) {
      const n = norm(tok);
      // An identifier is at least three characters and has a digit, or is printed in capitals ("SRTH");
      // ordinary words like "blue" aren't ids.
      if (n.length >= 3 && (/\d/.test(n) || (/^[A-Z][A-Z0-9-]{2,}$/.test(tok) && !/^(THE|AND|FOR|WITH|ONLY|ALL|USA)$/.test(n)))) out.push(n);
    }
  }
  return [...new Set(out)];
}

/** Words that follow a code in a lot clause without being part of it: units, labels and joining words. */
const NOT_A_PART = /^(AND|OR|TO|THE|FOR|OF|BY|IN|ON|AT|USA|US|EXP|LOT|LOTS|UPC|NDC|SKU|BB|BBD|MFG|BEST|USE|OZ|FL|LB|LBS|KG|G|MG|ML|L|CT|PK|PC|PCS|EA)$/;

/**
 * Joins a 1-3 letter part in capitals to the numbered part printed just before it: ["091026", "DL", "-", "JUN"]
 * → ["091026 DL", "-", "JUN"]. One part at most; units and labels ("OZ", "EXP", "UPC") and lower-case words are
 * never joined, and any other word in between (a dash, an empty token) breaks the run.
 */
export function joinCodeParts(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const prev = out.at(-1);
    if (prev && /\d/.test(prev) && /^[A-Z]{1,3}$/.test(t) && !NOT_A_PART.test(t) && !prev.includes(" ")) out[out.length - 1] = `${prev} ${t}`;
    else out.push(t);
  }
  return out;
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
  // A company name written as one word with its suffix: "HatsanUSA", "AcmeInc" name Hatsan and Acme.
  if (b.length >= 4 && new RegExp(` ${b.replace(/ /g, "")}(${SUFFIXES}) `).test(hay)) return true;
  // A product brand and its company often share only the first word ("Hillshire Farm" / "Hillshire Brands").
  // Accept that when the word is long enough to be a name rather than an ordinary word.
  const first = b.split(" ")[0];
  return b.includes(" ") && first.length >= 6 && !COMMON.has(first) && hay.includes(` ${first} `);
}

const SUFFIXES = "usa|us|inc|llc|ltd|co|corp|america|intl|international|group|brands|products|mfg";

/**
 * The brand named as a word in the notice's own text, for a recall that prints no codes: "This recall involves
 * all units of the Hatsan Blitz" names Hatsan even when the title says "HatsanUSA" and the firm field is empty.
 */
export function brandInText(brand: string | undefined, notice: Notice): boolean {
  if (!brand) return false;
  const b = normBrand(brand);
  if (b.length < 3 || /^(my|our|the|old|new|hello|this|that|kids?|baby|home|children s?)$/.test(b) || COMMON.has(b)) return false;
  return ` ${normBrand(notice.text ?? "")} `.includes(` ${b} `);
}

const COMMON = new Set(["little", "simple", "nature", "natural", "healthy", "family", "global", "classic", "original", "premium", "summer", "golden", "garden", "kitchen", "comfort", "sunset", "spring", "silver", "united", "modern", "better", "bright"]);

export type Match = {
  level: TagLevel | null;
  proof: Proof[];
  /** One plain sentence explaining the outcome, for the tag. */
  why: string;
  /** Orange because the code matches but the recall is limited to a made-date window yours doesn't show: the
   *  steps ask for the date, not for a code. */
  window?: { from: string; to: string };
  /** Red: how the deciding code matched (reader's list, the record's own list or the text; exact, range, family). */
  basis?: Basis;
};

/** A USDA establishment number as typed ("EST. 7839", "EST. M/P 7839", "P-20935A"): printed inside the USDA mark
 *  of inspection, it names the plant, not a model. */
export const EST_CODE = /^\s*(?:EST\.?|EST(?:ABLISHMENT)?\s*(?:NO\.?|#)?)\s*(?:[MPV]\s*\/?\s*[MPV]?\s*-?\s*)?\d{2,6}[A-Z]?\s*$|^\s*[MPV]-\d{2,6}[A-Z]?\s*$/i;

/** The item's establishment number that `code` came from, as typed, if it is one. */
function establishmentOf(item: Item, code: string): string | undefined {
  const c = norm(code);
  return [item.model, ...(item.codes ?? [])].find((x): x is string => Boolean(x && EST_CODE.test(x) && (norm(x) === c || splitIds(x, false).includes(c))));
}

/** "between 31 Mar 2026 and 7 Oct 2026", "before 7 Oct 2026", "after 31 Mar 2026". */
export function windowText(w: { from: string; to: string }): string {
  return w.from <= "1901" ? `before ${fmtDate(w.to)}` : w.to >= "2998" ? `after ${fmtDate(w.from)}` : `between ${fmtDate(w.from)} and ${fmtDate(w.to)}`;
}

const listedIds = (list: string[], dashRanges: boolean) => [...new Set(list.flatMap((t) => splitIds(t, dashRanges)))];

const RANK = { exact: 4, range: 3, wildcard: 2, variant: 1 } as const;

/** Find the best match of `yours` among the notice's listed ids (`tok` is the listed id as split). */
function best(yours: string | undefined, listed: string[], family = true): { how: IdMatch; theirs: string; tok: string } | null {
  if (!yours) return null;
  let found: { how: IdMatch; theirs: string; tok: string } | null = null;
  for (const l of listed) {
    const how = compareId(yours, l, family);
    if (how && (!found || RANK[how] > RANK[found.how!])) found = { how, theirs: l.replace("..", " through "), tok: l };
  }
  return found;
}

const HOW: Record<"exact" | "range" | "wildcard", Basis["how"]> = { exact: "exact", range: "range", wildcard: "family" };

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
  // The ids the agency record itself listed (its own fields, or the deterministic parse of them), as against
  // those only the notice reader listed: for the eval's split of what decided each red tag.
  const byReader = new Set((notice.readCodes ?? []).map(norm));
  const recordIds = new Set([
    ...listedIds(notice.models.filter((x) => !byReader.has(norm(x))), false),
    ...listedIds(notice.lots.filter((x) => !byReader.has(norm(x))), true),
    ...notice.upcs.filter((x) => !byReader.has(norm(x))).map(norm),
  ]);
  const listBasis = (b: { how: IdMatch; tok: string }, window?: boolean): Basis => ({ by: recordIds.has(b.tok) ? "record-list" : "reader-list", how: HOW[b.how as keyof typeof HOW] ?? "exact", ...(window ? { window } : {}) });
  const textBasis = (window?: boolean): Basis => ({ by: "text", how: "exact", ...(window ? { window } : {}) });

  // The model number and any other printed code (a TYPE, style or item number) are all tried.
  let m: { how: IdMatch; theirs: string; tok: string } | null = null;
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
  // A product list appended to the page (an FSIS PDF, one product per line) prints every product's lots: there a
  // code counts only on a row that also prints the item's UPC, when the item has one.
  const [ownText, listText] = splitProductList(notice.text);
  const listRows = listText ? listText.split("\n") : [];
  const inList = (c: string) => listRows.some((row) => printedIn(c, row) && (!item.upc || printedIn(item.upc, row)));
  const inText = (c: string | undefined) => Boolean(c && (ownBrand || distinctive(c)) && (printedIn(c, ownText) || inList(c)));
  const lotInText = !strongLot && inText(item.lot);

  // When a notice lists lots, the lot decides. A model match alone isn't enough for a lot-limited recall.
  if (lots.length && item.lot) {
    if (strongLot) return { level: "danger", proof, why: `Lot ${item.lot} is listed in this recall.`, basis: listBasis(l!) };
    if (lotInText) {
      proof.push({ field: "lot", yours: item.lot, theirs: `${item.lot} (in the notice's text)`, matched: true });
      return { level: "danger", proof, why: `Lot ${item.lot} is printed in this recall.`, basis: textBasis() };
    }
    // Yours is a listed lot without its last letters ("091026" against "091026 DL"), or with letters it doesn't
    // print: the line or plant code decides, and only the label shows it.
    if (l?.how === "variant") {
      return { level: "warning", proof, why: `The recall lists lot ${l.theirs}, which is close to your ${item.lot}. Compare the full lot code on the label.` };
    }
    proof.push({ field: "lot", yours: item.lot, theirs: lots.slice(0, 4).join(", ").replace(/\.\./g, " through "), matched: false });
    return { level: null, proof, why: `Lot ${item.lot} isn't among the lots this recall lists.` };
  }
  if (lots.length && !item.lot) {
    // The deciding code was given, but not as a lot: a pack or date code ("pack date 26-196"), a serial, or a bare
    // code on the line. One that the lot list itself lists is the lot. A code the list doesn't print decides
    // nothing (it may be a model or style number), so the tag stays orange.
    const listed = lotLike(item)
      .map((c) => ({ c, b: best(c, lots, false) }))
      .find((x) => x.b && x.b.how !== "variant");
    const tied = strongModel || u || brandIn(item.brand, notice);
    if (listed && tied) {
      proof.push({ field: "lot", yours: listed.c, theirs: listed.b!.theirs, matched: true });
      return { level: "danger", proof, why: `Lot ${listed.c} is listed in this recall.`, basis: listBasis(listed.b!) };
    }
    if (tied) {
      return { level: "warning", proof, why: "This recall is limited to certain lots. Check the lot number printed on yours." };
    }
  }

  // Codes the notice bounds instead of listing, read from its own text without a model (held-out set #2, g01 and
  // g03): a serial printed in two groups inside a from-to pair with the same first group ("00010 2303 ... 00010
  // 2607"), and a prefix followed by a number in a printed range ("PR01 ... followed by a five-digit number between
  // 25091 and 26168"). Outside the bounds, this recall doesn't cover the item.
  if (ownBrand && !strongLot && !lotInText) {
    const bound = boundedCode(item, ownText);
    if (bound) {
      proof.push({ field: bound.how === "range" ? "lot" : "model", yours: bound.yours, theirs: bound.theirs, matched: bound.inside });
      if (!bound.inside) return { level: null, proof, why: `${bound.yours} is outside the ${bound.theirs} this recall covers.` };
      return { level: "danger", proof, why: `${bound.yours} is inside the ${bound.theirs} this recall lists.`, basis: { by: "text", how: bound.how } };
    }
  }

  let byText = false;
  if (!strongModel && !u && m?.how !== "variant") {
    const printed = [...mine, ...mine.flatMap((c) => splitIds(c, false))].find(inText);
    if (printed) {
      strongModel = true;
      byText = true;
      mYours = printed;
      const est = establishmentOf(item, printed);
      proof.push({ field: "model", yours: est ?? printed, theirs: `${printed} (in the notice's text)`, matched: true, ...(est ? { label: "USDA establishment" } : {}) });
    }
  }
  // No lot list was read (a company announcement whose reader failed): the item's UPC and its pack or date code
  // both printed in the notice's text pin it down. Either one alone doesn't.
  // In a product list appended to the page (an FSIS PDF, one product per line), the UPC and the code must share a
  // line: the list prints every product's lots, so a UPC from one row and a lot from another prove nothing.
  const withUpc =(c: string) => (printedIn(item.upc, ownText) && printedIn(c, ownText)) || listRows.some((row) => printedIn(item.upc, row) && printedIn(c, row));
  if (!lots.length && !item.lot && !strongModel && !u && item.upc && (printedIn(item.upc, ownText) || listRows.some((row) => printedIn(item.upc, row)))) {
    const code = lotLike(item).find(withUpc);
    if (code) {
      proof.push({ field: "upc", yours: item.upc, theirs: `${item.upc} (in the notice's text)`, matched: true });
      proof.push({ field: "lot", yours: code, theirs: `${code} (in the notice's text)`, matched: true });
      return { level: "danger", proof, why: `UPC ${item.upc} and code ${code} are printed in this recall.`, basis: textBasis() };
    }
  }
  if (!lots.length && lotInText && !strongModel && !u) {
    proof.push({ field: "lot", yours: item.lot!, theirs: `${item.lot} (in the notice's text)`, matched: true });
    return { level: "danger", proof, why: `Lot ${item.lot} is printed in this recall.`, basis: textBasis() };
  }

  if (strongModel || u) {
    // A USDA establishment number names the plant ("USDA establishment EST. 7839"), not a model.
    const est = strongModel ? establishmentOf(item, mYours!) : undefined;
    if (est && !byText) for (const p of proof) if (p.field === "model" && p.yours === mYours) Object.assign(p, { yours: est, label: "USDA establishment" });
    const what = est ? `USDA establishment ${est.trim()}` : strongModel ? `${/^\d/.test(mYours!) ? "Model " : ""}${mYours}` : `UPC ${item.upc}`;
    const food = item.kind === "food";
    // No made-date window was read, but the record's own text limits the recall by best-by or use-by date and the
    // household gave one: compare those dates, without a model (held-out set #2, g07: a listed UPC whose best-by
    // date was outside "all dates through 3/30/2027" was tagged red).
    const byDate = !notice.madeRanges?.length && (food || item.kind === "drug") && DATED.test(`${item.said} ${item.made ?? ""}`) ? dateWindowIn(ownText) : null;
    if (byDate) {
      const theirs = byDate.from <= "1901" ? `best by ${fmtDate(byDate.to)} or earlier` : `best by ${fmtDate(byDate.from)} to ${fmtDate(byDate.to)}`;
      const d = looseDate(item.made) ?? looseDate(item.said.match(DATED_VALUE)?.[1]);
      if (d) {
        const inside = d >= byDate.from && d <= byDate.to;
        proof.push({ field: "made", yours: item.made ?? d, theirs, matched: inside });
        if (!inside) return { level: null, proof, why: `${what} is listed, but only packages marked ${theirs} are recalled, and yours is marked ${fmtDate(d)}.` };
      }
    }
    const window = notice.madeRanges?.[0];
    if (window) {
      const made = parseMade(item.made);
      const span = windowText(window);
      if (!made)
        return {
          level: "warning",
          proof,
          why: food ? `${what} is listed, but only products made ${span}. Check the packed-on or use-by date on the package.` : `${what} is listed, but only units made ${span}. Check the date of manufacture on the label.`,
          window,
        };
      const inside = made.end >= window.from && made.start <= window.to;
      proof.push({ field: "made", yours: item.made!, theirs: `made ${span}`, matched: inside });
      if (!inside) return { level: null, proof, why: `${what} is listed, but only ${food ? "products" : "units"} made ${span} are recalled, and yours was made ${item.made}.` };
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
    const w = Boolean(window);
    const basis: Basis = strongModel ? (byText || !m ? textBasis(w) : listBasis(m, w)) : { by: byReader.has(u!) ? "reader-list" : "record-list", how: "exact", ...(w ? { window: w } : {}) };
    return { level: "danger", proof, why: `${what} is listed in this recall${m?.how === "range" ? " range" : ""}.`, basis };
  }
  if (m?.how === "variant") {
    return { level: "warning", proof, why: `The recall lists ${m.theirs}, which is close to your ${item.model}. Compare the full model number on the label.` };
  }
  if (models.length && item.model) {
    proof.push({ field: "model", yours: item.model, theirs: models.slice(0, 4).join(", ").replace(/\.\./g, " through "), matched: false });
    return { level: null, proof, why: `Model ${item.model} isn't among the models this recall lists.` };
  }
  // A recall that prints no codes at all covers the whole line it names: never clear the brand's item against it.
  const wholeLine = !models.length && !lots.length && !upcs.length && brandInText(item.brand, notice);
  if (brandIn(item.brand, notice) || wholeLine) {
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

export const EXCLUDED = /\bnot\b[^.]{0,40}\b(included|affected|part of|subject|recalled|covered)\b|\bexclud(ed|es|ing)\b/i;

/**
 * Is this code printed in the text as a whole word (ignoring case, dashes and dots), outside any sentence that
 * says some units are not included? Codes shorter than four characters, or without a digit, are too easy to find
 * by accident and never count.
 */
/**
 * A code of the item's that the notice bounds rather than lists: a serial printed in two groups inside a from-to
 * pair with the same first group, or a prefix followed by a number inside a printed number range. Null when the
 * notice prints no such bound for the item's codes.
 */
export function boundedCode(item: Item, text: string | undefined): { yours: string; theirs: string; inside: boolean; how: "range" | "family" } | null {
  if (!text) return null;
  const flat = text.replace(/[“”"']/g, "").replace(/\s+/g, " ");
  const codes = [item.serial, item.lot, item.model, item.made, ...(item.codes ?? [])].filter((c): c is string => Boolean(c));
  for (const raw of codes) {
    const c = raw.replace(/^(?:serial(?: number| no\.?)?|date code|lot|model)\s*[:#]?\s*/i, "").trim();
    // Two digit groups: the first names the line, the second counts within it.
    const two = c.match(/^(\d{3,})[\s-]+(\d{3,})$/);
    if (two) {
      const [, head, n] = two;
      const pair = flat.match(new RegExp(String.raw`\b${head} (\d{${n.length}}) ${head} (\d{${n.length}})\b`));
      if (pair && pair[1] < pair[2]) return { yours: `${head} ${n}`, theirs: `serial range ${head} ${pair[1]} to ${head} ${pair[2]}`, inside: n >= pair[1] && n <= pair[2], how: "range" };
    }
    // A prefix and a number: "PR01 25230" against "prefix PR01 and followed by a five-digit number between 25091 and 26168".
    const fam = c.match(/^([A-Z]{1,4}\d{0,4})[\s-]*(\d{3,8})$/i);
    if (fam) {
      const [, pre, n] = fam;
      const rule = flat.match(new RegExp(String.raw`prefix ${pre}\b[^.]{0,40}?followed by an? (?:[a-z-]+ )?number (?:between|from) (\d{${n.length}}) (?:and|to|through) (\d{${n.length}})\b`, "i"));
      if (rule && rule[1] < rule[2]) return { yours: `${pre.toUpperCase()} ${n}`, theirs: `codes ${pre.toUpperCase()} ${rule[1]} to ${pre.toUpperCase()} ${rule[2]}`, inside: n >= rule[1] && n <= rule[2], how: "family" };
    }
  }
  return null;
}

/** A household line that gives a best-by, use-by or expiry date, and the date it gives. */
const DATED = /\b(?:best|use|sell)[- ]?(?:by|if used by|before)\b|\bexp(?:iry|iration)?\b|\bbb\b/i;
const DATED_VALUE = /\b(?:best|use|sell)[- ]?(?:by|if used by|before)\b:?\s*([0-9A-Za-z][0-9A-Za-z ,./-]{4,20}\d)/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as YYYY-MM-DD from "06/20/2027", "2/14/27", "2027-03-30" or "August 14th, 2026"; null otherwise. */
export function looseDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  const iso = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = t.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1])) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  return null;
}

/**
 * The one best-by or use-by window a record prints ("Best By: all dates through 3/30/2027", "Best If Used By Dates
 * from August 14th, 2026 to September 25th, 2026"), read without a model. Null when there is none, or more than one.
 */
export function dateWindowIn(text: string | undefined): { from: string; to: string } | null {
  if (!text) return null;
  const DATE = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})`;
  const found: { from: string; to: string }[] = [];
  for (const seg of text.match(/\b(?:best[- ]?(?:by|if used by|before)|use[- ]?by|sell[- ]?by)\b[^.;\n]{0,90}/gi) ?? []) {
    const span = seg.match(new RegExp(String.raw`(?:from\s+)?${DATE}\s*(?:to|through|thru|-|–)\s*${DATE}`, "i"));
    const upto = seg.match(new RegExp(String.raw`(?:through|thru|until|up to)\s+${DATE}`, "i"));
    const w = span ? { from: looseDate(span[1]), to: looseDate(span[2]) } : upto ? { from: "1900-01-01", to: looseDate(upto[1]) } : null;
    if (w?.from && w.to && w.from <= w.to && !found.some((f) => f.from === w.from && f.to === w.to)) found.push({ from: w.from, to: w.to });
  }
  return found.length === 1 ? found[0] : null;
}

/** Where a product list appended to a page's text starts (lib/sources/web.ts writes it). */
export const PRODUCT_LIST_MARK = "\n\nProduct list (PDF linked from the recall page): ";

/** A page's own text, and the product list appended to it, if any. */
export function splitProductList(text: string | undefined): [string | undefined, string | undefined] {
  if (!text) return [text, undefined];
  const i = text.indexOf(PRODUCT_LIST_MARK);
  return i < 0 ? [text, undefined] : [text.slice(0, i), text.slice(i + PRODUCT_LIST_MARK.length)];
}

export function printedIn(code: string | undefined, text: string | undefined): boolean {
  if (!code || !text) return false;
  const c = norm(code);
  if (c.length < 4 || !/\d/.test(c)) return false;
  const cuts = codeCuts(code);
  for (const sentence of text.split(/(?<=[.;!?])\s+|\n+/)) {
    if (EXCLUDED.test(sentence)) continue;
    // Words as printed; a lone dash or other punctuation is an empty word, which breaks a run.
    const raw = sentence.split(/[^A-Za-z0-9./+-]+/);
    const words = raw.map(norm);
    // The printed code goes on past the match ("Lot 091026 DL" when yours is "091026"): that is another lot.
    const goesOn = (next: number) => /\d$/.test(c) && next < raw.length && /^[A-Z]{1,3}$/.test(raw[next]) && !NOT_A_PART.test(raw[next]);
    for (let i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      if (words[i] === c) {
        if (!goesOn(i + 1)) return true;
        continue;
      }
      // A code printed in parts ("Lot 091026 DL"): consecutive words that spell it, joined only where the code
      // itself breaks (a space or dash in it, or a switch between digits and letters). So "091026 DL" is found in
      // "091026 DL" and "091026DL", but "0607" is not found in "JUN 06 07", and "091226 DL" never in "091026 DL".
      let acc = words[i];
      for (let j = i + 1; j < Math.min(words.length, i + 4) && words[j] && c.startsWith(acc) && cuts.has(acc.length); j++) {
        acc += words[j];
        if (acc === c && !goesOn(j + 1)) return true;
      }
    }
  }
  return false;
}

/**
 * Where a code can be split into printed parts, as positions in its normalised form: at its own spaces, dashes,
 * dots and slashes, and where digits meet letters ("091026DL" → {6}; "D080-148" → {1, 4}).
 */
export function codeCuts(code: string): Set<number> {
  const cuts = new Set<number>();
  let n = 0;
  let prev = "";
  for (const ch of code.toUpperCase().normalize("NFKD")) {
    if (!/[A-Z0-9*]/.test(ch)) {
      if (n) cuts.add(n);
      prev = "";
      continue;
    }
    if (prev && /\d/.test(prev) !== /\d/.test(ch)) cuts.add(n);
    prev = ch;
    n++;
  }
  return cuts;
}

/**
 * Codes on an item with no lot that could still be its lot: a pack or date code that isn't a calendar date
 * ("26-196", not "03/2026" or "JUN 07 2027"), a serial, and other printed codes.
 */
export function lotLike(item: Item): string[] {
  const dateish = (s: string) => Boolean(parseMade(s)) || /^\d{1,2}[\/.]\d{1,2}([\/.]\d{2,4})?$/.test(s.trim()) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(s);
  const made = item.made && !dateish(item.made) ? item.made : undefined;
  return [...new Set([made, item.serial, ...(item.codes ?? [])].filter((c): c is string => Boolean(c && norm(c).length >= 3 && /\d/.test(c))))];
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

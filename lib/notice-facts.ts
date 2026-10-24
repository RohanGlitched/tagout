/**
 * The hazard, the remedy and the consumer contact of a recall found on the web (an FDA company announcement, a
 * USDA FSIS release), taken from the notice's own sentences, and the allergen of an undeclared-allergen recall.
 * CPSC and openFDA records carry these as fields; a web page doesn't, so its tag used to say only "follow the
 * recall's remedy". Nothing here calls a model: each field is a sentence or clause copied from the notice, and
 * every field is checked against the notice's text before it is kept, so none can be invented. (The notice
 * reader's request is left unchanged on purpose: changing it would re-read every notice in the eval cache.)
 */

export type NoticeFacts = { hazard?: string; remedy?: string; contact?: string; allergen?: string };

/** Where a press release's own text starts (its dateline or announcement header); the page menus come before. */
const BODY_START = /\b(?:FSIS Announcement|Company Announcement Date|Company Announcement|FOR IMMEDIATE RELEASE|[A-Z]{4,}(?:,\s[A-Z][A-Za-z.]+)?,\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-zA-Z]*\.?\s\d{1,2},\s\d{4})/;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Is this piece printed in the text (ignoring spacing and case)? Every field passes this before it is kept. */
export function verifiedIn(piece: string | undefined, text: string): boolean {
  if (!piece) return false;
  const hay = squash(text).toLowerCase();
  // A field may join two of the notice's sentences, or end in "…" where it was cut; each part must be printed.
  return piece
    .replace(/…$/, "")
    .split(/(?<=[.!?])\s+/)
    .every((p) => {
      const q = squash(p).toLowerCase().replace(/\.$/, "");
      return q.length > 0 && hay.includes(q);
    });
}

/** Sentences of the notice's body, with "U.S." and similar kept whole. */
function sentences(text: string): string[] {
  const m = BODY_START.exec(text);
  const body = m ? text.slice(m.index) : text;
  const safe = body.replace(/\b(U\.S|Mass|Inc|Co|Corp|Ltd|St|No|Dr|Mr|Ms|Jr|approx)\./g, "$1§");
  return safe
    // A sentence end, or one glued to the next by the page's markup ("refrigerators.Consumers").
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])|(?<=[a-z]{2}\.)(?=[A-Z][a-z])|\n+/)
    .map((s) => squash(s.replace(/§/g, ".")))
    .filter((s) => s.length > 15);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const t = s.slice(0, max);
  return `${t.slice(0, t.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
}

const HAZARD_WORDS = /contaminat|undeclared|allerg|may (?:have|contain|be)|potential|possible|risk|temperature|foreign|pieces? of|fragments?|choking|burn|fire|injur|fall|lacerat|electric|shock|overheat|\blead\b|mold|spoil|under-?process|not (?:properly|fully)|bacteria|toxin/i;

function hazardOf(ss: string[], title: string, allergen?: string): string | undefined {
  for (const s of ss) {
    const m = s.match(/\b(?:because|due to)\s+(.+)$/i);
    if (!m || !HAZARD_WORDS.test(m[1])) continue;
    let clause = m[1].replace(/,\s+(?:the\s+)?(?:U\.S\.|USDA|FSIS|FDA|Food and Drug)[^,]*\b(?:announced|said|reported)\b.*$/i, "").replace(/[.,;:\s]+$/, "");
    if (!clause) continue;
    clause = cap(clause);
    if (allergen) {
      const risk = ss.find((x) => /\ballerg|sensitivity\b/i.test(x) && /\brisk|reaction\b/i.test(x));
      return cut(risk ? `${clause}. ${risk}` : `${clause}.`, 320);
    }
    return cut(`${clause}.`, 260);
  }
  const t = title.match(/\bDue to\s+(.+)$/i);
  return t ? `${cap(t[1].replace(/[.\s]+$/, ""))}.` : undefined;
}

const REMEDY = /\b(?:return(?:ed)?|discard(?:ed)?|thrown? away|destroy|dispose|do not (?:eat|consume|use)|not to consume|urged not|stop using|refund)\b/i;
const WHO = /\b(?:consumers?|customers?|you|these products|this product|should|urged|advised)\b/i;

function remedyOf(ss: string[]): string | undefined {
  const i = ss.findIndex((s) => REMEDY.test(s) && WHO.test(s) && !/\b(?:routinely|effectiveness|media|initiated after)\b/i.test(s));
  if (i < 0) return undefined;
  let r = ss[i];
  // "Consumers ... are urged not to consume them." is followed by where they go: "should be thrown away or returned".
  if (!/\b(?:return|discard|thrown? away|refund|destroy|dispose)/i.test(r) && ss[i + 1] && /\b(?:return|discard|thrown? away|refund|destroy|dispose)/i.test(ss[i + 1])) r = `${r} ${ss[i + 1]}`;
  return cut(r, 320);
}

const PHONE = /\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b1[-.\s]?\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b1-8\d\d-[A-Z]{4,}/;

function contactOf(ss: string[]): string | undefined {
  const s = ss.find((x) => PHONE.test(x) && /\b(?:consumers?|customers?|questions)\b/i.test(x) && !/\bmedia\b/i.test(x) && !/Meat and Poultry Hotline/i.test(x));
  return s ? cut(s, 240) : undefined;
}

/* ───────────────────────── Allergens ───────────────────────── */

const ALLERGEN_WORDS: [RegExp, string][] = [
  [/\bmilk\b|\bdairy\b/i, "milk"],
  [/\beggs?\b/i, "eggs"],
  [/\bpeanuts?\b/i, "peanuts"],
  [/\btree nuts?\b/i, "tree nuts"],
  [/\balmonds?\b/i, "almonds"],
  [/\bcashews?\b/i, "cashews"],
  [/\bwalnuts?\b/i, "walnuts"],
  [/\bpecans?\b/i, "pecans"],
  [/\bhazelnuts?\b/i, "hazelnuts"],
  [/\bpistachios?\b/i, "pistachios"],
  [/\bmacadamia\b/i, "macadamia nuts"],
  [/\bcoconut\b/i, "coconut"],
  [/\bsoy(?:beans?|a)?\b/i, "soy"],
  [/\bwheat\b/i, "wheat"],
  [/\bgluten\b/i, "gluten"],
  [/\bsesame\b/i, "sesame"],
  [/\bshellfish\b|\bshrimp\b|\bcrab\b|\blobster\b/i, "shellfish"],
  [/\bfish\b|\banchov(?:y|ies)\b/i, "fish"],
  [/\bsul(?:f|ph)ites?\b/i, "sulfites"],
];

/** Hazards other than an allergen: when a notice names one, the tag stays a plain "Do not use" for everyone. */
const OTHER_HAZARD = /listeria|salmonella|e\.?\s?coli|\bstec\b|botulin|clostridium|cronobacter|hepatitis|norovirus|cyclospora|foreign (?:material|matter|objects?)|(?:pieces?|fragments?|shards?) of (?:metal|glass|plastic|rubber|wood|bone)|extraneous|\blead\b|arsenic|cadmium|mou?ld\b|temperature abuse|under-?process|undercooked|not (?:properly|fully) cooked|choking|spoil/i;

/** The allergens a text calls undeclared ("undeclared milk and soy", "Allergy Alert on Undeclared Sesame"). */
export function undeclaredAllergens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:undeclared allergens?:?|undeclared|not declared)\s+([A-Za-z ,&\-/()]{2,80})/gi)) {
    const span = m[1].split(/[.;:\n]|\b(?:in|which|that|on the|because|due|when|was|were|is|are|from)\b/i)[0];
    for (const [re, name] of ALLERGEN_WORDS) if (re.test(span)) out.add(name);
  }
  // "contains milk, an allergen not declared on the label"
  for (const m of text.matchAll(/\bcontains?\s+([A-Za-z ,&\-]{2,60}?),?\s+(?:an?\s+)?allergens?\s+(?:that (?:is|are|was|were) )?not (?:declared|listed)/gi)) {
    for (const [re, name] of ALLERGEN_WORDS) if (re.test(m[1])) out.add(name);
  }
  if (out.has("fish") && out.has("shellfish") && !/\bfish\b/i.test(text.replace(/shellfish/gi, ""))) out.delete("fish");
  return [...out];
}

const NUTS = new Set(["almonds", "cashews", "walnuts", "pecans", "hazelnuts", "pistachios", "macadamia nuts", "coconut"]);

const joinWords =(xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The allergen of an undeclared-allergen recall, when that is the only hazard named: "sesame", "milk and soy".
 * `reason` is where the notice states why it recalls (openFDA's reason_for_recall, or a web notice's title and
 * hazard sentence); it must name the allergen as undeclared and nothing else (no Listeria, no foreign matter).
 */
export function allergenOnly(reason: string): string | undefined {
  let found = undeclaredAllergens(reason);
  if (!found.length || OTHER_HAZARD.test(reason)) return undefined;
  // "tree nuts (almonds)": the named nut goes in brackets after the class.
  const nuts = found.filter((a) => NUTS.has(a));
  if (found.includes("tree nuts") && nuts.length) found = found.filter((a) => !NUTS.has(a)).map((a) => (a === "tree nuts" ? `tree nuts (${nuts.join(", ")})` : a));
  return joinWords(found);
}

/** Hazard, remedy, contact and allergen from a web notice's own text. Every field is printed in `text`. */
export function noticeFacts(text: string, title: string): NoticeFacts {
  const ss = sentences(text);
  const reasonish = `${title}\n${ss.find((s) => /\b(?:because|due to)\b/i.test(s) && HAZARD_WORDS.test(s)) ?? ""}`;
  const allergen = allergenOnly(reasonish);
  const facts: NoticeFacts = { hazard: hazardOf(ss, title, allergen), remedy: remedyOf(ss), contact: contactOf(ss), allergen };
  const out: NoticeFacts = {};
  const hay = `${title}\n${text}`;
  for (const k of ["hazard", "remedy", "contact"] as const) if (facts[k] && verifiedIn(facts[k], hay)) out[k] = facts[k];
  // The allergen's name must itself be printed (as "soy", "soybean"...: each word of the name, singular or plural).
  if (
    allergen &&
    allergen
      .replace(/[()]/g, "")
      .split(/,\s*|\s+and\s+|\s+/)
      .filter((w) => w.length > 2 && w !== "tree")
      .every((w) => new RegExp(`\\b${w.replace(/s$/, "")}`, "i").test(hay))
  )
    out.allergen = allergen;
  return out;
}

/** "return them to their nearest WinCo Foods location for a refund": the action part of a remedy, for a tag. */
export function remedyAction(remedy: string | undefined): string | undefined {
  const m = remedy?.match(/\b((?:immediately\s+)?(?:discard|return|throw (?:it|them) away|bring)\b[^.;]*)/i) ?? remedy?.match(/\b(thrown away or returned\b[^.;]*)/i);
  return m ? m[1].replace(/\s*\([^)]*\)\s*$/, "").replace(/[,\s]+$/, "") : undefined;
}

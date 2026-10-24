import { codeCuts, EXCLUDED, looksLikeCode, norm } from "../match";

/**
 * The guard against invented codes: every model number, lot and UPC the notice reader returns must be printed in
 * the notice's own text, or it is struck and never reaches the matcher.
 *
 * "Printed" means as whole words. The text is cut into words at spaces and punctuation (and a label glued to its
 * number, "LOT123456", is cut after the label); a code is printed when a run of consecutive words spells it,
 * starting and ending at word edges. Words join where the text puts at most one space, dash, dot or slash between
 * them (so a reader that drops the spaces of "UPC 4 0564897 22458" still passes), or where the code itself breaks
 * at that point (a space or punctuation in it, or digits meeting letters); a sentence end joins only when the code
 * prints the same punctuation ("28 oz. Gatorade"). A substring that starts or ends inside a word, like "SS1MODEL"
 * out of "NS-RGFGSS1. Model", or "RGFG" out of "RGFGSS1", is not printed.
 *
 * A code printed only in sentences that say some units are not included ("Model NS-RGFGSS3 is not included in
 * this recall") is struck too: the same test the matcher's text fallback applies (lib/match.ts printedIn).
 * "A through B" ranges need both ends printed.
 */

export type ReaderCodes = { models: string[]; lots: string[]; upcs: string[] };
export type Verified = ReaderCodes & { struck: string[]; excluded: string[] };

const LABEL = /^(LOT|LOTS|BATCH|UPC|NDC|SKU|MODEL|MOD|NO|EXP|BB|SN|SERIAL|ITEM|STYLE|TYPE|CODE|REF|CAT)(?=\d)/i;

type Word = { w: string; sep: string; sentence: number };
export type Printed = { words: Word[]; excludes: boolean[]; flat: string };

/** The text as words (normalised), each with the characters printed before it and its sentence; and which
 *  sentences say some units are not included. Sentences are cut as lib/match.ts printedIn cuts them. */
export function wordsOf(text: string): Printed {
  const words: Word[] = [];
  const excludes: boolean[] = [];
  // Accents and symbols as the normaliser sees them ("bébé" is "bebe", "LEADER™" is "LEADERTM").
  const parts = text.normalize("NFKD").replace(/\p{M}/gu, "").split(/((?<=[.;!?])\s+|\n+)/);
  let sentence = -1;
  let pendingSep = "";
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    if (k % 2 === 1) {
      pendingSep += part;
      continue;
    }
    if (!part.trim()) {
      pendingSep += part;
      continue;
    }
    sentence++;
    excludes.push(EXCLUDED.test(part));
    const re = /[A-Za-z0-9]+/g;
    let last = 0;
    for (let m = re.exec(part); m; m = re.exec(part)) {
      const sep = pendingSep + part.slice(last, m.index);
      pendingSep = "";
      last = m.index + m[0].length;
      const raw = m[0];
      const label = raw.match(LABEL);
      if (label) {
        words.push({ w: norm(label[1]), sep, sentence });
        words.push({ w: norm(raw.slice(label[1].length)), sep: "", sentence });
      } else if (norm(raw)) words.push({ w: norm(raw), sep, sentence });
    }
    pendingSep = part.slice(last);
  }
  return { words, excludes, flat: norm(text) };
}

const tight = (sep: string) => sep === "" || /^[ \-./]$/.test(sep);

/** Where a code is printed: "yes", only in "not included" sentences ("excluded"), or not at all ("no"). */
export function printedAsWords(code: string, p: Printed): "yes" | "excluded" | "no" {
  // A "*" is a wildcard the reader copied ("5160*"): the rest is matched as words, and the "*" as printed.
  const c = norm(code).replace(/\*/g, "");
  if (!c || (code.includes("*") && !p.flat.includes(norm(code)))) return "no";
  const cuts = codeCuts(code.replace(/\*/g, " "));
  const ownPunct = new Set(code.replace(/[A-Za-z0-9\s]/g, ""));
  // A product name rather than a code (no digit) may be printed in the plural ("Teddy Bear" in "Teddy Bears").
  const prose = !/\d/.test(c);
  const plural = (w: string, rest: string) => prose && rest.length >= 2 && (w === `${rest}S` || w === `${rest}ES`);
  const ws = p.words;
  let excluded = false;
  for (let i = 0; i < ws.length; i++) {
    let j = i;
    let acc: string;
    if (c.startsWith(ws[i].w)) acc = ws[i].w;
    else if (plural(ws[i].w, c)) acc = c;
    else continue;
    while (acc !== c && j + 1 < ws.length) {
      const next = ws[j + 1];
      const sentenceEnd = /[.;!?]\s/.test(next.sep) || /\n/.test(next.sep);
      const joins = tight(next.sep) || (cuts.has(acc.length) && (!sentenceEnd || [...next.sep.replace(/\s/g, "")].every((ch) => ownPunct.has(ch))));
      if (!joins) break;
      if (c.startsWith(acc + next.w)) acc += next.w;
      else if (plural(next.w, c.slice(acc.length))) acc = c;
      else break;
      j++;
    }
    if (acc !== c) continue;
    // Outside any "not included" sentence it is printed; inside one, keep looking for another place.
    let ex = false;
    for (let k = ws[i].sentence; k <= ws[j].sentence; k++) if (p.excludes[k]) ex = true;
    if (!ex) return "yes";
    excluded = true;
  }
  return excluded ? "excluded" : "no";
}

/** Keeps the reader's codes that the notice prints as whole words outside any "not included" sentence. */
export function verifyCodes(read: ReaderCodes, text: string): Verified {
  const printed = wordsOf(text);
  const struck: string[] = [];
  const excluded: string[] = [];
  const keep = (codes: string[]) =>
    codes.filter((c) => {
      // "A through B": both ends must be printed.
      const ends = c.split(/\s+(?:through|thru|to)\s+|\s*[–—]\s*/i);
      const where = ends.map((e) => (norm(e).length >= 2 ? printedAsWords(e, printed) : "no"));
      const ok = where.every((w) => w === "yes");
      if (!ok && looksLikeCode(c)) {
        // Junk (paths, prose) is dropped without a mention.
        struck.push(c);
        if (where.every((w) => w !== "no")) excluded.push(c);
      }
      return ok;
    });
  return { models: keep(read.models), lots: keep(read.lots), upcs: keep(read.upcs), struck, excluded };
}

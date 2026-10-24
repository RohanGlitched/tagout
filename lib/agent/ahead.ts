import "server-only";
import type { Item, Notice } from "../types";
import { fdaHasRecall, type FdaKind } from "../sources/fda";

/**
 * "Ahead of the database", decided per recall. An FDA company announcement that Tavily found on fda.gov is marked
 * ahead of openFDA only when openFDA has no enforcement report for that recall: none printing its lot or UPC (or
 * the item's), and none from the firm about the same product or dated within a week of the announcement. A firm's
 * older reports about other products (Lidl's September cookies, WinCo's salsa bean dip) no longer hide the badge.
 */
const FDA_PAGE = /fda\.gov\/safety\/recalls-market-withdrawals-safety-alerts\/[^/?#]+/i;

/** "Lidl US Recalls Gelatelli …" → "Lidl US"; "WinCo Foods LLC Issues Allergy Alert …" → "WinCo Foods LLC". */
export const firmOfTitle = (title: string) => {
  const firm = title.split(/\s+(?:Recalls|Issues|Announces|Expands|Is Recalling|Voluntarily)\b/i)[0].trim();
  return firm && firm !== title && firm.length >= 3 ? firm : undefined;
};

const NOT_NOUNS = new Set(["recall", "recalls", "recalled", "product", "products", "allergy", "alert", "undeclared", "possible", "potential", "health", "risk", "because", "contamination", "contaminated", "issues", "announces", "voluntary", "voluntarily", "nationwide", "select", "certain", "various", "brand", "with", "from", "sauce", "pieces", "milk", "eggs", "peanut", "peanuts", "sesame", "soy", "wheat", "fish", "shellfish", "almond", "almonds", "cashew", "cashews", "walnut", "walnuts", "pecan", "pecans", "hazelnut", "hazelnuts", "pistachio", "pistachios", "coconut", "sulfites", "listeria", "salmonella", "monocytogenes"]);

/** The product words of an announcement's title: what follows the firm and verb, before "Due to" / "Because". */
export function titleNouns(title: string, firm?: string): string[] {
  const after = firm ? title.slice(title.indexOf(firm) + firm.length) : title;
  const what = after.split(/\b(?:due to|because|after|for possible|over)\b/i)[0];
  const firmWords = new Set((firm ?? "").toLowerCase().split(/[^a-z]+/));
  return [
    ...new Set(
      what
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 4 && !NOT_NOUNS.has(w) && !firmWords.has(w)),
    ),
  ];
}

const KINDS: Partial<Record<Item["kind"], FdaKind>> = { food: "food", drug: "drug", device: "device" };

/** The notices with each FDA company announcement checked against openFDA for this recall. */
export async function markAhead(notices: Notice[], item: Item, checkedAt: string): Promise<Notice[]> {
  return Promise.all(
    notices.map(async (n) => {
      if (n.source !== "web" || n.notInDb || !FDA_PAGE.test(n.url)) return n;
      const firm = firmOfTitle(n.title);
      if (!firm) return n;
      const kind = KINDS[item.kind];
      const r = await fdaHasRecall({
        firm,
        noticeDate: /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : undefined,
        lots: [...new Set([...n.lots, ...(item.lot ? [item.lot] : [])])],
        upcs: [...new Set([...n.upcs, ...(item.upc ? [item.upc] : [])])],
        nouns: titleNouns(n.title, firm),
        kinds: kind ? [kind] : undefined,
        today: checkedAt.slice(0, 10),
      }).catch(() => null);
      return r?.has === false ? { ...n, notInDb: "fda" as const, dbCheck: { on: r.on, searched: r.searched } } : n;
    }),
  );
}

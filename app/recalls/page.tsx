import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import RecallGrid, { type Card } from "@/components/recalls/RecallGrid";
import { latestRecalls } from "@/lib/latest";
import { hazardOf } from "@/lib/wall";
import type { Notice } from "@/lib/types";
import s from "./recalls.module.css";

export const revalidate = 3600;
export const metadata = {
  title: "Recalls today",
  description: "The newest U.S. product, medicine, food and medical device recalls from CPSC and the FDA, updated hourly.",
};

/** What someone would type to check whether they own it: the product part of the recall title. */
function ownQuery(n: Notice): string {
  if (n.source === "fda") return n.title.split(/,\s*/).slice(0, 2).join(", ");
  // "Vornado Air Recalls SRTH Small Room Tower Heaters Due to Fire Hazard" → "Vornado Air SRTH Small Room Tower Heaters"
  const t = n.title
    .replace(/;.*$/, "")
    .replace(/\s+(?:are\s+)?(?:recalled\s+)?(?:due to|because).*$/i, "")
    .replace(/\s+recalled$/i, "")
    .replace(/\s+recalls\s+/i, " ")
    .trim();
  return t.length > 3 ? t : n.title;
}

export default async function Recalls() {
  const data = await latestRecalls().catch(() => null);
  const notices = data?.notices ?? [];
  // The FDA often files one recall per strength or pack size; keep one per firm and product.
  const seen = new Set<string>();
  const distinct = notices.filter((n) => {
    const k = `${n.source}|${n.firm ?? ""}|${n.title.split(/,|\s\d/)[0].toLowerCase()}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const cards: Card[] = [...distinct.filter((n) => n.source === "cpsc").slice(0, 36), ...distinct.filter((n) => n.source === "fda").slice(0, 24)]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map((n) => ({ ...n, text: undefined, hz: hazardOf(n), own: ownQuery(n) }));

  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>Recalls today</h1>
          <p className={s.sub}>
            The newest recalls from the Consumer Product Safety Commission and the FDA, refreshed every hour. If you might own one, check it: Tagout compares your model or lot number
            with the recall&apos;s list.
          </p>
          {data?.failed.length ? <p className={s.warn}>{data.failed.join(" and ")} didn&apos;t answer this hour; those recalls are missing below.</p> : null}
        </header>
        {cards.length ? (
          <RecallGrid cards={cards} />
        ) : (
          <p className={s.empty}>The agencies didn&apos;t answer just now. Try again in a few minutes, or search recalls.gov.</p>
        )}
        <p className={s.note}>
          Vehicle and car seat recalls are filed by make, model and year, so they aren&apos;t listed here. Check yours from the <Link href="/#check">home page</Link>.
        </p>
      </main>
      <Footer />
    </>
  );
}

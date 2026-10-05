import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import { latestRecalls } from "@/lib/latest";
import { AGENCY, AGENCY_LONG, fmtDate } from "@/lib/format";
import type { Notice } from "@/lib/types";
import s from "./recalls.module.css";

export const revalidate = 3600;
export const metadata = {
  title: "Recalls today",
  description: "The newest U.S. product, drug, food and medical device recalls from CPSC and the FDA, updated hourly.",
};

/** What someone would type to check whether they own it: the product part of the recall title. */
function ownQuery(n: Notice): string {
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
  const groups: { key: Notice["source"]; list: Notice[] }[] = [
    { key: "cpsc", list: notices.filter((n) => n.source === "cpsc").slice(0, 40) },
    { key: "fda", list: notices.filter((n) => n.source === "fda").slice(0, 30) },
  ];

  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>Recalls today</h1>
          <p className={s.sub}>
            The newest recalls from the Consumer Product Safety Commission and the FDA, refreshed every hour. If you might own one, check it: Tagout will compare your model or lot
            number with the recall&apos;s list.
          </p>
          {data?.failed.length ? <p className={s.warn}>{data.failed.join(" and ")} didn&apos;t answer this hour; those recalls are missing below.</p> : null}
        </header>

        {notices.length === 0 ? (
          <p className={s.empty}>The agencies didn&apos;t answer just now. Try again in a few minutes, or search recalls.gov.</p>
        ) : (
          groups.map((g) =>
            g.list.length ? (
              <section key={g.key} className={s.group} aria-labelledby={`g-${g.key}`}>
                <h2 id={`g-${g.key}`} className={s.h2}>
                  {AGENCY_LONG[g.key]}
                </h2>
                <ul className={s.list}>
                  {g.list.map((n) => (
                    <li key={`${n.source}${n.id}${n.url}`} className={s.row}>
                      <div className={s.when}>
                        <span className={s.agency}>{AGENCY[n.source]}</span>
                        <span>{fmtDate(n.date)}</span>
                      </div>
                      <div className={s.body}>
                        <a href={n.url} target="_blank" rel="noreferrer" className={s.title}>
                          {n.title}
                        </a>
                        {n.hazard ? <p className={s.hazard}>{n.hazard.length > 220 ? `${n.hazard.slice(0, 218).trimEnd()}…` : n.hazard}</p> : null}
                      </div>
                      <Link className={s.own} href={`/?own=${encodeURIComponent(ownQuery(n))}#check`}>
                        I might own this
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )
        )}
        <p className={s.note}>
          Vehicle and car seat recalls are filed by make, model and year, so they aren&apos;t listed here; check yours from the <Link href="/#check">home page</Link>.
        </p>
      </main>
      <Footer />
    </>
  );
}

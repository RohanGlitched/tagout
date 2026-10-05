import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import CheckForm from "@/components/check/CheckForm";
import Board, { type BoardEntry } from "@/components/home/Board";
import Tag from "@/components/tag/Tag";
import { latestRecalls } from "@/lib/latest";
import { showcase } from "@/lib/showcase";
import { AGENCY, fmtDate, noticeRef, plural } from "@/lib/format";
import type { Proof } from "@/lib/types";
import s from "./home.module.css";

export const revalidate = 600;

const EXAMPLES = [
  { label: "A space heater", text: "Vornado heater, TYPE SRTH on the label" },
  { label: "A medicine", text: "Tylenol Extra Strength caplets, lot EJA022" },
  { label: "A car", text: "2019 Honda CR-V" },
  { label: "A car seat", text: "Evenflo car seat" },
];

export default async function Home() {
  const [demo, latest] = await Promise.all([showcase().catch(() => null), latestRecalls().catch(() => null)]);

  const entries: BoardEntry[] = [];
  if (demo?.items && demo.verdicts) {
    const order = { danger: 0, warning: 1, inspected: 2 } as const;
    const pairs = demo.items
      .map((item) => ({ item, v: demo.verdicts!.find((v) => v.itemId === item.id) }))
      .filter((p) => p.v)
      .sort((a, b) => order[a.v!.level] - order[b.v!.level]);
    // One of each tag when the check has them, red first; otherwise fill with more reds.
    const byLevel = (l: "danger" | "warning" | "inspected") => pairs.filter((p) => p.v!.level === l);
    const pick = [byLevel("danger")[0], byLevel("warning")[0], byLevel("inspected")[0]].filter(Boolean);
    for (const p of byLevel("danger").slice(1)) if (pick.length < 3) pick.splice(1, 0, p);
    for (const { item, v } of pick.slice(0, 3)) {
      const marks: Partial<Record<Proof["field"], "match">> = {};
      if (v!.level === "danger") for (const p of v!.proof) if (p.matched) marks[p.field] = "match";
      entries.push({ item, level: v!.level, headline: v!.headline, line: v!.notice ? noticeRef(v!.notice) : undefined, marks, hits: v!.proof.filter((p) => p.matched).map((p) => p.yours) });
    }
  }
  const counts = { danger: 0, warning: 0, inspected: 0 };
  demo?.verdicts?.forEach((v) => counts[v.level]++);

  // A mix of agencies: CPSC publishes in weekly batches, so the newest eight would otherwise be all CPSC.
  const all = latest?.notices ?? [];
  const week = [...all.filter((n) => n.source === "cpsc").slice(0, 5), ...all.filter((n) => n.source === "fda").slice(0, 3)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <>
      <Header />
      <main className={s.main}>
        <section className={s.hero} id="check">
          <div className={s.copy}>
            <h1 className={s.h1}>Is anything you own recalled?</h1>
            <p className={s.lede}>
              List what you own, or photograph the label. An agent searches the official recall databases and the web, compares your model and lot numbers with each recall, and tags
              anything recalled with what to do.
            </p>
            <CheckForm examples={EXAMPLES} />
            <p className={s.fine}>Searches NHTSA, CPSC, FDA and the web. No account, nothing to install.</p>
          </div>
          {entries.length ? (
            <div className={s.boardCol}>
              <Board
                entries={entries}
                caption={
                  <>
                    A real check from {fmtDate(demo!.createdAt)}: {plural(demo!.items!.length, "thing")}, {counts.danger} tagged do not use.{" "}
                    <Link href={`/check/${demo!.id}`}>See the whole check</Link>
                  </>
                }
              />
            </div>
          ) : null}
        </section>

        <section className={s.how} aria-labelledby="how-h">
          <div className={s.howHead}>
            <h2 id="how-h" className={s.h2}>
              How a tag is decided
            </h2>
            <p className={s.sub}>NVIDIA Nemotron on Nebius Token Factory does the reading and the searching. The final call is made by rules you can check.</p>
          </div>
          <ol className={s.steps}>
            <li>
              <h3>Read what you own</h3>
              <p>Nemotron turns your list into brand, model, lot and VIN. A code it returns that isn&apos;t in what you typed is dropped. Label photos are read by a vision model.</p>
            </li>
            <li>
              <h3>Search like an investigator</h3>
              <p>
                Nemotron 3 Ultra calls the agencies&apos; own databases as tools, reads what comes back and searches again with better words. Tavily searches the agencies&apos; newsrooms
                and makers&apos; recall pages for anything the databases haven&apos;t caught up with.
              </p>
            </li>
            <li>
              <h3>Read each notice&apos;s list</h3>
              <p>The affected models, lots and dates are read from the notice&apos;s own wording, then checked character by character against it. A code the notice doesn&apos;t print is struck.</p>
            </li>
            <li>
              <h3>Match the codes</h3>
              <p>Your codes are compared with each recall&apos;s list by plain rules, not by a model. A tag is red only when a code printed on your product is on the list.</p>
            </li>
          </ol>
          <ul className={s.legend} aria-label="What the tags mean">
            <li>
              <Tag level="danger" size="sm" rest={-3} />
              <p>
                <b>Do not use.</b> A model, lot or UPC on your product is on the recall&apos;s list. You get the remedy and who to contact.
              </p>
            </li>
            <li>
              <Tag level="warning" size="sm" rest={2} />
              <p>
                <b>Check the label.</b> That product line is recalled but yours isn&apos;t confirmed either way, or it&apos;s a car (only NHTSA&apos;s VIN lookup can say). You&apos;re told
                exactly where the code is printed.
              </p>
            </li>
            <li>
              <Tag level="inspected" size="sm" rest={-1} />
              <p>
                <b>Checked.</b> No recall lists it on the day of the check. The tag says which sources were searched and when.
              </p>
            </li>
          </ul>
        </section>

        {week.length ? (
          <section className={s.week} aria-labelledby="week-h">
            <div className={s.weekHead}>
              <h2 id="week-h" className={s.h2}>
                Recalled lately
              </h2>
              <p className={s.sub}>The newest recalls from CPSC and the FDA, updated hourly. Most people never hear about them.</p>
            </div>
            <ul className={s.feed}>
              {week.map((n) => (
                <li key={`${n.source}${n.id}`}>
                  <span className={s.agency}>{AGENCY[n.source]}</span>
                  <a href={n.url} target="_blank" rel="noreferrer" className={s.feedTitle}>
                    {n.title}
                  </a>
                  <span className={s.feedDate}>{fmtDate(n.date)}</span>
                </li>
              ))}
            </ul>
            <Link href="/recalls" className={s.more}>
              All recent recalls
            </Link>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

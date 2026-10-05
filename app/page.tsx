import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import CheckForm from "@/components/check/CheckForm";
import Board, { type BoardEntry } from "@/components/home/Board";
import Specimen from "@/components/home/Specimen";
import TagWall from "@/components/home/TagWall";
import WhereCodes from "@/components/home/WhereCodes";
import Tag from "@/components/tag/Tag";
import { latestRecalls } from "@/lib/latest";
import { showcase } from "@/lib/showcase";
import { yearWall } from "@/lib/wall";
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
  const [demo, latest, wall] = await Promise.all([showcase().catch(() => null), latestRecalls().catch(() => null), yearWall().catch(() => null)]);

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
  // The FDA often files one recall per strength or pack size; show one per firm and product.
  const seen = new Set<string>();
  const distinct = all.filter((n) => {
    const k = `${n.firm ?? ""}|${n.title.split(/,|\s\d/)[0].toLowerCase()}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const week = [...distinct.filter((n) => n.source === "cpsc").slice(0, 5), ...distinct.filter((n) => n.source === "fda").slice(0, 3)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const months = wall ? wall.months.length : 0;
  const monthWords = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

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
              <div className={s.peg}>
                <Board entries={entries} />
              </div>
              <p className={s.caption}>
                A real check from {fmtDate(demo!.createdAt)}: {plural(demo!.items!.length, "thing")}, {counts.danger} tagged do not use.{" "}
                <Link href={`/check/${demo!.id}`}>See the whole check</Link>
              </p>
            </div>
          ) : null}
        </section>

        {wall ? (
          <section className={s.band} aria-labelledby="wall-h">
            <div className={s.bandHead}>
              <h2 id="wall-h" className={s.h2}>
                {wall.total} recalls in {monthWords[months] ?? months} months.
              </h2>
              <p className={s.sub}>
                Every Consumer Product Safety Commission recall of {wall.year} so far, one tag each, hung by month and coloured by hazard. Point at a tag to read it; pick a hazard to
                see how often it comes up.
              </p>
            </div>
            <TagWall wall={wall} />
          </section>
        ) : null}

        <section className={s.band} aria-labelledby="spec-h">
          <div className={s.bandHead}>
            <h2 id="spec-h" className={s.h2}>
              Anatomy of a red tag
            </h2>
            <p className={s.sub}>NVIDIA Nemotron on Nebius Token Factory does the reading and the searching. The final call is a comparison you can check yourself.</p>
          </div>
          <Specimen />
        </section>

        <section className={s.band} aria-labelledby="codes-h">
          <div className={s.bandHead}>
            <h2 id="codes-h" className={s.h2}>
              The code is on the product. You just need to know where.
            </h2>
            <p className={s.sub}>Every recall says which models or lots it covers and where that code is printed. These are the agencies&apos; own words.</p>
          </div>
          <WhereCodes />
        </section>

        <section className={s.band} aria-labelledby="tags-h">
          <div className={s.bandHead}>
            <h2 id="tags-h" className={s.h2}>
              Three tags
            </h2>
            <p className={s.sub}>Red only when a code on your product is on the recall&apos;s list. When Tagout can&apos;t be sure, it says what to check instead of guessing.</p>
          </div>
          <ul className={s.legend}>
            <li>
              <Tag level="danger" rest={-3}>
                <b>A code on your product is on the recall&apos;s list.</b>
                <span className={s.legendNote}>You get the remedy, the firm&apos;s contact and the notice.</span>
              </Tag>
            </li>
            <li>
              <Tag level="warning" rest={2}>
                <b>The product line is recalled; yours isn&apos;t confirmed either way.</b>
                <span className={s.legendNote}>The tag says where the code is printed. Cars stop here: only NHTSA&apos;s VIN lookup can say.</span>
              </Tag>
            </li>
            <li>
              <Tag level="inspected" rest={-1}>
                <b>No recall lists it on the day of the check.</b>
                <span className={s.legendNote}>The tag names the sources searched and the date.</span>
              </Tag>
            </li>
          </ul>
        </section>

        {week.length ? (
          <section className={s.week} aria-labelledby="week-h">
            <div className={s.weekHead}>
              <h2 id="week-h" className={s.h2}>
                Recalled lately
              </h2>
              <p className={s.sub}>The newest recalls from CPSC and the FDA, updated hourly.</p>
              <Link href="/recalls" className={s.more}>
                All recent recalls
              </Link>
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
          </section>
        ) : null}

        <section className={s.close} aria-labelledby="close-h">
          <div className={s.closeInner}>
            <div className={s.closeCopy}>
              <h2 id="close-h" className={s.closeH}>
                Check the things you own.
              </h2>
              <p>Type what&apos;s in the house, or photograph a few labels. Every check gets its own link, so you can send it to whoever needs it.</p>
              <Link href="/#check" className={s.closeGo}>
                Check my things
              </Link>
            </div>
            <div className={s.closeTags} aria-hidden="true">
              <div className={s.hanger}>
                <Tag level="inspected" size="lg" rest={-4}>
                  <b>No recall found for Lasko model CT22425.</b>
                </Tag>
              </div>
              <div className={s.hanger}>
                <Tag level="warning" size="lg" rest={3}>
                  <b>Some Evenflo car seats are recalled. Check the model number under the seat.</b>
                </Tag>
              </div>
              <div className={s.hanger}>
                <Tag level="danger" size="lg" rest={-2}>
                  <b>Lot EJA022 is listed in this recall.</b>
                </Tag>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

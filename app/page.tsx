import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import CheckForm from "@/components/check/CheckForm";
import Board, { type BoardEntry } from "@/components/home/Board";
import Specimen from "@/components/home/Specimen";
import TagWall from "@/components/home/TagWall";
import MyWatches from "@/components/watch/MyWatches";
import WhereCodes from "@/components/home/WhereCodes";
import Tag from "@/components/tag/Tag";
import Ladder from "@/components/home/Ladder";
import { SHOWCASE } from "@/lib/site";
import { latestRecalls } from "@/lib/latest";
import { showcase } from "@/lib/showcase";
import { yearWall } from "@/lib/wall";
import { AGENCY, fmtDate, noticeRef, plural } from "@/lib/format";
import type { Proof } from "@/lib/types";
import summary from "@/eval/summary.json";
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
  const red = demo?.items?.find((i) => demo.verdicts?.find((v) => v.itemId === i.id)?.level === "danger");
  const monthWords = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

  return (
    <>
      <Header />
      <main className={s.main}>
        {/* The lockout station: the household's labels hang on the steel board with the tags the check gave them. */}
        <section className={s.station} id="check">
          <div className={s.hero}>
            <div className={s.copy}>
              <h1 className={s.h1}>Is anything you own recalled?</h1>
              <p className={s.lede}>
                List what you own, or photograph the label. An agent on NVIDIA Nemotron searches the official recall databases and the web, compares your model and lot numbers
                with each recall, and tags anything recalled with what to do.
              </p>
              <div className={s.formCard}>
                <CheckForm examples={EXAMPLES} />
                <p className={s.fine}>Searches NHTSA, CPSC, FDA, USDA and the web. No account, nothing to install.</p>
                <MyWatches className={s.fine} />
              </div>
            </div>
            {entries.length ? (
              <div className={s.boardCol}>
                <Board entries={entries} />
                <p className={s.caption}>
                  A real check from {fmtDate(demo!.createdAt)}: {plural(demo!.items!.length, "thing")}, {counts.danger} tagged do not use.{" "}
                  <Link href={`/check/${demo!.id}`}>Open the whole check</Link>
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className={s.band} aria-labelledby="see-h">
          <div className={s.bandHead}>
            <h2 id="see-h" className={s.h2}>
              Three tags, three real checks.
            </h2>
            <p className={s.sub}>
              Red only when a code on your product is on the recall&apos;s list. When Tagout can&apos;t be sure, it says what to check instead of guessing. Each tag opens a
              check that really ran.
            </p>
          </div>
          <div className={s.rail}>
            <Link href={`/check/${SHOWCASE.household}`} className={s.hook}>
              <Tag level="danger" rest={-3} foot="A household of five things">
                <b>A code on your product is on the recall&apos;s list.</b>
                <span className={s.legendNote}>{red ? `${[red.brand, red.product].filter(Boolean).join(" ") || red.said}: stop using it. You get the remedy and the firm's contact.` : "You get the remedy, the firm's contact and the notice."}</span>
                <span className={s.open}>Open this check</span>
              </Tag>
            </Link>
            <Link href={`/check/${SHOWCASE.webcatch}`} className={s.hook}>
              <Tag level="warning" rest={2} foot="Caught on the web by Tavily">
                <b>The product line is recalled; yours isn&apos;t confirmed either way.</b>
                <span className={s.legendNote}>These recalls were found on the web before the agency databases listed them. The tag says where the code is printed.</span>
                <span className={s.open}>Open this check</span>
              </Tag>
            </Link>
            <Link href={`/watch/${SHOWCASE.watch}`} className={s.hook}>
              <Tag level="inspected" rest={-1} foot="Saved as a watch">
                <b>No recall lists it on the day of the check.</b>
                <span className={s.legendNote}>Save a check as a watch and Tagout keeps comparing it with new recalls.</span>
                <span className={s.open}>Open this watch</span>
              </Tag>
            </Link>
          </div>
        </section>

        <section className={s.band} aria-labelledby="proof-h">
          <div className={s.bandHead}>
            <h2 id="proof-h" className={s.h2}>
              Measured on {summary.cases} real recall cases.
            </h2>
            <p className={s.sub}>
              Each line answered the same cases, checked against the agencies&apos; own records. The rules are what keep a recalled unit from being cleared.{" "}
              <Link href="/proof" className={s.more}>
                Every case and every miss
              </Link>
            </p>
          </div>
          <Ladder />
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
                  <span className={s.agency} data-source={n.source}>
                    {AGENCY[n.source]}
                  </span>
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
          <div className={s.closeCopy}>
            <h2 id="close-h" className={s.closeH}>
              Check the things you own.
            </h2>
            <p>Type what&apos;s in the house, or photograph a few labels. Every check gets its own link, so you can send it to whoever needs it.</p>
            <Link href="/#check" className={s.closeGo}>
              Check my things
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

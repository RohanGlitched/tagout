import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import { TAG_WORDS } from "@/components/tag/Tag";
import { REPO_URL } from "@/lib/site";
import type { TagLevel } from "@/lib/types";
import summary from "@/eval/summary.json";
import caseFile from "@/eval/cases.json";
import notes from "@/eval/notes.json";
import s from "./proof.module.css";

export const metadata = {
  title: "Proof: the eval",
  description: "Tagout measured on 105 real CPSC, FDA and NHTSA cases against Nemotron alone, Nemotron reading Tavily results, a fixed search plan and three Nemotron sizes.",
};

type Arm = (typeof summary.arms)[number];
type Case = { id: string; group: string; text: string; expect: string; recall?: string[]; near?: string; why?: string };
const cases = caseFile.cases as Case[];
const arm = (id: string) => summary.arms.find((a) => a.arm === id);

const GROUP_NAME: Record<string, string> = {
  positive: "Recalled units",
  "near-miss": "Near misses",
  "no-code": "No code given",
  car: "Cars",
  clean: "Not recalled",
};
const GROUP_RIGHT: Record<string, string> = {
  positive: "Right answer: Do not use.",
  "near-miss": "Right answer: anything but Do not use.",
  "no-code": "Right answer: Check the label.",
  car: "Right answer: Check the label when NHTSA lists a recall for that make, model and year, Checked when it lists none.",
  clean: "Right answer: Checked.",
};

const right = (c: Case, level: string) => (c.expect === "not-danger" ? level === "warning" || level === "inspected" : level === c.expect);
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const cents = (x: number) => (x < 0.0005 ? "0¢" : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}¢`);
const secs = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(0)} s`);

/** The arms a judge asks about first: does the agent beat the model alone, and does the model beat no model? */
const MAIN = ["tagout", "search-ultra", "alone-ultra", "fixed-plan-nano", "rules"];
const SHORT: Record<string, string> = {
  tagout: "Tagout",
  "search-ultra": "Nemotron + Tavily, no rules",
  "alone-ultra": "Nemotron alone",
  "fixed-plan-nano": "Fixed plan + Nano (lite tier)",
  rules: "No model at all",
  "super-readers": "Super notice reader",
  "nano-readers": "Nano notice reader",
  "super-agent": "Super search agent",
  "nano-agent": "Nano search agent",
};

function Plate({ a, lead = false }: { a: Arm; lead?: boolean }) {
  return (
    <article className={s.plate} data-lead={lead ? "" : undefined}>
      <h3>{SHORT[a.arm] ?? a.arm}</h3>
      <p className={s.plateSub}>{a.label}</p>
      <dl>
        <div>
          <dt>Right</dt>
          <dd>
            {a.right}
            <small>/{a.n}</small>
          </dd>
        </div>
        <div data-bad={a.falseRed.length ? "" : undefined}>
          <dt>Wrongly told to stop using</dt>
          <dd>{a.falseRed.length}</dd>
        </div>
        <div data-bad={a.falseClear.length ? "" : undefined}>
          <dt>Recalled, but cleared</dt>
          <dd>{a.falseClear.length}</dd>
        </div>
        <div>
          <dt>Red tags that were right</dt>
          <dd>
            {pct(a.redPrecision)}
            <small>
              {" "}
              {a.truePositives}/{a.reds}
            </small>
          </dd>
        </div>
        <div>
          <dt>Recalled units caught</dt>
          <dd>
            {pct(a.redRecall)}
            <small>
              {" "}
              {a.truePositives}/{a.positives}
            </small>
          </dd>
        </div>
        <div>
          <dt>Cost per item</dt>
          <dd>{cents(a.usdPerItem)}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function Proof() {
  const t = arm("tagout");
  const main = MAIN.map(arm).filter((a): a is Arm => Boolean(a));
  const models = summary.arms.filter((a) => !MAIN.includes(a.arm) || a.arm === "tagout" || a.arm === "fixed-plan-nano");
  const first = summary.firstRun;
  const note = (k: string) => (notes as Record<string, string>)[k];
  const matrix = [...main, ...summary.arms.filter((a) => !MAIN.includes(a.arm))];
  const wrong = t ? cases.filter((c) => t.levels[c.id as keyof typeof t.levels] && !right(c, t.levels[c.id as keyof typeof t.levels] as string)) : [];
  const alone = arm("alone-ultra");
  const search = arm("search-ultra");

  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <p className={s.kicker}>Proof</p>
          <h1 className={s.h1}>{summary.cases} real cases, measured against the model alone.</h1>
          <p className={s.lede}>
            We built a test set from 2026 recall records: units whose code is printed in a CPSC, FDA or NHTSA notice, the same products with a neighbouring lot or model, recalled
            lines with no code, cars, and things no recall lists. Every answer was checked against the agency&apos;s own record, not against Tagout. Then the same cases ran through
            Tagout, through Nemotron 3 Ultra on its own, through Nemotron reading Tavily&apos;s results, through a fixed search plan, and on three Nemotron sizes.
          </p>
        </header>

        {t ? (
          <section className={s.section} aria-labelledby="head-h">
            <h2 id="head-h" className={s.h2}>
              The short answer
            </h2>
            <ul className={s.claims}>
              <li>
                Things wrongly tagged Do not use: <b>{t.falseRed.length}</b> by Tagout
                {alone ? (
                  <>
                    , against <b>{alone.falseRed.length}</b> by Nemotron alone
                  </>
                ) : null}
                {search ? (
                  <>
                    {" "}
                    and <b>{search.falseRed.length}</b> by Nemotron reading the same web results without rules
                  </>
                ) : null}
                .
              </li>
              <li>
                Tagout caught <b>{t.truePositives}</b> of <b>{t.positives}</b> recalled units with a red tag
                {alone ? (
                  <>
                    ; Nemotron alone named <b>{alone.truePositives}</b>
                  </>
                ) : null}
                {search ? (
                  <>
                    , and <b>{search.truePositives}</b> with search
                  </>
                ) : null}
                .
              </li>
              <li>
                Recalled things cleared green, the error that matters most: <b>{t.falseClear.length}</b> by Tagout
                {alone ? (
                  <>
                    , <b>{alone.falseClear.length}</b> by Nemotron alone
                  </>
                ) : null}
                {search ? (
                  <>
                    {" "}
                    and <b>{search.falseClear.length}</b> with search
                  </>
                ) : null}
                .
              </li>
              <li>
                A check cost <b>{cents(t.usdPerItem)}</b> per item on Nemotron 3 Ultra and took a median <b>{secs(t.medianMs)}</b>.
              </li>
            </ul>
          </section>
        ) : null}

        <section className={s.section} aria-labelledby="arms-h">
          <h2 id="arms-h" className={s.h2}>
            Does the agent earn its place?
          </h2>
          <p className={s.sub}>
            The same {summary.cases} cases, five ways. The model alone answers from memory. With Tavily it reads the official recall pages a web search finds, but decides on its own.
            The fixed plan runs set searches instead of the agent, with Nemotron 3 Nano reading the notices and the same rules deciding: that is now Tagout&apos;s lite tier. The last
            one uses no model at all, which is what the demo used to fall back to.
          </p>
          <div className={s.plates}>
            {main.map((a) => (
              <Plate key={a.arm} a={a} lead={a.arm === "tagout"} />
            ))}
          </div>
        </section>

        <section className={s.section} aria-labelledby="cases-h">
          <h2 id="cases-h" className={s.h2}>
            Every case, every arm
          </h2>
          <p className={s.sub}>
            One mark per answer, in the tag&apos;s colour. A crossed mark is a wrong answer. Hover or tap a row for the line that was typed.
          </p>
          <div className={s.legend} aria-hidden="true">
            {(["danger", "warning", "inspected"] as TagLevel[]).map((l) => (
              <span key={l}>
                <i data-level={l} /> {TAG_WORDS[l]}
              </span>
            ))}
            <span>
              <i data-level="danger" data-wrong="" /> wrong
            </span>
          </div>
          {Object.keys(GROUP_NAME).map((g) => {
            const rows = cases.filter((c) => c.group === g);
            return (
              <details key={g} className={s.group} open={g === "positive" || g === "near-miss"}>
                <summary>
                  <b>{GROUP_NAME[g]}</b> <span>{rows.length} cases. {GROUP_RIGHT[g]}</span>
                </summary>
                <div className={s.gridWrap}>
                  <table className={s.grid}>
                    <thead>
                      <tr>
                        <th scope="col">What was typed</th>
                        {matrix.map((a) => (
                          <th key={a.arm} scope="col" title={a.label} data-extra={MAIN.includes(a.arm) ? undefined : ""}>
                            <span>{SHORT[a.arm] ?? a.arm}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id}>
                          <th scope="row" title={c.why ?? c.recall?.join(", ") ?? c.near}>
                            <span className="code">{c.id}</span> {c.text}
                          </th>
                          {matrix.map((a) => {
                            const lv = a.levels[c.id as keyof typeof a.levels] as string | undefined;
                            const ok = lv ? right(c, lv) : true;
                            return (
                              <td key={a.arm} data-extra={MAIN.includes(a.arm) ? undefined : ""}>
                                {lv ? (
                                  <i data-level={lv} data-wrong={ok ? undefined : ""} aria-label={`${SHORT[a.arm] ?? a.arm}: ${TAG_WORDS[lv as TagLevel] ?? lv}${ok ? "" : ", wrong"}`} />
                                ) : (
                                  <span className={s.na}>·</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </section>

        {t ? (
          <section className={s.section} aria-labelledby="wrong-h">
            <h2 id="wrong-h" className={s.h2}>
              What Tagout got wrong
            </h2>
            <p className={s.sub}>{wrong.length ? `${wrong.length} of ${t.n} answers. Each one, and why.` : "Nothing in this run."}</p>
            <ul className={s.wrong}>
              {wrong.map((c) => {
                const lv = t.levels[c.id as keyof typeof t.levels] as TagLevel;
                const note = (notes as Record<string, string>)[c.id];
                return (
                  <li key={c.id}>
                    <p className={s.wrongHead}>
                      <span className="code">{c.id}</span> {c.text} <i data-level={lv}>{TAG_WORDS[lv] ?? lv}</i>
                    </p>
                    {note ? <p>{note}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {first ? (
          <section className={s.section} aria-labelledby="first-h">
            <h2 id="first-h" className={s.h2}>
              The first run, and what it changed
            </h2>
            <p className={s.sub}>
              The first full run got {first.right} of {first.n} right: {first.falseRed.length} units wrongly tagged Do not use and {first.falseClear.length} recalled units cleared. Each
              miss was traced to its cause and fixed in code, with a unit test, before the run above. The numbers above are therefore measured on cases that shaped the fixes; the
              first run is the fairer estimate for things Tagout hasn&apos;t seen.
            </p>
            <ul className={s.wrong}>
              {[...first.wrong.map((w) => w.id), "n21", "k07"]
                .filter((id, i, a) => a.indexOf(id) === i && note(`first:${id}`))
                .map((id) => (
                  <li key={id}>
                    <p>
                      <span className="code">{id}</span> {note(`first:${id}`)}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <section className={s.section} aria-labelledby="models-h">
          <h2 id="models-h" className={s.h2}>
            Which Nemotron for which job
          </h2>
          <p className={s.sub}>
            Tagout has three model jobs: reading the list, running the search agent, and reading each notice&apos;s codes. The track asks for Ultra where the reasoning is hard and
            smaller models for the everyday calls, so every size ran every case.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Models</th>
                  <th scope="col">Right</th>
                  <th scope="col">Wrongly red</th>
                  <th scope="col">Recalled, cleared</th>
                  <th scope="col">Cost per item</th>
                  <th scope="col">Median time</th>
                </tr>
              </thead>
              <tbody>
                {models.map((a) => (
                  <tr key={a.arm}>
                    <th scope="row">
                      {SHORT[a.arm] ?? a.arm}
                      <small>{a.label}</small>
                    </th>
                    <td>
                      {a.right}/{a.n}
                    </td>
                    <td>{a.falseRed.length}</td>
                    <td>{a.falseClear.length}</td>
                    <td>{cents(a.usdPerItem)}</td>
                    <td>{secs(a.medianMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(notes as Record<string, string>).routing ? <p className={s.routing}>{(notes as Record<string, string>).routing}</p> : null}
        </section>

        <section className={s.section} aria-labelledby="method-h">
          <h2 id="method-h" className={s.h2}>
            How it was measured, and what it can&apos;t show
          </h2>
          <ul className={s.method}>
            <li>
              Cases come from CPSC recalls of 2025–26 (SaferProducts.gov), openFDA enforcement reports and NHTSA&apos;s recall API. <span className="code">eval/verify.mjs</span> checks each
              one against the agency record without any Tagout code: a recalled code must be printed in its notice; a near miss must not be printed in that notice or in any CPSC or
              FDA record of the same brand.
            </li>
            <li>
              Each arm ran each case once, on {fmtRun(summary.at)}. Model answers vary between runs; this is one sample, not an average. Every HTTP response was cached, so all arms read
              the same agency data and the whole run can be replayed for free.
            </li>
            <li>
              Two changes made after this run are not in its numbers: an agency&apos;s page listing many recalls no longer stands in for one notice, and an FDA company
              announcement with no enforcement report behind it is marked as ahead of the database.
            </li>
            <li>
              We chose the cases. Recalled units come from recent notices that print a code, which is the case Tagout is built for; a product whose notice prints no code can only ever
              be orange.
            </li>
            <li>Cost is tokens times Token Factory&apos;s list prices ($1/$3 per million for Ultra, $0.30/$0.90 for Super, $0.06/$0.24 for Nano). Agency APIs and Tavily cost nothing here.</li>
          </ul>
          <p className={s.more}>
            Reproduce it: <span className="code">node eval/verify.mjs</span>, then <span className="code">npx tsx --conditions=react-server eval/run.ts tagout</span> for each arm, then{" "}
            <span className="code">node eval/score.mjs</span>. Code and cases: <a href={`${REPO_URL}/tree/main/eval`}>{`${REPO_URL.replace("https://", "")}/tree/main/eval`}</a>.{" "}
            <Link href="/#check">Check your own things</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function fmtRun(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

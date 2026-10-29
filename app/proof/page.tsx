import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import { TAG_WORDS } from "@/components/tag/Tag";
import { REPO_URL, SHOWCASE } from "@/lib/site";
import type { TagLevel } from "@/lib/types";
import oct15 from "@/eval/summary.json";
import current from "@/eval/summary-current.json";
import holdout from "@/eval/holdout-summary.json";
import heldAfter from "@/eval/holdout-after-fixes.json";
import heldExtra from "@/eval/holdout-arms-extra.json";
import held2 from "@/eval/holdout2-summary.json";
import held3 from "@/eval/holdout3-summary.json";
import cases3File from "@/eval/cases-holdout3.json";
import cases2File from "@/eval/cases-holdout2.json";
import caseFile from "@/eval/cases.json";
import notes from "@/eval/notes.json";
import coverage from "@/docs/bound-coverage.json";
import s from "./proof.module.css";

export const metadata = {
  title: "Proof: the eval",
  description:
    "Tagout measured on two held-out sets it had never seen (39 cases run once, and 19 pre-registered in public before any run), then on 105 real CPSC, FDA and NHTSA cases against Nemotron alone, Nemotron reading Tavily results, a fixed search plan and three Nemotron sizes.",
};

/** The 105 at today's code (eval/summary-current.json: Tagout and the lite tier at ed2dc77, the other arms at a9a0f8f). */
const summary = current;
type Arm = (typeof summary.arms)[number];
type Case = { id: string; group: string; text: string; expect: string; recall?: string[]; near?: string; why?: string };
type Case2 = { id: string; set: string; group: string; probe: string; text: string; expect: string; note?: string };
const cases = caseFile.cases as Case[];
const cases2 = cases2File.cases as Case2[];
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
const PROBE: Record<string, string> = {
  range: "Inside a printed serial range",
  family: "A prefix and a number inside a printed range",
  window: "A best-by or use-by window",
  gap: "A gap in a listed run of codes",
  listed: "Printed in the recall",
  "whole-line": "Every unit recalled, no code",
  car: "A car",
  clean: "Nothing recalls it",
};
const EXPECT: Record<string, string> = {
  danger: "Do not use",
  "not-danger": "anything but Do not use",
  flag: "Do not use or Check the label",
  warning: "Check the label",
  inspected: "Checked",
};

const right = (c: { expect: string }, level: string) =>
  c.expect === "not-danger" ? level === "warning" || level === "inspected" : c.expect === "flag" ? level === "warning" || level === "danger" : level === c.expect;
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const HELD_NAME: Record<string, string> = {
  tagout: "Tagout: Nemotron 3 Ultra agent and readers",
  "tagout-noweb": "Tagout with Tavily off",
  "fixed-plan": "Fixed plan, Ultra readers",
  "fixed-plan-nano": "Lite tier: fixed plan, Nano reader",
  "fixed-plan-nano-noweb": "Lite tier with Tavily off",
  rules: "No model at all: fixed plan, pattern reader, rules",
};
const held = holdout.arms.find((a) => a.arm === "tagout")!;
const heldLite = holdout.arms.find((a) => a.arm === "fixed-plan-nano")!;
const lagAbl = holdout.tavilyAblation.tagout.lag;
const t2 = held2.arms.find((a) => a.arm === "tagout")!;
const lite2 = held2.arms.find((a) => a.arm === "fixed-plan-nano")!;
const rules2 = held2.arms.find((a) => a.arm === "rules");
const noweb2 = held2.arms.find((a) => a.arm === "tagout-noweb");
const CODE_NOW = "019d39e";
const h3t = held3.arms.find((a) => a.arm === "tagout")!;
const cases3 = cases3File.cases as { id: string; text: string }[];
const after = heldAfter.arms.find((a) => a.arm === "tagout")!;
const cents = (x: number) => (x < 0.0005 ? "0¢" : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}¢`);
const secs = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(0)} s`);
const PREREG = { tag: "prereg-2026-10-25", commit: "45dc3a1", sha256: "34907813bf703a3dafc877c60cfdf0a7f775a9e57a8cab9ac23432fcc2014cbd" };

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
  const t = arm("tagout")!;
  const lite = arm("fixed-plan-nano")!;
  const rules = arm("rules")!;
  const main = MAIN.map(arm).filter((a): a is Arm => Boolean(a));
  const models = oct15.arms.filter((a) => !MAIN.includes(a.arm) || a.arm === "tagout" || a.arm === "fixed-plan-nano");
  const first = oct15.firstRun;
  const note = (k: string) => (notes as Record<string, string>)[k];
  const matrix = [...main, ...summary.arms.filter((a) => !MAIN.includes(a.arm))];
  const wrong = cases.filter((c) => t.levels[c.id as keyof typeof t.levels] && !right(c, t.levels[c.id as keyof typeof t.levels] as string));
  const oct15Tagout = oct15.arms.find((a) => a.arm === "tagout")!;
  const oct15Wrong = cases.filter((c) => oct15Tagout.levels[c.id as keyof typeof oct15Tagout.levels] && !right(c, oct15Tagout.levels[c.id as keyof typeof oct15Tagout.levels] as string));
  const alone = arm("alone-ultra");
  const search = arm("search-ultra");
  const lv2 = (a: { levels: Record<string, string> }, id: string) => a.levels[id] as TagLevel | undefined;
  const wrong2 = cases2.filter((c) => lv2(t2, c.id) && !right(c, lv2(t2, c.id)!));

  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>
            Measured on {holdout.cases + held2.cases + held3.cases} cases it had never seen, then on {summary.cases} it was tuned on.
          </h1>
          <p className={s.lede}>
            Every case is a real 2025–26 recall record: units whose code is printed in a CPSC, FDA or NHTSA notice, the same products with a neighbouring lot or model, recalled lines
            with no code, cars, and things no recall lists. Every answer was checked against the agency&apos;s own record, not against Tagout. Three sets were held out and run once; the second and third were published with a git tag before anything ran on them.
          </p>
        </header>
        <nav className={s.index} aria-label="On this page">
          {[
            ["head-h", "Short answer"],
            ["held-h", "Held out #1"],
            ["held2-h", "Held out #2"],
            ["held3-h", "Held out #3"],
            ["tavily-h", "What Tavily does"],
            ["agent-h", "Is the agent worth it"],
            ["arms-h", "Each setup"],
            ["cases-h", "Every case"],
            ["wrong-h", "What went wrong"],
            ["first-h", "First run"],
            ["models-h", "Which Nemotron"],
            ["method-h", "Method"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <section className={s.section} aria-labelledby="head-h">
          <h2 id="head-h" className={s.h2}>
            The short answer
          </h2>
          <ul className={s.claims}>
            <li data-kind="held">
              <span className={s.claimKick}>Held out #1 · {holdout.cases} new cases, run once on Oct 25</span>
              <span className={s.claimBig}>
                {held.right}/{held.n}
              </span>
              <b>
                {held.right}/{held.n}
              </b>{" "}
              right, <b>{held.falseRed.length}</b> of {held.falseRedOf} false alarms (wrongly tagged Do not use), and <b>{held.falseClear.length}</b> of {held.falseClearOf} recalled
              items cleared green, the error that matters most. Each of the four was traced and fixed in code.
            </li>
            <li data-kind="held">
              <span className={s.claimKick}>Held out #2 · {held2.cases} cases, pre-registered, run once on Oct 30 (IST)</span>
              <span className={s.claimBig}>
                {t2.right}/{t2.n}
              </span>
              <b>
                {t2.right}/{t2.n}
              </b>{" "}
              right, <b>{t2.falseRed.length}</b> of {t2.falseRedOf} false alarms, and <b>{t2.falseClear.length}</b> of {t2.falseClearOf} recalled items cleared green. The set
              tests printed ranges, code families and date windows, which the first sets never did on a recalled unit; <a href="#held2-h">what it found</a>.
            </li>
            <li data-kind="held">
              <span className={s.claimKick}>Held out #3 · {held3.cases} cases, pre-registered, run once on Oct 30</span>
              <span className={s.claimBig}>
                {h3t.right}/{h3t.n}
              </span>
              right, <b>{h3t.falseRed.length}</b> of {h3t.falseRedOf} false alarms and <b>{h3t.falseClear.length}</b> of {h3t.falseClearOf} recalled items cleared green, on bounded codes and
              dates the fixes after set #2 had never seen. <a href="#held3-h">What went wrong</a>.
            </li>
            <li>
              <span className={s.claimKick}>Tavily, on and off, same cases</span>
              <span className={s.claimBig}>
                {lagAbl.withTavily.flagged} of {lagAbl.shouldFlag}
              </span>
              Of {lagAbl.shouldFlag} held-out recalls no database listed yet, Tagout without Tavily cleared <b>all {lagAbl.shouldFlag}</b> green; with it, it flagged{" "}
              <b>{lagAbl.withTavily.flagged}</b> ({lagAbl.withTavily.red} red). <a href="#tavily-h">What Tavily does here</a>.
            </li>
            <li>
              <span className={s.claimKick}>The {summary.cases} tuned cases, at today&apos;s code (in-sample)</span>
              <span className={s.claimBig}>
                {t.right}/{t.n}
              </span>
              <b>
                {t.right}/{t.n}
              </b>{" "}
              right: <b>{t.truePositives}</b> of {t.positives} recalled units caught, <b>{t.falseRed.length}</b> wrongly red, <b>{t.falseClear.length}</b> cleared
              {alone ? (
                <>
                  ; Nemotron alone caught <b>{alone.truePositives}</b> and wrongly tagged <b>{alone.falseRed.length}</b> red
                </>
              ) : null}
              . The first full run on Oct 15 got {first?.right}/{first?.n}.
            </li>
          </ul>
          <p className={s.sub}>
            Cost, all in: about {cents(t.usdPerItemWithTavily)} an item on the {summary.cases} at today&apos;s code ({cents(t.usdPerItem)} of Nemotron, {cents(t.tavilyUsdPerItem)} of
            Tavily), {cents(held.usdPerItemWithTavily)} on held-out set #1 and {cents(t2.usdPerItemWithTavily)} on set #2 (Tavily priced at $0.008 a credit; set #2 ran in Tavily&apos;s
            keyless mode, so it spent no credits, and $0.51 of Token Factory). The lite tier: 0.23¢ of Nemotron, 1.4¢ all in. Median time {secs(oct15Tagout.medianMs)} an item over the
            Oct 15 cases that ran live.
          </p>
        </section>

        {/* The held-out set: written after the fixes, committed before any run, run once (eval/HOLDOUT.md). */}
        <section className={s.section} aria-labelledby="held-h">
          <h2 id="held-h" className={s.h2}>
            Held out #1: {holdout.cases} new cases, run once
          </h2>
          <p className={s.sub}>
            The {summary.cases} tuned cases shaped Tagout&apos;s fixes, so they flatter it. These {holdout.cases} were written on Oct 25 from recalls published Oct 14–22, committed before
            anything ran (<span className="code">d9dce10</span>), and run once on the code as it stood (<span className="code">a1d8b21</span>). {held.bySet.lag.n} of them are recalls
            the agency databases didn&apos;t list yet: FDA company announcements and a USDA meat recall that only a web search can find.
          </p>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.stack}`}>
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Right</th>
                  <th scope="col">Wrongly red</th>
                  <th scope="col">Recalled items cleared green</th>
                  <th scope="col">Not in a database yet: exact tag</th>
                  <th scope="col">Cost per item, Tavily included</th>
                </tr>
              </thead>
              <tbody>
                {holdout.arms.map((a) => (
                  <tr key={a.arm} data-us={a.arm === "tagout" || undefined}>
                    <th scope="row">
                      {HELD_NAME[a.arm] ?? a.label}
                      <small>run once, Oct 25, code a1d8b21</small>
                    </th>
                    <td>
                      <b>{a.right}</b>/{a.n}
                    </td>
                    <td>
                      {a.falseRed.length}/{a.falseRedOf}
                    </td>
                    <td>
                      {a.falseClear.length}/{a.falseClearOf}
                    </td>
                    <td>
                      {a.bySet.lag.right}/{a.bySet.lag.n}
                    </td>
                    <td>{cents(a.usdPerItemWithTavily)}</td>
                  </tr>
                ))}
              </tbody>
              <tbody className={s.later}>
                <tr>
                  <th scope="row">
                    Tagout at today&apos;s code
                    <small>after the fixes the misses above led to: not held out</small>
                  </th>
                  <td>
                    <b>{after.right}</b>/{after.n}
                  </td>
                  <td>
                    {after.falseRed.length}/{after.falseRedOf}
                  </td>
                  <td>
                    {after.falseClear.length}/{after.falseClearOf}
                  </td>
                  <td>
                    {after.bySet.lag.right}/{after.bySet.lag.n}
                  </td>
                  <td>{cents(after.usdPerItemWithTavily)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    No model at all, rules only
                    <small>measured at today&apos;s code, where it can never clear green</small>
                  </th>
                  <td>
                    <b>{heldExtra.rules.right}</b>/{heldExtra.rules.n}
                  </td>
                  <td>
                    {heldExtra.rules.falseRed.length}/{heldExtra.rules.falseRedOf}
                  </td>
                  <td>
                    {heldExtra.rules.falseClear.length}/{heldExtra.rules.falseClearOf}
                  </td>
                  <td>{heldExtra.rules.lag}</td>
                  <td>{cents(heldExtra.rules.usdPerItemWithTavily)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.sub}>
            Right means the exact expected tag. &ldquo;Not in a database yet&rdquo; counts all 12 such cases (10 recalled units and 2 that aren&apos;t). Wrongly red is out of the 10 cases
            where red would be wrong. The last two rows ran later, on newer code, so compare them with each other, not with the rows above.
          </p>
          <ul className={s.claims}>
            <li>
              <b>What Nemotron adds over rules, at the same code.</b> On these {holdout.cases}: {after.right} right with Nemotron against {heldExtra.rules.right} with rules alone (+
              {after.right - heldExtra.rules.right}). On the {summary.cases} tuned cases: {t.right} against {rules.right} (+{t.right - rules.right}).{" "}
              {rules2 ? (
                <>
                  Held out and at one commit, on set #2: {t2.right} against {rules2.right} (+{t2.right - rules2.right}), with {t2.truePositives} recalled units red against{" "}
                  {rules2.truePositives}.
                </>
              ) : null} Rules alone clear nothing because a
              tag is never green unless a model read the notices, so their misses are needless oranges, not cleared recalls.
            </li>
            <li>
              <b>The four cleared units, and the fixes.</b> A lot printed in two parts (<span className="code">091026 DL</span>), a brand glued to &ldquo;USA&rdquo;, and a USDA page whose
              text began after 28,000 characters of menus (two cases). Each was traced and fixed with a unit test; re-run afterwards Tagout got {after.right}/{after.n} with none cleared
              and none wrongly red. That re-run is no longer held out, so the run-once row stays the headline.
            </li>
          </ul>
        </section>

        <section className={s.section} aria-labelledby="held2-h">
          <h2 id="held2-h" className={s.h2}>
            Held out #2: {held2.cases} cases, pre-registered in public, run once
          </h2>
          <p className={s.sub}>
            Written on Oct 25 to measure what the first sets never had on a recalled unit: a code inside a printed serial range, a prefix-and-number family, a best-by or use-by
            window, and near misses that sit in the gap of a listed run of codes. The cases and their ground truth were pushed with the git tag{" "}
            <a href={`${REPO_URL}/releases/tag/${PREREG.tag}`}>
              <span className="code">{PREREG.tag}</span>
            </a>{" "}
            (commit <a href={`${REPO_URL}/commit/${PREREG.commit}`}>{PREREG.commit}</a>, sha256 <span className="code">{PREREG.sha256.slice(0, 16)}…</span>) before any run. Both arms ran once on Oct 30 (IST) at <span className="code">{t2.config?.code?.commit}</span>; the
            only <span className="code">lib/</span> change since the tag is <span className="code">lib/site.ts</span> (the video link and showcase ids, no logic: see{" "}
            <span className="code">git diff prereg-2026-10-25 889b9b0 -- lib</span>). They ran exactly as{" "}
            <a href={`${REPO_URL}/blob/main/eval/HOLDOUT.md#held-out-2-pre-registered-in-public`}>eval/HOLDOUT.md</a> laid out, misses included.
          </p>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.stack} ${s.stackB}`}>
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Right</th>
                  <th scope="col">Wrongly red</th>
                  <th scope="col">Recalled items cleared green</th>
                  <th scope="col">Coded recalled units red</th>
                  <th scope="col">Cost per item, Tavily included</th>
                </tr>
              </thead>
              <tbody>
                {[t2, lite2, ...(rules2 ? [rules2] : []), ...(noweb2 ? [noweb2] : [])].map((a) => (
                  <tr key={a.arm} data-us={a.arm === "tagout" || undefined}>
                    <th scope="row">
                      {HELD_NAME[a.arm] ?? a.label}
                      <small>
                        {a.arm === "rules"
                          ? "added afterwards, not pre-registered; no model, no spend"
                          : a.arm === "tagout-noweb"
                            ? "added afterwards, not pre-registered; same code (889b9b0, in a worktree), Tavily off"
                            : "pre-registered arm, run once"}
                      </small>
                    </th>
                    <td>
                      <b>{a.right}</b>/{a.n}
                    </td>
                    <td>
                      {a.falseRed.length}/{a.falseRedOf}
                    </td>
                    <td>
                      {a.falseClear.length}/{a.falseClearOf}
                    </td>
                    <td>
                      {a.truePositives}/{a.positives}
                    </td>
                    <td>{cents(a.usdPerItemWithTavily)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={s.sub}>
            &ldquo;Recalled items&rdquo; are all {t2.falseClearOf} cases whose right answer is Do not use or Check the label (8 recalled units with a code, 2 recalls with no
            code, and a car); &ldquo;flagged&rdquo; means either tag. &ldquo;Coded recalled units&rdquo; are the 8 that must be Do not use.
          </p>
          <div className={s.gridWrap}>
            <table className={s.cases2}>
              <thead>
                <tr>
                  <th scope="col">What was typed</th>
                  <th scope="col">What it tests</th>
                  <th scope="col">Right answer</th>
                  <th scope="col">Tagout</th>
                  <th scope="col">Lite tier</th>
                </tr>
              </thead>
              <tbody>
                {cases2.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      <span className="code">{c.id}</span> {c.text}
                    </th>
                    <td data-label="Tests">
                      {PROBE[c.probe] ?? c.probe}
                      {c.set === "lag" ? <small> · in no database yet</small> : null}
                    </td>
                    <td data-label="Right answer">{EXPECT[c.expect] ?? c.expect}</td>
                    {[t2, lite2].map((a) => {
                      const lv = lv2(a, c.id);
                      const ok = lv ? right(c, lv) : false;
                      return (
                        <td key={a.arm} data-label={a.arm === "tagout" ? "Tagout" : "Lite tier"}>
                          {lv ? (
                            <span className={s.cell}>
                              <i data-level={lv} data-wrong={ok ? undefined : ""} aria-hidden="true" /> {TAG_WORDS[lv] ?? lv}
                              {ok ? "" : <b className={s.miss}> wrong</b>}
                            </span>
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
          <p className={s.sub}>
            Fixed since, in-sample and so not in the table: a best-by or use-by window printed in the record&apos;s own text is compared with the date on your line (g07),
            and a code the notice bounds instead of listing is read from its text: a two-group serial inside a printed from-to pair (g01) and a prefix followed by a number in a
            printed range (g03). Replayed offline, g01 and g03 turn red, g04 green and g07 orange, and nothing moves on the 105 or held out #1. g19 was a harness wait, not a
            matching error: the app never waits on Tavily&apos;s keyless limit, the harness now caps its wait at 30 s, and g19 re-run that way is Checked. USDA FSIS product lists
            (PDFs) are read through Tavily Extract so a UPC and its lot match row by row. Run over all {coverage.notices.toLocaleString("en-US")} CPSC and openFDA notices of
            2026 (in-sample, <a href={`${REPO_URL}/blob/main/scripts/bound-coverage.mts`}>scripts/bound-coverage.mts</a>): the window rule reads one window from{" "}
            {coverage.rules.window.parsed} of the {coverage.rules.window.printsOne} that print a best-by window (the rest print several, which it leaves alone), the serial-range
            rule {coverage.rules.pair.parsed} of {coverage.rules.pair.printsOne}, the family rule {coverage.rules.family.parsed} of {coverage.rules.family.printsOne} (it misses a
            list of serial prefixes).
          </p>
          <ul className={s.wrong}>
            {wrong2.map((c) => (
              <li key={c.id}>
                <p className={s.wrongHead}>
                  <span className="code">{c.id}</span> {c.text} <i data-level={lv2(t2, c.id)}>{TAG_WORDS[lv2(t2, c.id)!]}</i>
                </p>
                {note(`h2:${c.id}`) ? <p>{note(`h2:${c.id}`)}</p> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section} aria-labelledby="held3-h">
          <h2 id="held3-h" className={s.h2}>
            Held out #3: {held3.cases} cases, pre-registered Oct 30, run once
          </h2>
          <p className={s.sub}>
            Written after the fixes above, to test them on recalls they had never seen: four recalls posted Oct 15-29 that bound their codes or dates instead of listing them (a
            made-date window, two windows with a gap, a serial interval, a serial run), each with one unit inside the bound and one outside. Pushed with the tag{" "}
            <a href={`${REPO_URL}/releases/tag/prereg-2026-10-30`}>
              <span className="code">prereg-2026-10-30</span>
            </a>{" "}
            before any run and run once at <span className="code">{h3t.config?.code?.commit}</span>. It came out worse than the first two sets, and it is published as it came out.
          </p>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.stack} ${s.stackB}`}>
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Right</th>
                  <th scope="col">Wrongly red</th>
                  <th scope="col">Recalled items cleared green</th>
                  <th scope="col">Coded recalled units red</th>
                  <th scope="col">Cost per item, Tavily included</th>
                </tr>
              </thead>
              <tbody>
                {held3.arms.map((a) => (
                  <tr key={a.arm} data-us={a.arm === "tagout" || undefined}>
                    <th scope="row">
                      {HELD_NAME[a.arm] ?? a.label}
                      <small>pre-registered arm, run once</small>
                    </th>
                    <td>
                      <b>{a.right}</b>/{a.n}
                    </td>
                    <td>
                      {a.falseRed.length}/{a.falseRedOf}
                    </td>
                    <td>
                      {a.falseClear.length}/{a.falseClearOf}
                    </td>
                    <td>
                      {a.truePositives}/{a.positives}
                    </td>
                    <td>{cents(a.usdPerItemWithTavily)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={s.wrong}>
            {["j2", "j6", "j3", "j7"].map((id) => (
              <li key={id}>
                <p className={s.wrongHead}>
                  <span className="code">{id}</span> {cases3.find((c) => c.id === id)?.text}{" "}
                  <i data-level={(h3t.levels as Record<string, string>)[id]}>{TAG_WORDS[(h3t.levels as Record<string, string>)[id] as TagLevel]}</i>
                </p>
                <p>{note(`h3:${id}`)}</p>
              </li>
            ))}
          </ul>
          <p className={s.sub}>
            Both false alarms come from a code or a date that never reached the matcher: a made-date window in CPSC&apos;s prose that wasn&apos;t read, and a serial the list reader
            dropped. Nothing has been fixed since; these are the next things to fix and to test on a fourth set.
          </p>
        </section>

        <section className={s.section} aria-labelledby="tavily-h">
          <h2 id="tavily-h" className={s.h2}>
            What Tavily does here
          </h2>
          <p className={s.sub}>
            The agency databases trail their own newsrooms by one to six weeks, and USDA&apos;s meat and poultry recalls have no API a server can use. Tavily is how Tagout reads both,
            in every check and in the daily sweep. In numbers:
          </p>
          <dl className={s.facts}>
            <div>
              <dt>Tavily off, same cases and code</dt>
              <dd>
                {lagAbl.withoutTavily.flagged}/{lagAbl.shouldFlag}
              </dd>
              <p>held-out recalls not yet in any database were flagged: all {lagAbl.shouldFlag} were cleared green.</p>
            </div>
            <div>
              <dt>Tavily on</dt>
              <dd>
                {lagAbl.withTavily.flagged}/{lagAbl.shouldFlag}
              </dd>
              <p>
                flagged, {lagAbl.withTavily.red} of them red. Overall Tagout went from {holdout.tavilyAblation.tagout.withoutTavily.right}/39 to{" "}
                {holdout.tavilyAblation.tagout.withTavily.right}/39, and its cleared recalls from 12 to {held.falseClear.length}.
              </p>
            </div>
            <div>
              <dt>Held out #2, the 2 recalls no database had</dt>
              <dd>
                2/2
              </dd>
              <p>
                flagged with Tavily, from pages only Tavily reached: the Pan Pepin allergy recall red on its exact lot and the sprats advisory orange (the next Pan Pepin lot,
                not recalled, green).
                {noweb2
                  ? ` Tavily off (same code, added afterwards): the 2 recalls no database had went 2/2 flagged to 0/2, recalled items cleared green 0 of ${t2.falseClearOf} to ${noweb2.falseClear.length} of ${noweb2.falseClearOf}, and ${t2.right}/19 to ${noweb2.right}/19 overall (g19 was right only without the web, because the keyless waits that timed it out never happened).`
                  : ""}
              </p>
            </div>
            <div>
              <dt>Credits an item, as billed</dt>
              <dd>{(t.tavilyPerItem ?? 0).toFixed(2)}</dd>
              <p>
                on the {summary.cases} at today&apos;s code: {cents(t.tavilyUsdPerItem)} at $0.008 a credit, beside {cents(t.usdPerItem)} of Nemotron.
              </p>
            </div>
          </dl>
          <ul className={s.method}>
            <li>
              <b>Search</b> (<span className="code">/search</span>, basic depth, up to 6 results) with <span className="code">include_domains</span> locked to cpsc.gov, nhtsa.gov,
              fda.gov, fsis.usda.gov, recalls.gov and foodsafety.gov, plus a maker&apos;s own domain when the agent asks, and <span className="code">time_range</span> (week, month or
              year) when it wants only new recalls. The agent calls it as its <span className="code">search_web</span> tool and always runs at least one.
            </li>
            <li>
              <b>Extract</b> (<span className="code">/extract</span>, basic depth, text) reads a recall page in full when the snippet doesn&apos;t show which models or lots are affected:
              the agent&apos;s <span className="code">read_page</span> tool, batched up to five URLs and memoized per item. A long page is read from its dateline, not from its menus.
            </li>
            <li>
              <b>Only through Tavily:</b> FDA company announcements (no openFDA report yet) and USDA FSIS recalls, in the per-check agent and in the daily sweep. A recall only Tavily
              found carries <b>Ahead of the database</b> when the agency had no record of it that day, checked per recall.
            </li>
            <li>
              <b>PDF product lists:</b> FSIS names a recall&apos;s products (SKU, UPC, lot, dates, establishment) only in a linked PDF. Extract reads it and the rows are appended
              to the page, so a UPC and its lot match on the same row (an in-sample probe on Kayem: UPC 030771010182 with its own lot is Do not use, with another product&apos;s
              lot it isn&apos;t). <b>Why basic depth:</b> advanced search with <span className="code">chunks_per_source</span> and <span className="code">include_raw_content</span>{" "}
              was measured on an FDA lot table (h37, h42) and returned no lot either.
            </li>
            <li>
              <b>When credits run out</b> (HTTP 429, 432 or 433) the same call is retried in Tavily&apos;s keyless mode, then the check goes on with the databases only and says so. Held
              out #2 ran entirely in keyless mode.
            </li>
            <li>
              See it: <Link href={`/check/${SHOWCASE.webcatch}`}>three recalls caught on the web before the databases</Link> and{" "}
              <Link href={`/watch/${SHOWCASE.replay}`}>a replayed watch</Link>, two of whose three alerts came from FDA company announcements found this way. Code:{" "}
              <a href={`${REPO_URL}/blob/main/lib/sources/web.ts`}>lib/sources/web.ts</a>.
            </li>
          </ul>
        </section>

        <section className={s.section} aria-labelledby="agent-h">
          <h2 id="agent-h" className={s.h2}>
            Is the agent worth it?
          </h2>
          <p className={s.sub}>
            On unseen cases, only just, and we say so. The full agent (Nemotron 3 Ultra choosing its own searches) is compared with the lite tier, a fixed search plan whose notices
            Nemotron 3 Nano reads, under the same rules.
          </p>
          <ul className={s.claims}>
            <li>
              <span className={s.claimKick}>Held out #1</span>
              The agent got <b>{held.right}</b>, the lite tier <b>{heldLite.right}</b> and the fixed plan with Ultra readers 29. Only the agent got h07 (a brand-less price-tag photo, read by the Qwen3.8 27B fallback after Super VL ran out of its token budget) and
              h43 (the Wedgewood veterinary recall); it was better on the database cases ({held.bySet.database.right}/27 against {heldLite.bySet.database.right}/27) and worse on the
              two USDA lines, which the lite tier&apos;s single web search flagged.
            </li>
            <li>
              <span className={s.claimKick}>Held out #2</span>
              The agent got <b>{t2.right}</b>, the lite tier <b>{lite2.right}</b>. Wrongly red: {t2.falseRed.length} against {lite2.falseRed.length}; recalled units cleared:{" "}
              {t2.falseClear.length} against {lite2.falseClear.length}. Only the agent got g06 (when openFDA found nothing for the UPC with the brand as typed, it searched
              again by brand and product) and g14 (the lite tier&apos;s reader kept a product name as a model code).
            </li>
            <li>
              <span className={s.claimKick}>The cascade</span>
              Lite first, the agent only on a lite red: on held out #1 it scored {heldExtra.cascade.firstRun.right}/39, the same as the lite tier, at{" "}
              {cents(heldExtra.cascade.firstRun.usdPerItemWithTavily)} an item against {cents(heldLite.usdPerItemWithTavily)}. The agent never overturned a lite red there; on the{" "}
              {summary.cases} it overturned one (n12).
            </li>
            <li>
              <span className={s.claimKick}>So the routing is</span>
              The full agent for a first check, when an unknown item is most likely to hide a recall. The daily sweep for re-checks: each new recall read once and matched by rules, so it
              costs nothing per household. The cascade for resale screening: the lite price for every listing, the agent only to confirm a red before it costs a sale.
            </li>
          </ul>
        </section>

        <section className={s.section} aria-labelledby="arms-h">
          <h2 id="arms-h" className={s.h2}>
            The {summary.cases} tuned cases, five ways
          </h2>
          <p className={s.sub}>
            At today&apos;s code ({CODE_NOW}, Oct 30), confirmed by an offline replay of every recorded arm (<span className="code">eval/replay-summary.json</span>); the live arms
            ran Oct 24-25 (Tagout and the lite tier at <span className="code">ed2dc77</span>, the others at <span className="code">a9a0f8f</span>). The model alone
            answers from memory. With Tavily it reads the official recall pages a web search finds, but decides on its own. The fixed plan runs set searches instead of the agent, with
            Nemotron 3 Nano reading the notices and the same rules deciding: that is Tagout&apos;s lite tier. The last uses no model at all. On Oct 15 the same cases gave Tagout{" "}
            {oct15Tagout.right}/{oct15.cases}, the lite tier {oct15.arms.find((a) => a.arm === "fixed-plan-nano")!.right} and rules alone{" "}
            {oct15.arms.find((a) => a.arm === "rules")!.right}; rules fell to {rules.right} once a tag could no longer be green without a model, which turned its 10 cleared recalls
            orange but also seven clean things.
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
            One mark per answer, in the tag&apos;s colour, at today&apos;s code. A crossed mark is a wrong answer. Hover or tap a row for the line that was typed.
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

        <section className={s.section} aria-labelledby="wrong-h">
          <h2 id="wrong-h" className={s.h2}>
            What Tagout got wrong on the tuned cases
          </h2>
          <p className={s.sub}>
            {wrong.length ? `${wrong.length} of ${t.n} answers at today's code. Each one, and why.` : `Nothing at today's code. On Oct 15 it got ${oct15Wrong.length} of ${t.n} wrong:`}
          </p>
          <ul className={s.wrong}>
            {(wrong.length ? wrong : oct15Wrong).map((c) => {
              const lv = (wrong.length ? t.levels : oct15Tagout.levels)[c.id as keyof typeof t.levels] as TagLevel;
              return (
                <li key={c.id}>
                  <p className={s.wrongHead}>
                    <span className="code">{c.id}</span> {c.text} <i data-level={lv}>{TAG_WORDS[lv] ?? lv}</i>
                  </p>
                  {note(c.id) ? <p>{note(c.id)}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>

        {first ? (
          <section className={s.section} aria-labelledby="first-h">
            <h2 id="first-h" className={s.h2}>
              The first run, and what it changed
            </h2>
            <p className={s.sub}>
              The first full run on the {summary.cases}, on Oct 15, got {first.right} of {first.n} right: {first.falseRed.length} units wrongly tagged Do not use and{" "}
              {first.falseClear.length} recalled units cleared. Each miss was traced to its cause and fixed in code, with a unit test. The later numbers are therefore measured on cases
              that shaped the fixes; the held-out sets above are the fairer estimate for things Tagout hasn&apos;t seen.
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
            smaller models for the everyday calls, so every size ran in every role on Oct 15: all 105 cases as the notice reader and the list reader, and an 18-case sample as the
            search agent. Nemotron&apos;s reading decided {(t as { redBasis?: { by?: Record<string, number> } }).redBasis?.by?.["reader-list"] ?? 31} of the {t.truePositives} red
            tags on the {summary.cases} (in-sample); on unseen data, held out #2&apos;s seven Tagout reds came{" "}
            {Object.entries((t2 as { redBasis?: { by?: Record<string, number> } }).redBasis?.by ?? {})
              .map(([k, v]) => `${v} from ${k === "reader-list" ? "the reader's list" : k === "record-list" ? "the record's own list" : "the notice text"}`)
              .join(", ")}
            . The same code with no model got {rules2?.right ?? "–"}/19 there, against Tagout&apos;s {t2.right}/19. Nemotron 3.5 Super VL reads label photos: 7 of 7 codes on two
            made-up sample labels; on CPSC&apos;s real price-tag photo (h07) it ran out of its 2,500-token budget and the Qwen3.8 27B fallback read it (with 6,000 tokens it reads
            it, in-sample).
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Models (Oct 15 run)</th>
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
          {note("routing") ? <p className={s.routing}>{note("routing")}</p> : null}
        </section>

        <section className={s.section} aria-labelledby="method-h">
          <h2 id="method-h" className={s.h2}>
            How it was measured, and what it can&apos;t show
          </h2>
          <ul className={s.method}>
            <li>
              Cases come from CPSC recalls of 2025–26 (SaferProducts.gov), openFDA enforcement reports and NHTSA&apos;s recall API. <span className="code">eval/verify.mjs</span>,{" "}
              <span className="code">verify-holdout.mjs</span> and <span className="code">verify-holdout2.mjs</span> check each one against the agency record without any Tagout code:
              a recalled code must be printed in its notice (or inside its printed range, family or window); a near miss must not be printed in that notice or in any CPSC or FDA record
              of the same brand.
            </li>
            <li>
              Each arm ran each case once. Model answers vary between runs; this is one sample, not an average. Every HTTP response was cached, so all arms read the same agency data and
              the whole run can be replayed for free: download the scrubbed <a href={`${REPO_URL}/releases/download/eval-2026-10-25/eval-cache.tgz`}>cache archive</a> (5.2 MB), unpack
              it in the repo and run <span className="code">npm run eval:replay</span>.
            </li>
            <li>
              Small sets: {held2.cases} cases give wide intervals ({t2.right}/{t2.n} is {pct(t2.rightInterval[0])}–{pct(t2.rightInterval[1])}). Held out #2 ran with Tavily in keyless
              mode, whose hourly cap made some checks wait past their deadline; HOLDOUT.md lists which.
            </li>
            <li>
              We chose the cases. Recalled units come from recent notices that print a code, which is the case Tagout is built for; a product whose notice prints no code can only ever
              be orange.
            </li>
            <li>Cost is tokens times Token Factory&apos;s list prices ($1/$3 per million for Ultra, $0.30/$0.90 for Super and for Super VL, $0.45/$3 for Qwen3.8 27B, $0.10/$0.30 for Gemma 3 27B, $0.06/$0.24 for Nano). Tavily credits are priced at $0.008 each, pay-as-you-go. Agency APIs are free.</li>
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

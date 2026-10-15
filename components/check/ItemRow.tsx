"use client";

import { useState } from "react";
import type { CheckRecord } from "@/lib/checks";
import type { Item, Proof, Verdict } from "@/lib/types";
import { AGENCY, fmtDate, fmtUnits, noticeRef, plural } from "@/lib/format";
import Tagged from "@/components/tag/Tagged";
import s from "./row.module.css";

type LogEntry = NonNullable<CheckRecord["log"]>[number];

const FIELD: Record<Proof["field"], string> = {
  model: "Model or code",
  lot: "Lot",
  vin: "VIN",
  upc: "UPC",
  year: "Model year",
  make: "Make",
  product: "Model",
  made: "Made",
};

/** One thing the household owns: its label with the tag, the agent's searches, and the proof behind the tag. */
export default function ItemRow({ item, verdict, log, running, swing }: { item: Item; verdict?: Verdict; log: LogEntry[]; running: boolean; swing: boolean }) {
  const [showLog, setShowLog] = useState(false);
  const marks: Partial<Record<Proof["field"], "match" | "miss" | "reading">> = {};
  if (verdict) for (const p of verdict.proof) marks[p.field] = p.matched ? (verdict.level === "danger" ? "match" : undefined) : "miss";
  else if (running) for (const f of ["model", "lot", "vin", "upc"] as const) marks[f] = "reading";

  const steps = log.filter((l): l is Extract<LogEntry, { t: "step" }> => l.t === "step");
  const reads = log.filter((l): l is Extract<LogEntry, { t: "read" }> => l.t === "read");
  const struck = reads.flatMap((r) => r.struck.filter((x) => x.length < 40));
  const n = verdict?.notice;
  const logOpen = !verdict || showLog;

  return (
    <li className={s.row} data-level={verdict?.level ?? "pending"}>
      <div className={s.left}>
        <p className={s.said}>
          {item.said}
          {item.readFrom === "photo" ? <span className={s.from}>read from your photo</span> : item.readFrom === "vin" ? <span className={s.from}>decoded from the VIN</span> : null}
        </p>
        <div className={s.tagWrap}>
          <Tagged item={item} level={verdict?.level} marks={marks} hits={verdict?.proof.filter((p) => p.matched).map((p) => p.yours)} swing={swing} size="md" dx={64} dy={44} rest={verdict?.level === "danger" ? -4 : verdict?.level === "warning" ? 3 : -2} foot={verdict ? `Checked ${fmtDate(verdict.checkedAt)}` : undefined}>
            {verdict ? (
              <>
                <b className={s.tagHead}>{verdict.headline}</b>
                {n ? <span className={s.tagRef}>{noticeRef(n)}</span> : null}
              </>
            ) : null}
          </Tagged>
        </div>
      </div>

      <div className={s.right}>
        {verdict ? (
          <button type="button" className={s.logToggle} aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            {plural(steps.length, "search", "searches")}
            {reads.length ? `, ${plural(reads.length, "notice")} read` : ""}
            <span aria-hidden="true">{showLog ? "−" : "+"}</span>
          </button>
        ) : null}
        {logOpen ? (
          <ol className={s.log} aria-label="What the agent did">
            {steps.map((l, i) => (
              <li key={i} className={s.step} data-error={l.step.error ? "" : undefined}>
                <span className={s.agency} data-source={l.step.source}>
                  {l.step.tool === "read_page" ? "Page" : AGENCY[l.step.source]}
                </span>
                <span className={s.stepText}>{l.step.label}</span>
                <span className={s.found}>{foundText(l.step)}</span>
              </li>
            ))}
            {reads.map((r, i) => (
              <li key={`r${i}`} className={s.step}>
                <span className={s.agency} data-source="read">
                  List
                </span>
                <span className={s.stepText}>
                  Read the affected models and lots in {r.source === "web" ? "a web notice" : `${AGENCY[r.source as keyof typeof AGENCY] ?? ""} ${r.noticeId}`}
                </span>
                <span className={s.found}>{r.codes ? plural(r.codes, "code") : "no codes"}</span>
              </li>
            ))}
            {running ? (
              <li className={`${s.step} ${s.working}`}>
                <span className={s.dots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className={s.stepText}>{steps.length ? "Reading what came back" : "Planning the searches"}</span>
              </li>
            ) : null}
          </ol>
        ) : null}

        {verdict ? <Detail verdict={verdict} struck={struck} /> : null}
      </div>
    </li>
  );
}

function Detail({ verdict, struck }: { verdict: Verdict; struck: string[] }) {
  const n = verdict.notice;
  return (
    <div className={s.detail}>
      {verdict.proof.length ? (
        <table className={s.proof}>
          <caption className="sr-only">Your codes compared with the recall</caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Yours</th>
              <th scope="col">{n ? noticeRef(n) : "The recall"}</th>
            </tr>
          </thead>
          <tbody>
            {verdict.proof.map((p, i) => (
              <tr key={i} data-matched={p.matched}>
                <th scope="row">{FIELD[p.field]}</th>
                <td className="code">{p.yours}</td>
                <td>
                  <span className={s.mark} aria-label={p.matched ? "matches" : "doesn't match"}>
                    {p.matched ? "=" : "≠"}
                  </span>
                  <span className="code">{p.theirs}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {n ? (
        <article className={s.notice}>
          {n.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.noticeImg} src={n.image} alt="" referrerPolicy="no-referrer" loading="lazy" />
          ) : null}
          <div className={s.noticeBody}>
            <a className={s.noticeTitle} href={n.url} target="_blank" rel="noreferrer">
              {n.title}
            </a>
            <p className={s.noticeMeta}>
              {noticeRef(n)}
              {n.date ? `, ${fmtDate(n.date)}` : ""}
              {n.units ? `. ${fmtUnits(n.units)}` : ""}
            </p>
            {n.hazard ? <p className={s.hazard}>{n.hazard}</p> : null}
            {n.source === "web" ? <WebNote n={n} checkedAt={verdict.checkedAt} /> : null}
          </div>
        </article>
      ) : null}

      <h3 className={s.h3}>What to do</h3>
      <ol className={s.steps}>
        {verdict.steps.map((x, i) => (
          <li key={i}>{linkify(x)}</li>
        ))}
      </ol>

      {struck.length ? (
        <p className={s.struck}>
          Struck {plural(struck.length, "code")} the reader listed that the notice doesn&apos;t print: <span className="code">{struck.slice(0, 4).join(", ")}</span>
        </p>
      ) : null}

      {verdict.related?.length ? (
        <details className={s.related}>
          <summary>{plural(verdict.related.length, "other recall")} for this brand</summary>
          <ul>
            {verdict.related.map((r) => (
              <li key={`${r.source}${r.id}${r.url}`}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                <span>
                  {noticeRef(r)}
                  {r.date ? `, ${fmtDate(r.date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** A recall that reached this check only through Tavily: say where it was found, and when the database lagged. */
function WebNote({ n, checkedAt }: { n: NonNullable<Verdict["notice"]>; checkedAt: string }) {
  let host = "the web";
  try {
    host = new URL(n.url).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <p className={s.webNote}>
      <span className={s.webBadge}>{n.notInDb ? "Ahead of the database" : "Found by Tavily"}</span>
      {n.notInDb === "cpsc"
        ? `Tavily found this notice on ${host}. CPSC's recall database didn't return it on ${fmtDate(checkedAt)}, so only the web search could catch it.`
        : n.notInDb === "fda"
          ? `Tavily found this company announcement on ${host}. FDA's enforcement reports (openFDA) had nothing from this firm in the 90 days before ${fmtDate(checkedAt)}, so only the web search could catch it.`
          : /fsis\.usda\.gov$/.test(host)
          ? `Tavily found this notice on ${host}. USDA's recall API turns away automated clients, so the web search is the only way to reach meat and poultry recalls.`
          : `Tavily found this notice on ${host}.`}
    </p>
  );
}

/**
 * What a search returned. A Tavily page about a recall the agency database already returned is the same recall,
 * so "6 found, 2 new" says Tavily confirmed four and added two. Checks saved before Oct 15 have no `fresh` count.
 */
function foundText(step: Extract<LogEntry, { t: "step" }>["step"]): string {
  if (step.error) return "didn't answer";
  if (step.tool === "read_page") return "read";
  if (!step.found) return "none";
  if (step.fresh === undefined || step.fresh === step.found) return `${step.found} found`;
  return `${step.found} found, ${step.fresh} new`;
}

/** Turns bare site names in a step ("nhtsa.gov/recalls", "recalls.vornado.com") into links. */
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|gov|org|net)(?:\/[^\s,;)]*)?)/gi);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p;
    const url = p.replace(/\.$/, "");
    return (
      <span key={i}>
        <a href={url.startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer">
          {url}
        </a>
        {p.endsWith(".") ? "." : ""}
      </span>
    );
  });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckRecord } from "@/lib/checks";
import { diffChecks, type Change, type WatchRecord } from "@/lib/watch";
import { fmtDate, plural } from "@/lib/format";
import { TAG_WORDS } from "@/components/tag/Tag";
import CheckRoom, { rememberWatch } from "@/components/check/CheckRoom";
import s from "./watch.module.css";

type Pub = Omit<CheckRecord, "photos">;

const KIND: Record<Change["kind"], string> = {
  worse: "Tag got worse",
  "new-recall": "New recall listed",
  "new-item": "Checked for the first time",
  better: "Tag got better",
};

/**
 * A watched household. When the newest check is more than a day old, opening the page runs the list again
 * (one check, shared by everyone holding the link), then shows what changed between the last two checks.
 */
export default function WatchRoom({ watch, checks: initial, due }: { watch: WatchRecord; checks: Pub[]; due: boolean }) {
  const [checks, setChecks] = useState<Pub[]>(initial);
  const [state, setState] = useState<"idle" | "starting" | "error">(due ? "starting" : "idle");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    rememberWatch(watch.id);
    if (!due || started.current) return;
    started.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/watches/${watch.id}/recheck`, { method: "POST" });
        const j = (await r.json()) as { checkId?: string };
        if (!r.ok || !j.checkId) throw new Error();
        if (!checks.some((c) => c.id === j.checkId)) {
          const c = await fetch(`/api/checks/${j.checkId}`, { cache: "no-store" });
          if (!c.ok) throw new Error();
          const rec = (await c.json()) as Pub;
          setChecks((cs) => [...cs, rec]);
        }
        setState("idle");
      } catch {
        setState("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finished = useCallback((rec: Pub) => setChecks((cs) => cs.map((c) => (c.id === rec.id ? rec : c))), []);

  const latest = checks.at(-1);
  const done = checks.filter((c) => c.status === "done");
  const [prev, last] = [done.at(-2), done.at(-1)];
  const changes = prev && last ? diffChecks(prev, last) : null;
  const running = latest && latest.status !== "done" && latest.status !== "failed";
  const lines = watch.text.split("\n").filter((l) => l.trim()).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <main className={s.main}>
      <header className={s.top}>
        <p className={s.kicker}>Watch</p>
        <h1 className={s.h1}>Watching {plural(lines, "thing")}.</h1>
        <p className={s.meta}>
          Started {fmtDate(watch.createdAt)}. {plural(checks.length, "check")} so far
          {done.at(-1) ? `, the last on ${fmtDate(done.at(-1)!.finishedAt ?? done.at(-1)!.createdAt)}` : ""}.
        </p>
        <div className={s.how}>
          <p>
            <b>How a watch works.</b> Each time this link is opened, Tagout runs the list again if the last check is more than a day old, then shows what changed since the check
            before. Nothing runs in the background and nothing is emailed yet, so keep the link and open it now and then.
          </p>
          <button type="button" className={s.copy} onClick={copy} aria-live="polite">
            {copied ? "Link copied" : "Copy the watch link"}
          </button>
        </div>
      </header>

      <section className={s.since} aria-labelledby="since-h" aria-live="polite">
        <h2 id="since-h" className={s.h2}>
          {state === "starting" ? "Checking again…" : running ? "Checking again…" : prev && last ? `What changed since ${fmtDate(prev.finishedAt ?? prev.createdAt)}` : "The first check"}
        </h2>
        {state === "error" ? (
          <p className={s.note} role="alert">
            The list couldn&apos;t be checked again just now. The last check is below; reload the page in a minute to try again.
          </p>
        ) : state === "starting" || running ? (
          <p className={s.note}>
            The last check was on {fmtDate(done.at(-1)?.finishedAt ?? done.at(-1)?.createdAt)}, more than a day ago, so the list is being checked again. The new tags are hung below as
            they&apos;re decided.
          </p>
        ) : changes ? (
          changes.length ? (
            <ul className={s.changes}>
              {changes.map((c, i) => (
                <li key={i} data-to={c.to} data-kind={c.kind}>
                  <span className={s.kind}>{KIND[c.kind]}</span>
                  <span className={s.said}>{c.said}</span>
                  <span className={s.move}>
                    {c.from && c.from !== c.to ? (
                      <>
                        <i data-level={c.from}>{TAG_WORDS[c.from]}</i> →{" "}
                      </>
                    ) : null}
                    <i data-level={c.to}>{TAG_WORDS[c.to]}</i>
                  </span>
                  {c.notices.length ? (
                    <span className={s.refs}>
                      {c.notices.slice(0, 3).map((n) => (
                        <a key={n.ref + n.url} href={n.url} target="_blank" rel="noreferrer" title={n.title}>
                          {n.ref.startsWith("WEB ") ? n.ref.slice(4) : n.ref}
                        </a>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.note}>
              Nothing new since {fmtDate(prev!.finishedAt ?? prev!.createdAt)}: the same {plural(last!.verdicts?.length ?? 0, "tag")}, and no recall listed that wasn&apos;t there
              before.
            </p>
          )
        ) : (
          <p className={s.note}>This is the list&apos;s first check. Open this link again after a day and Tagout will check it again and list what changed here.</p>
        )}
      </section>

      {latest ? <CheckRoom key={latest.id} initial={latest} onDone={finished} embedded /> : null}
    </main>
  );
}

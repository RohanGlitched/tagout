"use client";

import { useCallback, useEffect, useState } from "react";
import type { CheckRecord } from "@/lib/checks";
import { diffChecks, type WatchChange, type WatchRecord } from "@/lib/watch";
import type { WatchEvent } from "@/lib/sweep/events";
import type { WatchFeed } from "@/lib/sweep/view";
import { fmtDate, plural } from "@/lib/format";
import { TAG_WORDS } from "@/components/tag/Tag";
import CheckRoom, { rememberWatch } from "@/components/check/CheckRoom";
import s from "./watch.module.css";

type Pub = Omit<CheckRecord, "photos">;

const CHANGE: Record<WatchChange["kind"], string> = {
  worse: "Tag got worse",
  "new-recall": "New recall listed",
  "cited-changed": "Another recall now leads",
  "recall-dropped": "Recall no longer cited",
  "new-item": "Checked for the first time",
  better: "Tag got better",
};

const EVENT: Record<WatchEvent["kind"], string> = {
  "new-recall": "New recall",
  "recall-changed": "Recall changed",
  "recall-dropped": "Recall withdrawn",
  "tag-changed": "Tag changed",
};

const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/**
 * A watched household. A daily sweep reads every new recall once and matches it against this list by rules; what
 * it finds is listed here and in the watch's Atom feed. Opening the page runs nothing; "Check again now" queues a
 * fresh check of the whole list (at most hourly) and shows what changed since the one before.
 */
export default function WatchRoom({ watch, checks: initial, feed }: { watch: WatchRecord; checks: Pub[]; feed: WatchFeed }) {
  const [checks, setChecks] = useState<Pub[]>(initial);
  const [again, setAgain] = useState<{ state: "idle" | "starting" | "error" | "later"; nextAt?: string | null }>({ state: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => rememberWatch(watch.id), [watch.id]);

  const finished = useCallback((rec: Pub) => setChecks((cs) => cs.map((c) => (c.id === rec.id ? rec : c))), []);

  async function checkAgain() {
    setAgain({ state: "starting" });
    try {
      const r = await fetch(feed.recheck.url, { method: "POST" });
      const j = (await r.json()) as { checkId?: string; created?: boolean; nextAt?: string | null };
      if (!r.ok || !j.checkId) throw new Error();
      if (!j.created) {
        setAgain({ state: "later", nextAt: j.nextAt });
        return;
      }
      const c = await fetch(`/api/checks/${j.checkId}`, { cache: "no-store" });
      if (!c.ok) throw new Error();
      const rec = (await c.json()) as Pub;
      setChecks((cs) => [...cs, rec]);
      setAgain({ state: "idle" });
    } catch {
      setAgain({ state: "error" });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const latest = checks.at(-1);
  const done = checks.filter((c) => c.status === "done");
  const [prev, last] = [done.at(-2), done.at(-1)];
  const changes = prev && last ? diffChecks(prev, last, { all: true }) : null;
  const running = latest && latest.status !== "done" && latest.status !== "failed";
  const lines = watch.text.split("\n").filter((l) => l.trim()).length;
  const sweep = feed.lastSweep;

  return (
    <main className={s.main}>
      <header className={s.top}>
        <div className={s.title}>
          <h1 className={s.h1}>Watching {plural(lines, "thing")}.</h1>
          <p className={s.meta}>
            Saved {fmtDate(watch.createdAt)}. Every new recall from CPSC, the FDA, NHTSA and USDA is compared with this list {feed.schedule.label}
            {sweep ? `; the last run, ${time(sweep.at)}, checked ${sweep.recallsChecked.toLocaleString("en-US")} recalls` : ""}.
          </p>
        </div>
        <div className={s.actions}>
          <a className={s.feedBtn} href={feed.feedUrl}>
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 13.5a1 1 0 1 0 0-.01M2.5 7.5a6 6 0 0 1 6 6M2.5 2.5a11 11 0 0 1 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Subscribe to alerts
          </a>
          <button type="button" className={s.ghost} onClick={copy} aria-live="polite">
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button type="button" className={s.ghost} onClick={checkAgain} disabled={again.state === "starting" || Boolean(running)}>
            {again.state === "starting" || running ? "Checking…" : "Check again now"}
          </button>
        </div>
      </header>

      <section className={s.block} aria-labelledby="alerts-h">
        <h2 id="alerts-h" className={s.h2}>
          Alerts
        </h2>
        {feed.events.length ? (
          <ol className={s.events}>
            {feed.events.map((e) => (
              <li key={e.id} id={e.id} className={s.event} data-level={e.level}>
                <span className={s.chip} data-level={e.level}>
                  {TAG_WORDS[e.level]}
                </span>
                <div className={s.eventBody}>
                  <p className={s.eventHead}>
                    <b>{EVENT[e.kind]}</b> for {e.item.said}
                  </p>
                  <p>{e.headline}</p>
                  {e.notice ? (
                    <a href={e.notice.url} target="_blank" rel="noreferrer" className={s.notice}>
                      {e.notice.ref}: {e.notice.title}
                    </a>
                  ) : null}
                  {e.dropped?.length ? <p className={s.dim}>No longer cited: {e.dropped.map((d) => d.ref).join(", ")}</p> : null}
                </div>
                <time className={s.when} dateTime={e.at}>
                  {fmtDate(e.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.empty}>
            No new recall has touched this list{sweep ? ` as of ${time(sweep.at)}` : " yet"}. When one names a brand or a code on it, it is read, matched by the same rules as a
            check, and listed here and in the feed.
          </p>
        )}
        {again.state === "error" ? (
          <p className={s.note} role="alert">
            Tagout couldn&apos;t queue a new check just now. Try again in a minute.
          </p>
        ) : again.state === "later" ? (
          <p className={s.note}>
            This list was checked recently. The next check can start {again.nextAt ? time(again.nextAt) : "later"}
            {feed.recheck.tier === "lite" ? "; this example list runs on the lite tier" : ""}.
          </p>
        ) : null}
      </section>

      {changes ? (
        <section className={s.block} aria-labelledby="since-h" aria-live="polite">
          <h2 id="since-h" className={s.h2}>
            Since the check before, on {fmtDate(prev!.finishedAt ?? prev!.createdAt)}
          </h2>
          {changes.length ? (
            <ul className={s.changes}>
              {changes.map((c, i) => (
                <li key={i} data-to={c.to} data-kind={c.kind}>
                  <span className={s.kind}>{CHANGE[c.kind]}</span>
                  <span className={s.said}>{c.said}</span>
                  <span className={s.move}>
                    {c.from && c.from !== c.to ? (
                      <>
                        <i data-level={c.from}>{TAG_WORDS[c.from]}</i> to{" "}
                      </>
                    ) : null}
                    <i data-level={c.to}>{TAG_WORDS[c.to]}</i>
                  </span>
                  {c.notices.length || c.before || c.dropped.length ? (
                    <span className={s.refs}>
                      {c.before ? <span className={s.dim}>was {c.before.ref}</span> : null}
                      {c.notices.slice(0, 3).map((n) => (
                        <a key={n.ref + n.url} href={n.url} target="_blank" rel="noreferrer" title={n.title}>
                          {n.ref.startsWith("WEB ") ? n.ref.slice(4) : n.ref}
                        </a>
                      ))}
                      {c.dropped.length ? <span className={s.dim}>dropped {c.dropped.map((d) => d.ref).join(", ")}</span> : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.empty}>Nothing changed: the same {plural(last!.verdicts?.length ?? 0, "tag")}, citing the same recalls.</p>
          )}
        </section>
      ) : null}

      {latest ? <CheckRoom key={latest.id} initial={latest} onDone={finished} embedded /> : null}
    </main>
  );
}

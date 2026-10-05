"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./form.module.css";

export type Example = { label: string; text: string };

const MAX_PHOTOS = 3;

/** Shrinks a photo to at most 1280px on its long side as JPEG, so a phone picture uploads quickly. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/**
 * What do you own? One thing per line, or a photo of a label. Sends it off and opens the check, where the
 * agent's work streams in.
 */
export default function CheckForm({ examples, compact = false }: { examples: Example[]; compact?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // "I might own this" on the recalls page arrives as ?own=…: start the list with it and add a model line hint.
  useEffect(() => {
    const own = new URLSearchParams(window.location.search).get("own");
    if (!own) return;
    setText(`${own.slice(0, 200)}, model `);
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const lines = text.split("\n").filter((l) => l.trim()).length;
  const ready = lines > 0 || photos.length > 0;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
      const urls = await Promise.all(picked.map(shrink));
      setPhotos((p) => [...p, ...urls].slice(0, MAX_PHOTOS));
    } catch {
      setError("That photo couldn't be read. Try a JPEG or PNG.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!ready) {
      setError("Type one thing you own, tap an example, or add a photo of a label.");
      boxRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/checks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, photos }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error || "The check couldn't start. Try again in a moment.");
      router.push(`/check/${j.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className={`${s.form} ${compact ? s.compact : ""}`} onSubmit={submit}>
      <label htmlFor="owned" className={s.ask}>
        What do you own? One thing per line.
      </label>
      <textarea
        id="owned"
        ref={boxRef}
        className={s.box}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        rows={compact ? 3 : 4}
        maxLength={1200}
        placeholder={"2019 Honda CR-V\nGraco car seat, model 2074735\nSpace heater, Lasko CT22425"}
        spellCheck={false}
      />
      {photos.length ? (
        <ul className={s.photos} aria-label="Label photos">
          {photos.map((p, i) => (
            <li key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`Label photo ${i + 1}`} />
              <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={s.examples}>
        <span className={s.try}>Try:</span>
        {examples.map((x) => (
          <button key={x.label} type="button" className={s.chip} onClick={() => {
              setError(null);
              setText((t) => (t.trim() ? `${t.trim()}\n${x.text}` : x.text));
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className={s.actions}>
        <button type="submit" className={s.go} disabled={busy}>
          {busy ? "Starting the check…" : "Check my things"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        <button type="button" className={s.photo} onClick={() => fileRef.current?.click()} disabled={photos.length >= MAX_PHOTOS || busy}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          Photo of a label
        </button>
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

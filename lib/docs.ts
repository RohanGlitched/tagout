import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { storage, storageKind } from "./storage";

/**
 * Small JSON documents next to the checks: the notice-read cache, each watch's event log, the sweep's state and
 * run logs. In the configured store (GCS or Blob) when there is one, else as files under .data/. Every key is put
 * under SWEEP_PREFIX (e.g. "sweep-test/") when set, so a trial run never touches production documents.
 */
const LOCAL = path.join(process.cwd(), ".data");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function docPrefix(): string {
  const p = (process.env.SWEEP_PREFIX ?? "").trim().replace(/^\/+/, "");
  return p && !p.endsWith("/") ? `${p}/` : p;
}

export const docKey = (k: string) => `${docPrefix()}${k}`;

const localPath = (key: string) => path.join(LOCAL, ...key.split("/"));

export async function readDoc<T>(key: string): Promise<{ value: T; etag?: string } | null> {
  const s = storage();
  if (!s) {
    try {
      return { value: JSON.parse(await fs.readFile(localPath(key), "utf8")) as T };
    } catch {
      return null;
    }
  }
  const r = await s.read(key);
  return r ? { value: JSON.parse(r.text) as T, etag: r.etag } : null;
}

/** Writes a document; with `ifMatch`, only if it hasn't changed since it was read ("0": only if it doesn't exist, GCS). */
export async function writeDoc(key: string, value: unknown, opts: { ifMatch?: string } = {}): Promise<void> {
  const s = storage();
  if (!s) {
    await fs.mkdir(path.dirname(localPath(key)), { recursive: true });
    await fs.writeFile(localPath(key), JSON.stringify(value, null, 2));
    return;
  }
  await s.write(key, JSON.stringify(value), { ifMatch: opts.ifMatch });
}

/**
 * Read-modify-write with a version check, retried with backoff; `fn` returns the new value, or null to leave the
 * document alone. Returns what was written (or null).
 */
export async function updateDoc<T>(key: string, init: () => T, fn: (cur: T) => T | null): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await readDoc<T>(key);
    const next = fn(cur ? cur.value : init());
    if (!next) return null;
    try {
      // A document that doesn't exist yet is created only if nobody else created it meanwhile (GCS).
      await writeDoc(key, next, { ifMatch: cur ? cur.etag : storageKind() === "gcs" ? "0" : undefined });
      return next;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 200));
    }
  }
  return null;
}

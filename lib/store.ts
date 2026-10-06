import "server-only";
import { get, list, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHECK_ID, type CheckRecord } from "./checks";

/**
 * One JSON document per check: a private Vercel Blob in production (written with an ETag check), a file under
 * .data/ locally. Blob ETags can lag after an overwrite, so updates retry with backoff and write unconditionally
 * on the last try rather than lose a result.
 */
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const LOCAL_DIR = path.join(process.cwd(), ".data", "checks");
const key = (id: string) => `checks/${id}.json`;

async function readRaw(id: string): Promise<{ rec: CheckRecord; etag?: string } | null> {
  if (!CHECK_ID.test(id)) return null;
  if (!useBlob()) {
    try {
      return { rec: JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) };
    } catch {
      return null;
    }
  }
  const r = await get(key(id), { access: "private", useCache: false }).catch(() => null);
  if (!r?.stream) return null;
  // larger (compressed) reads come back with a weak ETag, W/"…"; If-Match needs the strong form or it never matches
  return { rec: JSON.parse(await new Response(r.stream).text()) as CheckRecord, etag: r.blob.etag?.replace(/^W\//, "") };
}

async function writeRaw(rec: CheckRecord, etag?: string): Promise<void> {
  if (!useBlob()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${rec.id}.json`), JSON.stringify(rec, null, 2));
    return;
  }
  await put(key(rec.id), JSON.stringify(rec), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export async function loadCheck(id: string): Promise<CheckRecord | null> {
  return (await readRaw(id))?.rec ?? null;
}

export async function saveCheck(rec: CheckRecord): Promise<void> {
  await writeRaw(rec);
}

/** Read-modify-write. `fn` returns the new record, or null to leave it alone. Returns what was written, or null. */
export async function updateCheck(id: string, fn: (rec: CheckRecord) => CheckRecord | null): Promise<CheckRecord | null> {
  const ATTEMPTS = 5;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const cur = await readRaw(id);
    if (!cur) return null;
    const next = fn(structuredClone(cur.rec));
    if (!next) return null;
    const last = attempt === ATTEMPTS - 1;
    try {
      await writeRaw(next, last ? undefined : cur.etag);
      return next;
    } catch (e) {
      if (last) throw new Error(`Couldn't save the check (${(e as Error).message}).`);
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 150));
    }
  }
  return null;
}

/** The curated checks flagged for the home page, newest first. */
export async function showcaseChecks(): Promise<CheckRecord[]> {
  let ids: string[] = [];
  if (!useBlob()) {
    ids = (await fs.readdir(LOCAL_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } else {
    const page = await list({ prefix: "showcase/", limit: 50 });
    ids = page.blobs.map((b) => b.pathname.slice(9, -5));
  }
  const recs = (await Promise.all(ids.map((id) => loadCheck(id).catch(() => null)))).filter((r): r is CheckRecord => Boolean(r?.showcase && r.status === "done"));
  return recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Marks a check as a home-page example (an empty marker blob, so listing stays cheap). */
export async function markShowcase(id: string): Promise<void> {
  await updateCheck(id, (r) => ({ ...r, showcase: true }));
  if (useBlob()) await put(`showcase/${id}.json`, "{}", { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

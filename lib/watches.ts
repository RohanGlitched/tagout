import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHECK_ID } from "./checks";
import { storage } from "./storage";
import type { WatchRecord } from "./watch";

/** Watches are stored like checks: one JSON document each, in the configured store or under .data/ locally. */
const LOCAL_DIR = path.join(process.cwd(), ".data", "watches");
const key = (id: string) => `watches/${id}.json`;

async function readRaw(id: string): Promise<{ rec: WatchRecord; etag?: string } | null> {
  if (!CHECK_ID.test(id)) return null;
  const s = storage();
  if (!s) {
    try {
      return { rec: JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) };
    } catch {
      return null;
    }
  }
  const r = await s.read(key(id)).catch(() => null);
  return r ? { rec: JSON.parse(r.text) as WatchRecord, etag: r.etag } : null;
}

async function writeRaw(rec: WatchRecord, etag?: string): Promise<void> {
  const s = storage();
  if (!s) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${rec.id}.json`), JSON.stringify(rec, null, 2));
    return;
  }
  await s.write(key(rec.id), JSON.stringify(rec), { ifMatch: etag });
}

export async function loadWatch(id: string): Promise<WatchRecord | null> {
  return (await readRaw(id))?.rec ?? null;
}

export async function saveWatch(rec: WatchRecord): Promise<void> {
  await writeRaw(rec);
}

/** Read-modify-write with a version check, retried, so two visitors re-checking at once add one check, not two. */
export async function updateWatch(id: string, fn: (rec: WatchRecord) => WatchRecord | null): Promise<WatchRecord | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readRaw(id);
    if (!cur) return null;
    const next = fn(structuredClone(cur.rec));
    if (!next) return null;
    try {
      await writeRaw(next, cur.etag);
      return next;
    } catch {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 150));
    }
  }
  return null;
}

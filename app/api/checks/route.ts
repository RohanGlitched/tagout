import { NextResponse } from "next/server";
import { newCheckId, type CheckRecord } from "@/lib/checks";
import { saveCheck } from "@/lib/store";
import { clientIp } from "@/lib/visitor";

export const runtime = "nodejs";

const WINDOW = 10 * 60_000;
const LIMIT = 10;
const recent = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW);
  if (list.length >= LIMIT) return false;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < WINDOW)) recent.delete(k);
  return true;
}

const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Starts a check: stores what was typed and any label photos, and returns the id. The page then runs it. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; photos?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.slice(0, 1200) : "";
  const photos = Array.isArray(body?.photos) ? body!.photos.filter((p): p is string => typeof p === "string" && PHOTO.test(p) && p.length < 900_000).slice(0, 3) : [];
  if (!text.trim() && !photos.length) return NextResponse.json({ error: "Add at least one thing you own, or a photo of a label." }, { status: 400 });
  if (!allowed(await clientIp())) return NextResponse.json({ error: "That's a lot of checks in a few minutes. Try again in ten minutes." }, { status: 429 });
  const rec: CheckRecord = { id: newCheckId(), createdAt: new Date().toISOString(), status: "queued", input: { text: text.trim(), photoCount: photos.length }, photos };
  await saveCheck(rec);
  return NextResponse.json({ id: rec.id });
}

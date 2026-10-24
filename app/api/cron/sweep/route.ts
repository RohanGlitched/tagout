import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runSweep } from "@/lib/sweep/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily recall sweep (vercel.json: "0 6 * * *"). Vercel Cron calls it with "Authorization: Bearer
 * $CRON_SECRET"; without CRON_SECRET set the route refuses to run, so nobody else can spend the model budget.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? ""), want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const report = await runSweep({ deadlineMs: 240_000 });
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[cron] sweep failed", e);
    return NextResponse.json({ error: "The sweep failed; see the function log." }, { status: 500 });
  }
}

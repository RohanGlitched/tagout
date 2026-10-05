import { NextResponse } from "next/server";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await loadCheck((await params).id);
  if (!rec) return NextResponse.json({ error: "No check with that link." }, { status: 404 });
  return NextResponse.json(publicCheck(rec), { headers: { "cache-control": "no-store" } });
}

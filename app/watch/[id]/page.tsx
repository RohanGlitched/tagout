import { notFound } from "next/navigation";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import WatchRoom from "@/components/watch/WatchRoom";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";
import { loadWatch } from "@/lib/watches";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  return { title: w ? "Watched things" : "Watch not found", robots: { index: false } };
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  if (!w) notFound();
  // The checks this watch has run, newest last; the page compares the newest finished one with the one before.
  const recs = (await Promise.all(w.checks.slice(-6).map((c) => loadCheck(c.id).catch(() => null)))).filter((r) => r !== null);
  return (
    <>
      <Header />
      {/* Opening a watch never starts a check: the daily sweep does the looking (lib/sweep), and "check again now"
          is the page's own button (POST /api/watches/<id>/recheck). due={false} keeps the old auto-run off. */}
      <WatchRoom watch={w} checks={recs.map(publicCheck)} due={false} />
      <Footer />
    </>
  );
}

import { notFound } from "next/navigation";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import WatchRoom from "@/components/watch/WatchRoom";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";
import { due } from "@/lib/watch";
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
      <WatchRoom watch={w} checks={recs.map(publicCheck)} due={due(w)} />
      <Footer />
    </>
  );
}

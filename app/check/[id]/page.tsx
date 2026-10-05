import { notFound } from "next/navigation";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import CheckRoom from "@/components/check/CheckRoom";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const rec = await loadCheck((await params).id);
  return { title: rec ? "Your check" : "Check not found", robots: { index: false } };
}

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = await loadCheck((await params).id);
  if (!rec) notFound();
  return (
    <>
      <Header />
      <CheckRoom initial={publicCheck(rec)} />
      <Footer />
    </>
  );
}

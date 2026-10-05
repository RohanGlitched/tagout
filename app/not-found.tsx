import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import Tag from "@/components/tag/Tag";

export default function NotFound() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "64px var(--gutter) 0", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Tag level="warning" rest={4}>
          <b>Nothing is filed under this link.</b>
        </Tag>
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 44, fontVariationSettings: '"wdth" 116', fontWeight: 800 }}>That page doesn&apos;t exist.</h1>
          <p style={{ marginTop: 12, fontSize: 17, color: "var(--ink-soft)" }}>
            Check links stay valid once a check has run. If you followed one, it may be mistyped. <Link href="/#check" style={{ color: "var(--focus)" }}>Start a new check</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

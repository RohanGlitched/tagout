import Link from "next/link";
import { REPO_URL, SHOWCASE, VIDEO_URL, DEVPOST_URL } from "@/lib/site";
import Mark from "./Mark";
import s from "./chrome.module.css";

export default function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footInner}>
        <div className={s.footBrand}>
          <Link href="/" className={s.footMark} aria-label="Tagout home">
            <Mark size={24} />
            <span>Tagout</span>
          </Link>
          <p className={s.footNote}>
            Checks what you own against official recalls. Recall data from NHTSA, the U.S. Consumer Product Safety Commission and the FDA through their public APIs, and
            USDA FSIS through Tavily web search. Tagout isn&apos;t affiliated with any agency; always confirm with the recall notice.
          </p>
          <p className={s.runs}>
            Runs on <b>NVIDIA Nemotron</b> via <b>Nebius Token Factory</b>
          </p>
        </div>
        <nav className={s.footCol} aria-label="Product">
          <h2>Product</h2>
          <Link href="/#check">Check my things</Link>
          <Link href="/recalls">Recalls today</Link>
          <Link href="/how">How it works</Link>
        </nav>
        <nav className={s.footCol} aria-label="Proof">
          <h2>Proof</h2>
          <Link href="/proof">The eval</Link>
          <Link href={`/check/${SHOWCASE.household}`}>A real household check</Link>
          <Link href={`/check/${SHOWCASE.webcatch}`}>Caught on the web first</Link>
          <Link href={`/watch/${SHOWCASE.watch}`}>A watched household</Link>
          <a href={VIDEO_URL}>Demo video</a>
        </nav>
        <nav className={s.footCol} aria-label="Project">
          <h2>Project</h2>
          <a href={REPO_URL}>Source code</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT licence</a>
          <a href={DEVPOST_URL}>Devpost entry</a>
        </nav>
      </div>
    </footer>
  );
}

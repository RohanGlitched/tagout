import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import Mark from "./Mark";
import s from "./chrome.module.css";

export default function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footInner}>
        <div className={s.footBrand}>
          <Mark size={20} />
          <span>Tagout</span>
        </div>
        <p className={s.footNote}>
          Recall data from NHTSA, the U.S. Consumer Product Safety Commission, the FDA and USDA FSIS, through their public APIs. Labels read and searches planned by
          NVIDIA Nemotron on Nebius Token Factory; web search by Tavily. Tagout isn&apos;t affiliated with any agency. Always confirm with the recall notice.
        </p>
        <nav className={s.footNav} aria-label="Footer">
          <Link href="/recalls">Recalls today</Link>
          <Link href="/how">How it works</Link>
          <a href={REPO_URL}>Source code</a>
        </nav>
      </div>
    </footer>
  );
}

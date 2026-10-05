import Link from "next/link";
import Mark from "./Mark";
import s from "./chrome.module.css";

export default function Header() {
  return (
    <header className={s.header}>
      <div className={s.bar}>
        <Link href="/" className={s.brand} aria-label="Tagout home">
          <Mark size={22} />
          <span>Tagout</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/recalls">Recalls today</Link>
          <Link href="/how">How it works</Link>
          <Link href="/#check" className={s.cta}>
            Check my things
          </Link>
        </nav>
      </div>
    </header>
  );
}

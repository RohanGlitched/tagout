import Link from "next/link";
import Mark from "./Mark";
import s from "./chrome.module.css";

const LINKS = [
  { href: "/recalls", label: "Recalls today" },
  { href: "/how", label: "How it works" },
  { href: "/proof", label: "Proof" },
  { href: "/business", label: "For business" },
];

export default function Header() {
  return (
    <header className={s.header}>
      <div className={s.bar}>
        <Link href="/" className={s.brand} aria-label="Tagout home">
          <Mark size={22} />
          <span>Tagout</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <Link href="/#check" className={s.cta}>
            Check my things
          </Link>
        </nav>
        {/* Phones: the same links behind a disclosure, no script needed. */}
        <details className={s.menu}>
          <summary aria-label="Menu">
            <span className={s.burger} aria-hidden="true" />
          </summary>
          <nav className={s.sheet} aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
            <Link href="/#check" className={s.cta}>
              Check my things
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import Tag from "@/components/tag/Tag";
import { SHOWCASE } from "@/lib/site";
import s from "./not-found.module.css";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <Header />
      <main className={s.main}>
        <div className={s.tag}>
          <Tag level="warning" rest={4}>
            <b>Nothing is filed under this link.</b>
          </Tag>
        </div>
        <div className={s.copy}>
          <h1 className={s.h1}>That page doesn&apos;t exist.</h1>
          <p>The link may be mistyped or cut short. A check&apos;s link keeps working once the check has run.</p>
          <ul className={s.links}>
            <li>
              <Link href="/#check">Start a new check</Link>
            </li>
            <li>
              <Link href={`/check/${SHOWCASE.household}`}>See a real household check</Link>
            </li>
            <li>
              <Link href="/recalls">Browse today&apos;s recalls</Link>
            </li>
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}

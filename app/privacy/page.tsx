import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import { REPO_URL } from "@/lib/site";
import s from "../business/business.module.css";

export const metadata = {
  title: "Privacy",
  description: "What Tagout stores, who can read it, and how to have it deleted.",
};

export default function Privacy() {
  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>What Tagout keeps, and who can read it.</h1>
          <p className={s.lede}>No account, no tracking, no ads. A check is a link: anyone who has it can read it.</p>
        </header>

        <section className={s.section} aria-labelledby="kept-h">
          <h2 id="kept-h" className={s.h2}>
            What is stored
          </h2>
          <ul className={s.points}>
            <li>The list you typed, the items read from it, and the result of each check, so its link keeps working.</li>
            <li>Label photos only while the check runs. They are deleted when it finishes and never shown on the check page.</li>
            <li>For a watch: the typed list and the checks it has run, so new recalls can be compared with it.</li>
            <li>Daily usage counters per visitor address, to keep the shared model budget fair. They hold a count, not what you checked.</li>
          </ul>
        </section>

        <section className={s.section} aria-labelledby="who-h">
          <h2 id="who-h" className={s.h2}>
            Who can read it
          </h2>
          <p className={s.body}>
            Check and watch links are random and not listed anywhere, and search engines are asked not to index them. But anyone you share a link with can open it, so don&apos;t put
            names, addresses or serial numbers you consider private in the list.
          </p>
        </section>

        <section className={s.section} aria-labelledby="where-h">
          <h2 id="where-h" className={s.h2}>
            Where it goes
          </h2>
          <p className={s.body}>
            Your list is sent to NVIDIA Nemotron models on Nebius Token Factory to be read, to the agencies&apos; public recall APIs (NHTSA, CPSC, FDA) as search terms, and to Tavily as
            web search terms. Results are stored in a private Google Cloud Storage bucket.
          </p>
        </section>

        <section className={s.section} aria-labelledby="del-h">
          <h2 id="del-h" className={s.h2}>
            Deleting a check
          </h2>
          <p className={s.body}>
            Open an issue on the <a href={`${REPO_URL}/issues/new?title=Delete%20a%20check`}>GitHub repository</a> with the check&apos;s link, and it will be removed.
          </p>
          <p className={s.note}>
            A green tag means no recall listed the item on the day of the check. It is not a safety certification; always confirm with the recall notice. <Link href="/how">How Tagout decides</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

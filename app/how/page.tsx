import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import Tag from "@/components/tag/Tag";
import { MODELS, modelLabel } from "@/lib/nebius";
import { REPO_URL } from "@/lib/site";
import s from "./how.module.css";

export const metadata = {
  title: "How it works",
  description: "How Tagout reads what you own, searches NHTSA, CPSC, FDA and the web with NVIDIA Nemotron on Nebius Token Factory, and decides each tag by rules.",
};

export default function How() {
  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>How it works</h1>
          <p className={s.lede}>
            A recall only helps if it reaches the people who own the product. Agencies publish thousands a year, each in its own database and its own words. Tagout does the
            looking for you, and shows its work.
          </p>
        </header>

        <section className={s.section}>
          <h2 className={s.h2}>The check, step by step</h2>
          <ol className={s.flow}>
            <li>
              <h3>Your list becomes items</h3>
              <p>
                {modelLabel(MODELS.reader[0])} reads each line into a kind of product, a brand, and the codes a recall turns on: model, lot, VIN, UPC, NDC. Every code it returns is
                checked against the words you typed, and dropped if it isn&apos;t there, so the reader can&apos;t invent the number a match depends on. A VIN is decoded by NHTSA&apos;s
                own decoder. A label photo is read by {modelLabel(MODELS.vision[0])}, the one model here that isn&apos;t Nemotron: Token Factory has no NVIDIA vision model today.
              </p>
            </li>
            <li>
              <h3>An agent searches</h3>
              <p>
                {modelLabel(MODELS.agent[0])} gets one item and six tools: NHTSA vehicle recalls, NHTSA child seat recalls, CPSC, FDA enforcement reports, Tavily web search and Tavily
                page reading. It picks the right database, reads what comes back, and searches again with better words when the first try misses. CPSC calls a space heater a
                &ldquo;tower heater&rdquo;; the agent learns that from the results. It always runs one web search too, because the agencies&apos; databases trail their own newsrooms
                by one to six weeks, and USDA&apos;s meat and poultry recalls aren&apos;t reachable any other way. It finishes by naming the recalls that could cover this product.
              </p>
            </li>
            <li>
              <h3>Each notice&apos;s list is read and checked</h3>
              <p>
                CPSC prints model numbers only in prose (&ldquo;The model &lsquo;TYPE SRTH&rsquo; is printed on the silver rating label&rdquo;). Nemotron reads the affected models,
                lots, UPCs and date windows out of each notice. Then each one is looked up in the notice&apos;s own text, character for character. A code the notice doesn&apos;t print
                is struck, and the check says so.
              </p>
            </li>
            <li>
              <h3>Rules decide the tag</h3>
              <p>
                Your codes are compared with each recall&apos;s list without a model: exact matches, printed ranges (&ldquo;2LC1234 through 2LC1240&rdquo;), family codes
                (&ldquo;5160X&rdquo;), and manufacture date windows. A near miss like CT22425 against CT22425B is never red. The code that decided it is shown next to the
                recall&apos;s line, so you can check it yourself.
              </p>
            </li>
          </ol>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>What each tag means</h2>
          <div className={s.tags}>
            <div>
              <Tag level="danger" rest={-3}>
                <b>A code on your product is on the recall&apos;s list.</b>
                <span className={s.tagNote}>You get the remedy, the firm&apos;s contact and the notice.</span>
              </Tag>
            </div>
            <div>
              <Tag level="warning" rest={2}>
                <b>The product line is recalled; yours isn&apos;t confirmed either way.</b>
                <span className={s.tagNote}>You&apos;re told where the code is printed. Cars are always orange: only NHTSA&apos;s VIN lookup can say if yours is included.</span>
              </Tag>
            </div>
            <div>
              <Tag level="inspected" rest={-1}>
                <b>No recall lists it on the day of the check.</b>
                <span className={s.tagNote}>The tag names the sources searched and the date.</span>
              </Tag>
            </div>
          </div>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Where the data comes from</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Source</th>
                <th>Covers</th>
                <th>How Tagout uses it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>NHTSA</td>
                <td>Vehicles, child car seats, tires</td>
                <td>VIN decoding (vPIC), recalls by make, model and year, and child seat recalls with their campaigns. &ldquo;Do not drive&rdquo; flags are shown first.</td>
              </tr>
              <tr>
                <td>CPSC</td>
                <td>Consumer products</td>
                <td>SaferProducts.gov&apos;s recall API, searched by product, title, maker and description text; the CPSC newsroom feed for the newest week.</td>
              </tr>
              <tr>
                <td>FDA</td>
                <td>Drugs, food, supplements, medical devices</td>
                <td>openFDA enforcement reports, searched by NDC, lot, UPC, brand and product words.</td>
              </tr>
              <tr>
                <td>Tavily</td>
                <td>Everything newer, and USDA FSIS</td>
                <td>Web search limited to official recall sites and makers&apos; recall pages, and Extract to read a recall page in full.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Honest limits</h2>
          <ul className={s.limits}>
            <li>There is no public API to check a single VIN&apos;s open recalls, so a car can be orange at most. The check links to NHTSA&apos;s VIN lookup.</li>
            <li>Tagout covers U.S. recalls. A product sold only elsewhere may be recalled there without a U.S. notice.</li>
            <li>Green means nothing was found on that day, not that a product is safe. Register products with their makers so they can reach you.</li>
            <li>When the model is unavailable or the demo&apos;s daily budget is spent, checks run on a fixed search plan; the matcher is the same.</li>
          </ul>
          <p className={s.more}>
            The code is open source: <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>. <Link href="/#check">Check your things</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

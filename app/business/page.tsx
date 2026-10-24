import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import Tag from "@/components/tag/Tag";
import { COST, TAVILY_USD_PER_CREDIT, money, perItem } from "@/lib/economics";
import { REPO_URL, SHOWCASE, SITE_URL } from "@/lib/site";
import summary from "@/eval/summary.json";
import s from "./business.module.css";

export const metadata = {
  title: "For property managers and resellers",
  description: "Tagout watches a building's appliance list or screens resale listings against official recalls, and red-tags only what a recall's own list names.",
};

const tagout = summary.arms.find((a) => a.arm === "tagout")!;

export default function Business() {
  const full = perItem("full");
  const lite = perItem("lite");
  return (
    <>
      <Header />
      <main className={s.main}>
        <header className={s.top}>
          <h1 className={s.h1}>Recalls reach the person who owns the product only if someone tells them.</h1>
          <p className={s.lede}>
            CPSC&apos;s own figures: a recall announced by press release gets about 6% of consumers to act; one sent straight to the owner gets about 50%. The businesses that already
            hold the list of what people own can be that direct notice. Tagout does the matching.
          </p>
        </header>

        <section className={s.section} aria-labelledby="first-h">
          <div className={s.split}>
            <div>
              <h2 id="first-h" className={s.h2}>
                First customer: property managers and home-warranty firms
              </h2>
              <p>
                They keep each unit&apos;s appliances (brand, model, serial) for service calls and inspections. Tagout watches that list, and a recall that names one of those
                models shows up as an alert on that unit&apos;s watch and feed, with the agency&apos;s own sentence attached as proof, ready to become a work order.
              </p>
              <p className={s.law}>
                <b>Why now, in California:</b> since AB 628, a landlord has 30 days from notice of a recall to repair or replace a recalled stove or refrigerator (Civil Code
                1941.1(c)(1), for leases signed, renewed or amended from 1 Jan 2026). Tagout&apos;s alert is that notice, dated, with the recall&apos;s own sentence. The recall&apos;s remedy
                is the maker&apos;s cost, not the landlord&apos;s.
              </p>
              <ul className={s.points}>
                <li>
                  <b>Price:</b> $1 per unit per month. A 200-unit building pays $200 a month.
                </li>
                <li>
                  <b>Our cost:</b> about {money(8 * full)} once to check a unit&apos;s eight appliances, then a share of one daily sweep that reads each new recall once (capped
                  at 40 readings a day, under 10¢ for every watched list together). That is a gross margin above 95% from the first year; hosting is the main fixed cost.
                </li>
                <li>
                  <b>Channel:</b> property-management software marketplaces, then warranty claims systems.
                </li>
                <li>
                  <b>Where we are:</b> a working product and a public error rate; no paying customer yet.
                </li>
              </ul>
            </div>
            <div className={s.tagCol} aria-hidden="true">
              <Tag level="danger" rest={-3} foot="Unit 4B, kitchen. CPSC recall 26-606">
                <b>Model NS-RGFGSS1 is on the recall&apos;s list.</b>
                <span className={s.dim}>Alert posted to this unit&apos;s watch and feed, with the remedy and the maker&apos;s number.</span>
              </Tag>
            </div>
          </div>
        </section>

        <section className={s.section} aria-labelledby="sell-h">
          <h2 id="sell-h" className={s.h2}>
            Second: checking resale listings before they go live
          </h2>
          <p className={s.body}>
            Selling a recalled consumer product is unlawful in the U.S. (15 U.S.C. 2068). A seller photographs the label; Tagout tags the listing red only when the item&apos;s own
            code is printed in a recall. On {summary.cases} test cases it wrongly tagged nothing as do-not-use, so honest sellers aren&apos;t blocked. Buyers: resale marketplaces, kids&apos;
            resale and thrift chains, pawn shops. Priced per listing checked (10–25¢), against about 1.4¢ of cost on the lite tier, with the full agent only to confirm a red.
          </p>
        </section>

        <section className={s.section} aria-labelledby="alt-h">
          <h2 id="alt-h" className={s.h2}>
            Already out there, and what Tagout adds
          </h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Option</th>
                  <th scope="col">What it does well</th>
                  <th scope="col">What Tagout adds</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Recall-alert apps (e.g. RecallSentry)</th>
                  <td>Free alerts from FDA, CPSC, NHTSA and USDA, matched on UPC, model, lot or VIN you enter</td>
                  <td>A published error rate on 144 cases, 39 of them held out; the agency&apos;s own sentence beside every red tag</td>
                </tr>
                <tr>
                  <th scope="row">Agency sites and email lists (recalls.gov, CPSC, SaferCar)</th>
                  <td>The source of truth; per-VIN lookup for cars</td>
                  <td>Reads the notice prose for codes (CPSC&apos;s model field is always empty) and finds recalls on the web before the databases list them</td>
                </tr>
                <tr>
                  <th scope="row">Retailer and maker notices</th>
                  <td>Reach buyers they know about</td>
                  <td>Covers what a building owns, whoever sold it, with an open API and a feed per list</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.note}>
            The part that is hard to copy is the verified index of affected codes the sweep builds as it reads each recall, together with a public, held-out error rate.
          </p>
        </section>

        <section className={s.section} aria-labelledby="cost-h">
          <h2 id="cost-h" className={s.h2}>
            What a check costs us
          </h2>
          <p className={s.body}>
            Measured on the {summary.cases}-case eval (the Oct 15 run; on the 39 held-out cases it was 4.9¢ and 1.7¢ all in): Nemotron tokens at Nebius Token Factory list price, plus Tavily credits at {money(TAVILY_USD_PER_CREDIT)} each. The agency APIs are
            free.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">Nemotron per item</th>
                  <th scope="col">Tavily per item</th>
                  <th scope="col">All in</th>
                  <th scope="col">Right on {summary.cases} cases</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Full: Nemotron 3 Ultra agent</th>
                  <td>{money(COST.full.model)}</td>
                  <td>{money(COST.full.tavily)}</td>
                  <td>
                    <b>{money(full)}</b>
                  </td>
                  <td>{tagout.right}</td>
                </tr>
                <tr>
                  <th scope="row">Lite: fixed plan, Nemotron Nano reader</th>
                  <td>{money(COST.lite.model)}</td>
                  <td>{money(COST.lite.tavily)}</td>
                  <td>
                    <b>{money(lite)}</b>
                  </td>
                  <td>{summary.arms.find((a) => a.arm === "fixed-plan-nano")!.right}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.note}>
            A watched list doesn&apos;t re-run the agent for every household: each new recall is read once a day and matched against every watched list by rules, so the cost grows with the
            number of recalls, not the number of households.
          </p>
        </section>

        <section className={s.section} aria-labelledby="api-h">
          <h2 id="api-h" className={s.h2}>
            Connecting a list
          </h2>
          <p className={s.body}>
            Paste one appliance per line (brand, model, serial) into the check box, or send the same text to the API. Every check gets its own link; save it as a watch to keep it
            compared with new recalls.
          </p>
          <pre className={s.code}>
            <code>{`curl -X POST ${SITE_URL}/api/checks \\
  -H 'content-type: application/json' \\
  -d '{"text": "Insignia gas range, model NS-RGFGSS1\\nGalanz retro refrigerator, model GLR12TRDEFR"}'

# The Insignia comes back Do not use (CPSC recall 26-606 lists it). The Galanz does not:
# Galanz recall 26-649 lists other retro models, not this one.

# → {"id": "…"}  then open ${SITE_URL}/check/<id>
# or read the result as JSON:  GET ${SITE_URL}/api/checks/<id>`}</code>
          </pre>
          <p className={s.note}>
            A finished example: <Link href={`/check/${SHOWCASE.household}`}>a household of five things</Link> (<a href={`/api/checks/${SHOWCASE.household}`}>as JSON</a>).
          </p>
        </section>

        <section className={s.section} aria-labelledby="pilot-h">
          <h2 id="pilot-h" className={s.h2}>
            Run a pilot
          </h2>
          <p className={s.body}>
            Open an issue on the <a href={`${REPO_URL}/issues/new?title=Pilot`}>GitHub repository</a> with the kind of list you hold and roughly how many units. What is stored and who can
            read it is on the <Link href="/privacy">privacy page</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

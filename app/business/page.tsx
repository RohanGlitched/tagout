import Link from "next/link";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import Tag from "@/components/tag/Tag";
import { COST, TAVILY_USD_PER_CREDIT, money, perItem } from "@/lib/economics";
import { REPO_URL, SHOWCASE, SITE_URL } from "@/lib/site";
import summary from "@/eval/summary-current.json";
import holdout from "@/eval/holdout-summary.json";
import held2 from "@/eval/holdout2-summary.json";
import reach from "@/docs/audience-counts.json";
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

        <section className={s.section} aria-labelledby="reach-h">
          <h2 id="reach-h" className={s.h2}>
            Who it reaches
          </h2>
          <p className={s.body}>Counted from the agencies&apos; own public data on {fmtDay(reach.at)}, with no model (scripts/audience-counts.mjs):</p>
          <dl className={s.worked} aria-label="Who the year's recalls reach">
            <div>
              <dt>CPSC recalls of {reach.at.slice(0, 4)} naming a child&apos;s product (cribs, car seats, toys, high chairs)</dt>
              <dd>
                {reach.childrensProducts} of {reach.cpscRecalls}
              </dd>
            </div>
            <div>
              <dt>openFDA food recall reports of {reach.at.slice(0, 4)} for an undeclared ingredient, mostly allergens</dt>
              <dd>
                {reach.undeclaredIngredient} of {reach.foodReports.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt>CPSC recalls of {reach.at.slice(0, 4)} of gas ranges and refrigerators, the appliances AB 628 makes a landlord fix within 30 days</dt>
              <dd>{reach.stovesOvensFridges}</dd>
            </div>
            <div>
              <dt>Owners who act on a recall sent straight to them, against 6% for a press release (CPSC)</dt>
              <dd>50%</dd>
            </div>
          </dl>
        </section>

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
          <div className={s.split}>
            <div>
              <h2 id="sell-h" className={s.h2}>
                Second: checking resale listings before they go live
              </h2>
              <p className={s.body}>
                Selling a recalled consumer product is unlawful in the U.S. (15 U.S.C. 2068). A seller photographs the label; Tagout tags the listing red only when the item&apos;s own
                code is printed in a recall. On {summary.cases} test cases and {holdout.cases} held-out ones it wrongly tagged nothing as do-not-use, and on a second,
                pre-registered held-out set of {held2.cases} it wrongly tagged one (a best-by date outside the recall&apos;s window), so honest sellers are rarely blocked, and the
                misses are published. Buyers: resale marketplaces, kids&apos; resale and thrift chains, pawn shops. Priced per listing checked (10–25¢), against about {money(lite)} of cost on the
                lite tier, with the full agent only to confirm a red.
              </p>
            </div>
            <figure className={s.mock} aria-label="Example: a resale listing screened before it goes live">
              <figcaption className={s.mockHead}>
                <span>Listing screen</span>
                <span className={s.mockDim}>example</span>
              </figcaption>
              <ul className={s.mockRows}>
                <li data-level="danger">
                  <b>Do not list</b>
                  <span>Vornado space heater, TYPE SRTH on the label</span>
                  <small>CPSC 26-532 lists TYPE SRTH</small>
                </li>
                <li data-level="warning">
                  <b>Check the label</b>
                  <span>Evenflo car seat, no model given</span>
                  <small>Ask the seller for the model and date</small>
                </li>
                <li data-level="inspected">
                  <b>Clear to list</b>
                  <span>Lasko ceramic tower heater, model CT22425</span>
                  <small>No Lasko recall lists this model</small>
                </li>
              </ul>
              <p className={s.mockNote}>Three eval cases (p18, c05, n14) and the tags Tagout gave them at today&apos;s code.</p>
            </figure>
          </div>
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
                  <td>A published error rate on {summary.cases + holdout.cases + held2.cases} cases, {holdout.cases + held2.cases} of them held out; the agency&apos;s own sentence beside every red tag</td>
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
            Measured on the {summary.cases}-case eval at today&apos;s code (019d39e, Oct 30, confirmed by an offline replay; the live runs were Oct 24-25). On held-out set #1 it was 4.9¢ and 1.7¢ all in, on set #2 4.7¢ and 1.4¢: Nemotron tokens at Nebius Token Factory list price, plus Tavily credits at {money(TAVILY_USD_PER_CREDIT)} each. The agency APIs are
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
          <dl className={s.worked} aria-label="A 200-unit building, worked through">
            <div>
              <dt>A 200-unit building, 8 appliances each</dt>
              <dd>1,600 items</dd>
            </div>
            <div>
              <dt>First check, full tier, once</dt>
              <dd>{money(1600 * full)}</dd>
            </div>
            <div>
              <dt>Daily sweep, every list together</dt>
              <dd>under 10¢ a day</dd>
            </div>
            <div>
              <dt>Revenue at $1 a unit</dt>
              <dd>$200 a month</dd>
            </div>
          </dl>
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

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

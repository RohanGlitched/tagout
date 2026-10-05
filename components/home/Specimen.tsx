import Tagged from "@/components/tag/Tagged";
import type { Item } from "@/lib/types";
import s from "./specimen.module.css";

const VORNADO: Item = { id: "spec", kind: "product", said: "Vornado heater", brand: "Vornado", product: "Small room tower heater", codes: ["TYPE SRTH"] };

/**
 * One real match taken apart: CPSC recall 26-532's own wording, the code Nemotron read out of it (and found printed
 * in it), the same code on the heater's rating plate, and the tag the matcher hung. Numbered in the order a check
 * runs.
 */
export default function Specimen() {
  return (
    <figure className={s.specimen}>
      <div className={s.stage}>
        <article className={s.notice} aria-label="CPSC recall 26-532, as published">
          <header className={s.noticeHead}>
            <span className={s.seal} aria-hidden="true">
              CPSC
            </span>
            <span>
              Recall 26-532
              <br />
              June 4, 2026
            </span>
            <Num n={2} />
          </header>
          <h3 className={s.noticeTitle}>Vornado Air Recalls SRTH Small Room Tower Heaters Due to Fire Hazard</h3>
          <p className={s.prose}>
            The recalled Vornado SRTH small room tower heaters were sold in black and white and measure about 12.5 inches high by 6 inches in diameter. The word
            &ldquo;Vornado&rdquo; with a &ldquo;V&rdquo; behind it is printed on the front of the unit. The model{" "}
            <mark className={s.mark}>&ldquo;TYPE SRTH&rdquo;</mark>
            <span className={s.inlineNum}>
              <Num n={3} />
            </span>{" "}
            is printed on the silver rating label located on the bottom of the product.
          </p>
          <p className={s.units}>About 255,000 units, sold August 2013 through May 2026.</p>
        </article>

        <div className={s.join} aria-hidden="true">
          <span className={s.eq}>=</span>
          <span className={s.code}>SRTH</span>
        </div>

        <div className={s.plateCol}>
          <span className={s.num1}>
            <Num n={1} />
          </span>
          <Tagged item={VORNADO} level="danger" marks={{ model: "match" }} hits={["SRTH"]} size="md" dx={58} dy={52} rest={-4}>
            <span className={s.tagLine}>
              <Num n={4} />
              <b>SRTH is listed in this recall.</b>
            </span>
            <span className={s.ref}>CPSC recall 26-532</span>
          </Tagged>
        </div>
      </div>

      <figcaption>
        <ol className={s.steps}>
          <li>
            <Num n={1} />
            <p>
              <b>Your label.</b> You type &ldquo;TYPE SRTH&rdquo;, or photograph the plate under the heater. Codes the reader returns that aren&apos;t in what you gave it are dropped.
            </p>
          </li>
          <li>
            <Num n={2} />
            <p>
              <b>The search.</b> Nemotron 3 Ultra queries CPSC for &ldquo;Vornado&rdquo;. CPSC calls it a tower heater, not a space heater, so the agent widens the search
              and finds 26-532.
            </p>
          </li>
          <li>
            <Num n={3} />
            <p>
              <b>The notice.</b> CPSC prints model numbers only in prose. Nemotron reads &ldquo;TYPE SRTH&rdquo; out of it, and the code is kept only because those exact
              characters are in the notice.
            </p>
          </li>
          <li>
            <Num n={4} />
            <p>
              <b>The tag.</b> No model decides this part. SRTH on your plate equals SRTH in the notice, so the tag is red, with the remedy and Vornado&apos;s number.
            </p>
          </li>
        </ol>
      </figcaption>
    </figure>
  );
}

function Num({ n }: { n: number }) {
  return (
    <span className={s.num} aria-hidden="true">
      {n}
    </span>
  );
}

"use client";

import Label from "@/components/label/Label";
import type { Item } from "@/lib/types";
import s from "./codes.module.css";

type Specimen = { item: Item; variant?: "sticker"; hit: string[]; quote: string; source: string; url: string };

/**
 * Four real recalls, each with the agency's own sentence saying where the deciding code is printed, and that code
 * on a label as it would look. The wording is the agencies' (U.S. government works); the labels are drawn.
 */
const SPECIMENS: Specimen[] = [
  {
    item: { id: "w1", kind: "product", said: "Vornado heater", brand: "Vornado", product: "Small room tower heater", codes: ["TYPE SRTH"] },
    hit: ["SRTH"],
    quote: "The model “TYPE SRTH” is printed on the silver rating label located on the bottom of the product.",
    source: "CPSC recall 26-532",
    url: "https://www.cpsc.gov/Recalls/2026/Vornado-Air-Recalls-SRTH-Small-Room-Tower-Heaters-Due-to-Fire-Hazard",
  },
  {
    item: { id: "w2", kind: "product", said: "5Color helmet", brand: "5Color", product: "Children's bike helmet", model: "YD-001", lot: "YD-260320", made: "2026/03/20" },
    variant: "sticker",
    hit: ["YD-001", "YD-260320"],
    quote: "“Model No.: YD-001,” “Lot/Ref: YD-260320” and “Date 2026/03/20” are printed on a label on the inside of the helmet and on the product packaging.",
    source: "CPSC recall 26-789",
    url: "https://cpsc.gov/Recalls/2026/5Color-Recalls-Childrens-Bicycle-Helmet-and-Pads-Sets-Due-to-Risk-of-Serious-Injury-or-Death-from-Head-Injury-Violate-Mandatory-Standard-for-Bicycle-Helmets",
  },
  {
    item: { id: "w3", kind: "drug", said: "Tylenol", brand: "Kenvue", product: "Tylenol Extra Strength, 24 caplets", ndc: "50580-378-04", lot: "EJA022", made: "04/30/2028" },
    hit: ["EJA022"],
    quote: "Lot: EJA022, expiry: 04/30/2028",
    source: "FDA recall D-0121-2026",
    url: "https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=97850",
  },
  {
    item: { id: "w4", kind: "product", said: "NEWDERY power bank", brand: "NEWDERY", product: "Power bank", model: "ZHX-PB22" },
    variant: "sticker",
    hit: ["ZHX-PB22"],
    quote: "The brand name “NEWDERY” is engraved on the front and the model number “ZHX-PB22” is printed on the back.",
    source: "CPSC recall 26-792",
    url: "https://cpsc.gov/Recalls/2026/NEWDERY-Power-Banks-Recalled-Due-to-Fire-and-Burn-Hazards-Risk-of-Serious-Injury-Sold-on-Amazon",
  },
];

export default function WhereCodes() {
  return (
    <ul className={s.grid}>
      {SPECIMENS.map((x) => (
        <li key={x.item.id} className={s.card}>
          <div className={s.bench}>
            <Label item={x.item} variant={x.variant} marks={{ model: "match", lot: "match" }} hits={x.hit} />
          </div>
          <blockquote className={s.quote}>
            <p>{x.quote}</p>
            <cite>
              <a href={x.url} target="_blank" rel="noreferrer">
                {x.source}
              </a>
            </cite>
          </blockquote>
        </li>
      ))}
    </ul>
  );
}

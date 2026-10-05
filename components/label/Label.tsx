"use client";

import { createContext, useContext } from "react";
import type { Item, Proof } from "@/lib/types";
import { norm } from "@/lib/match";
import Barcode from "./Barcode";
import s from "./label.module.css";

/** The codes that matched, normalised; null when every field of a matched kind should be marked. */
const HitContext = createContext<string[] | null>(null);

type Mark = "match" | "miss" | "reading" | undefined;
type Marks = Partial<Record<Proof["field"], Mark>>;

/**
 * The thing you own, drawn as its own identification label: the door-jamb certification sticker on a car, the
 * white label under a car seat, the aluminium rating plate on an appliance, the lot imprint on a medicine
 * carton, the back of a food pack. Fields a recall turns on can be marked as matched, missed or being read.
 */
export default function Label({ item, marks = {}, hits, variant, className = "" }: { item: Item; marks?: Marks; hits?: string[]; variant?: "sticker"; className?: string }) {
  const Body = variant === "sticker" ? Sticker : (BODIES[item.kind] ?? Plate);
  return (
    <figure className={`${s.label} ${s[item.kind] ?? ""} ${className}`} aria-label={labelText(item)}>
      <HitContext.Provider value={hits?.map(norm).filter(Boolean) ?? null}>
        <Body item={item} marks={marks} />
      </HitContext.Provider>
    </figure>
  );
}

export function labelText(item: Item): string {
  const bits = [item.year, item.brand, item.product].filter(Boolean).join(" ");
  const ids = [item.model && `model ${item.model}`, item.lot && `lot ${item.lot}`, item.vin && `VIN ${item.vin}`].filter(Boolean).join(", ");
  return `${bits || item.said}${ids ? `, ${ids}` : ""}`;
}

/** One printed field. `k` ties it to a proof field so a match can mark exactly the characters that matched. */
function F({ k, name, value, marks, mono = true, wide = false }: { k?: Proof["field"]; name: string; value?: string | number; marks: Marks; mono?: boolean; wide?: boolean }) {
  const hits = useContext(HitContext);
  if (value === undefined || value === "") return null;
  let mark = k ? marks[k] : undefined;
  // A matched code marks only the field that actually holds it (a TYPE, not the model next to it).
  if (mark === "match" && hits && !hits.some((h) => norm(String(value)).includes(h))) mark = undefined;
  return (
    <div className={`${s.field} ${wide ? s.wideField : ""}`}>
      <span className={s.fname}>{name}</span>
      <span className={`${s.fval} ${mono ? "code" : ""}`} data-mark={mark}>
        {value}
      </span>
    </div>
  );
}

type BodyProps = { item: Item; marks: Marks };

/** FMVSS certification label, as on the driver's door jamb. */
function Vehicle({ item, marks }: BodyProps) {
  return (
    <div className={s.cert}>
      <div className={s.certTop}>
        <F k="make" name="MFD. BY" value={item.brand?.toUpperCase()} marks={marks} mono={false} />
        <F name="DATE" value={item.made} marks={marks} />
      </div>
      <div className={s.certRow}>
        <F k="year" name="MODEL YEAR" value={item.year} marks={marks} />
        <F k="product" name="MODEL" value={item.product?.toUpperCase()} marks={marks} mono={false} />
      </div>
      <p className={s.conform}>
        THIS VEHICLE CONFORMS TO ALL APPLICABLE U.S. FEDERAL MOTOR VEHICLE SAFETY, BUMPER AND THEFT PREVENTION STANDARDS IN EFFECT ON THE DATE OF
        MANUFACTURE SHOWN ABOVE.
      </p>
      <div className={s.certVin}>
        <F k="vin" name="VIN" value={item.vin} marks={marks} wide />
        <span className={s.certType}>TYPE: PASS CAR</span>
      </div>
      {item.vin ? <VinBars vin={item.vin} /> : null}
    </div>
  );
}

/** A Code 39-looking strip for the VIN: decorative bars derived from the characters, not a scannable code. */
function VinBars({ vin }: { vin: string }) {
  const bars: number[] = [];
  for (const ch of vin) {
    const c = ch.charCodeAt(0);
    for (let i = 0; i < 5; i++) bars.push(((c >> i) & 1) + 1);
  }
  let x = 0;
  return (
    <svg className={s.vinBars} viewBox={`0 0 ${bars.length * 3.2} 20`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((w, i) => {
        const r = <rect key={i} x={x} y={0} width={w * 0.9} height={20} fill="currentColor" />;
        x += w * 0.9 + 1.4;
        return r;
      })}
    </svg>
  );
}

/** The white label under a child car seat or on a crib rail. */
function Seat({ item, marks }: BodyProps) {
  return (
    <div className={s.seat}>
      <div className={s.seatHead}>
        <span className={s.seatBrand}>{item.brand ?? "Child restraint"}</span>
        <span className={s.seatKind}>{item.kind === "car-seat" ? "Child restraint system" : "Juvenile product"}</span>
      </div>
      <div className={s.seatGrid}>
        <F k="product" name="Model name" value={item.product} marks={marks} mono={false} wide />
        <F k="model" name="Model no." value={item.model} marks={marks} />
        <F k="lot" name="Date of manufacture" value={item.made ?? item.lot} marks={marks} />
        <F name="Serial no." value={item.serial} marks={marks} />
      </div>
      <p className={s.seatNote}>Register this product so the manufacturer can reach you about a recall.</p>
      {item.upc ? <Barcode code={item.upc} className={s.bar} /> : null}
    </div>
  );
}

/** A plain printed product label: brand bar, then the codes. Power banks, helmets, small electronics. */
function Sticker({ item, marks }: BodyProps) {
  return (
    <div className={s.seat}>
      <div className={s.seatHead}>
        <span className={s.seatBrand}>{item.brand ?? "Product label"}</span>
        <span className={s.seatKind}>{item.product}</span>
      </div>
      <div className={s.seatGrid}>
        <F k="model" name="Model no." value={item.model} marks={marks} />
        <F k="lot" name="Lot / Ref" value={item.lot} marks={marks} />
        <F name="Date" value={item.made} marks={marks} />
        <F name="Serial no." value={item.serial} marks={marks} />
      </div>
      {item.upc ? <Barcode code={item.upc} className={s.bar} /> : <div className={s.stickerFoot} />}
    </div>
  );
}

/** Short identifier codes only ("TYPE SRTH" → "SRTH"); ratings like "120V~ 60Hz 1500W" aren't codes. */
function typeCodes(codes?: string[]): string | undefined {
  const ids = (codes ?? []).map((c) => c.replace(/^type\s*/i, "").trim()).filter((c) => c.length <= 16 && !/\d\s*(v|w|hz|a)b|~/i.test(c));
  return ids.length ? ids.join(", ") : undefined;
}

/** A brushed aluminium rating plate, riveted to an appliance. */
function Plate({ item, marks }: BodyProps) {
  return (
    <div className={s.plate}>
      <i className={s.rivet} data-pos="tl" />
      <i className={s.rivet} data-pos="tr" />
      <i className={s.rivet} data-pos="bl" />
      <i className={s.rivet} data-pos="br" />
      <div className={s.plateBrand}>{item.brand ?? "Manufacturer unknown"}</div>
      <div className={s.plateProduct}>{item.product ?? item.said}</div>
      <div className={s.plateGrid}>
        <F k="model" name="MODEL" value={item.model} marks={marks} />
        <F k="model" name="TYPE" value={typeCodes(item.codes)} marks={marks} />
        <F name="SERIAL" value={item.serial} marks={marks} />
        <F k="lot" name="DATE CODE" value={item.made ?? item.lot} marks={marks} />
        <F k="upc" name="UPC" value={item.upc} marks={marks} />
      </div>
    </div>
  );
}

/** The end flap of a medicine carton: product, NDC, and the lot/expiry imprint. */
function Drug({ item, marks }: BodyProps) {
  return (
    <div className={s.carton}>
      <div className={s.cartonBand} />
      <div className={s.cartonName}>{item.product ?? item.said}</div>
      <div className={s.cartonBrand}>{item.brand}</div>
      <F k="model" name="NDC" value={item.ndc ?? item.model} marks={marks} />
      <div className={s.imprint}>
        <F k="lot" name="LOT" value={item.lot} marks={marks} />
        <F name="EXP" value={item.made} marks={marks} />
      </div>
      {item.upc ? <Barcode code={item.upc} className={s.bar} height={26} /> : null}
    </div>
  );
}

/** The back of a food pack: best-by, establishment number, lot, barcode. */
function Food({ item, marks }: BodyProps) {
  return (
    <div className={s.pack}>
      <div className={s.cartonName}>{item.product ?? item.said}</div>
      <div className={s.cartonBrand}>{item.brand}</div>
      <div className={s.imprint}>
        <F k="lot" name="LOT" value={item.lot} marks={marks} />
        <F name="BEST BY" value={item.made} marks={marks} />
      </div>
      <F k="model" name="EST." value={item.model} marks={marks} />
      {item.upc ? <Barcode code={item.upc} className={s.bar} height={26} /> : null}
    </div>
  );
}

const BODIES: Record<Item["kind"], (p: BodyProps) => React.ReactElement> = {
  vehicle: Vehicle,
  "car-seat": Seat,
  product: Plate,
  device: Plate,
  drug: Drug,
  food: Food,
};

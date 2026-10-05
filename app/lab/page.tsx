import Tagged from "@/components/tag/Tagged";
import Tag from "@/components/tag/Tag";
import type { Item } from "@/lib/types";

// Visual test bench for labels and tags. Not linked from the site.
export const metadata = { robots: { index: false } };

const items: Item[] = [
  { id: "car", kind: "vehicle", said: "2018 Honda Accord", brand: "Honda", product: "Accord", year: 2018, made: "04/18", vin: "1HGCV1F31JA012345" },
  { id: "seat", kind: "car-seat", said: "Graco car seat", brand: "Graco", product: "4Ever DLX 4-in-1", model: "2074735", made: "2023/03/14", serial: "GR2307-55812", upc: "047406182651" },
  { id: "heater", kind: "product", said: "Space heater", brand: "Lasko", product: "Ceramic tower heater", model: "CT22425", made: "2422", serial: "A2201-33410" },
  { id: "drug", kind: "drug", said: "Children's ibuprofen", brand: "Example Pharma", product: "Children's Ibuprofen Oral Suspension 100 mg/5 mL", ndc: "0000-0000-00", lot: "2LC1234", made: "06/2027", upc: "300450494122" },
];

export default function Lab() {
  return (
    <main style={{ padding: "48px var(--gutter)", display: "grid", gap: 72, gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", alignItems: "start" }}>
      <Tagged item={items[0]} level="danger" swing marks={{ vin: "match", year: "match" }} foot={<>NHTSA 25V-000 · checked 5 Oct</>}>
        <b>Recalled. Your car is in the range.</b>
        <span>Rear camera image may not display.</span>
      </Tagged>
      <Tagged item={items[1]} level="warning" swing delay={300} marks={{ model: "reading" }}>
        <b>Some 4Ever seats are recalled.</b>
        <span>Check the model number under the seat.</span>
      </Tagged>
      <Tagged item={items[2]} level="inspected" swing delay={600}>
        <b>No recall found for model CT22425.</b>
      </Tagged>
      <Tagged item={items[3]} level="danger" swing delay={900} marks={{ lot: "match" }}>
        <b>Lot 2LC1234 is recalled.</b>
      </Tagged>
      <div style={{ display: "flex", gap: 30 }}>
        <Tag level="danger" size="sm" />
        <Tag level="warning" size="sm" rest={2} />
        <Tag level="inspected" size="sm" rest={-1} />
      </div>
      <Tag level="danger" size="lg" foot="NHTSA 24V-123 · 5 Oct 2026, 14:02 IST">
        <b>Recalled. Your VIN is in the range.</b>
      </Tag>
    </main>
  );
}

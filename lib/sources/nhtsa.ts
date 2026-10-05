import "server-only";
import type { Notice } from "../types";
import { norm } from "../match";
import { clean, getJson } from "./http";

/**
 * NHTSA: VIN decoding (vPIC), vehicle recalls by make/model/year, and child car seat recalls.
 * There is no public recall-by-VIN API, so a vehicle check ends with a link to nhtsa.gov/recalls for the VIN.
 */

export type Decoded = { make: string; model: string; year: number; trim?: string; body?: string; warning?: string };

export async function decodeVin(vin: string): Promise<Decoded | null> {
  const v = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9*]/g, "");
  if (v.length < 11) return null;
  const j = await getJson<{ Results: Record<string, string>[] }>(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`, { timeoutMs: 10_000 });
  const r = j?.Results?.[0];
  if (!r?.Make || !r.ModelYear) return null;
  // Error code 0 is clean; 1 is a bad check digit, which still decodes. Anything else is shown as a caution.
  const code = (r.ErrorCode ?? "0").split(",")[0].trim();
  return {
    make: r.Make,
    model: r.Model,
    year: Number(r.ModelYear),
    trim: r.Trim || undefined,
    body: r.BodyClass || undefined,
    warning: code !== "0" ? clean(r.ErrorText).replace(/^\d+ - /, "") : undefined,
  };
}

/**
 * The names NHTSA lists for a make and year that could be this model, best first: an exact spelling ("CR-V"),
 * then longer variants ("F-150 (SUPER CREW) GAS" for "F-150"), then shorter ones.
 */
export async function nhtsaModelNames(make: string, model: string, year: number): Promise<string[]> {
  const j = await getJson<{ results: { model: string }[] }>(
    `https://api.nhtsa.gov/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=r`,
    { timeoutMs: 8_000 },
  ).catch(() => null);
  const names = [...new Set(j?.results?.map((r) => r.model) ?? [])];
  const want = norm(model);
  return [...names.filter((n) => norm(n) === want), ...names.filter((n) => norm(n) !== want && norm(n).startsWith(want)), ...names.filter((n) => want.startsWith(norm(n)) && norm(n) !== want)];
}

async function recallsFor(make: string, model: string, year: number): Promise<VRec[]> {
  const j = await getJson<{ results: VRec[] }>(
    `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`,
    { timeoutMs: 10_000, retries: 0 },
  ).catch(() => null);
  return j?.results ?? [];
}

type VRec = {
  Manufacturer: string;
  NHTSACampaignNumber: string;
  parkIt: boolean;
  parkOutSide: boolean;
  overTheAirUpdate?: boolean;
  ReportReceivedDate: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  Notes: string;
  ModelYear: string;
  Make: string;
  Model: string;
};

/** "28/05/2020" → "2020-05-28". */
function dmy(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
}

/** "Air bags: the front passenger seat weight sensor may fail." The summary's first sentence only lists models, so use the defect sentence. */
function vehicleTitle(r: VRec): string {
  const sentences = clean(r.Summary).split(/(?<=\.)\s+(?=[A-Z])/);
  const defect = sentences.find((x) => !/is recalling|are recalling|recalling certain/i.test(x)) ?? clean(r.Consequence);
  const t = `${titleCase(r.Component.split(":")[0])}: ${defect}`;
  return t.length > 170 ? t.slice(0, 168).replace(/\s+\S*$/, "") + "…" : t;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s:/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export async function vehicleRecalls(make: string, model: string, year: number): Promise<Notice[]> {
  // The name as people write it usually works ("F-150"); when it finds nothing, try NHTSA's own spellings and
  // merge their campaigns (one campaign often covers several cab variants).
  let recs = await recallsFor(make, model, year);
  if (!recs.length) {
    const names = (await nhtsaModelNames(make, model, year)).slice(0, 4);
    const all = await Promise.all(names.map((n) => recallsFor(make, n, year)));
    const seen = new Set<string>();
    recs = all.flat().filter((r) => (seen.has(r.NHTSACampaignNumber) ? false : (seen.add(r.NHTSACampaignNumber), true)));
  }
  return recs
    .map(
      (r): Notice => ({
        source: "nhtsa",
        id: r.NHTSACampaignNumber,
        title: vehicleTitle(r),
        date: dmy(r.ReportReceivedDate),
        url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.NHTSACampaignNumber}`,
        firm: clean(r.Manufacturer),
        hazard: clean(r.Consequence),
        remedy: clean(r.Remedy),
        contact: clean(r.Notes),
        models: [],
        lots: [],
        upcs: [],
        make: r.Make,
        vehicleModel: r.Model,
        years: [Number(r.ModelYear)],
        urgent: r.parkIt ? "NHTSA says don't drive this vehicle until it's repaired." : r.parkOutSide ? "NHTSA says park this vehicle outside and away from buildings until it's repaired." : undefined,
        text: `${r.Component}\n${clean(r.Summary)}`,
      }),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The page where an owner checks whether their own VIN has an open (unrepaired) recall. */
export const vinLookupUrl = (vin?: string) => (vin ? `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin)}` : "https://www.nhtsa.gov/recalls");

type Seat = {
  id: number;
  make: string;
  productModel: string;
  modelNumber: string | null;
  manufacturerDate?: string;
  picture?: string;
  safetyIssues?: {
    recalls?: {
      nhtsaCampaignNumber: string;
      reportReceivedDate: string;
      subject: string;
      summary: string;
      consequence: string;
      correctiveAction: string;
      potentialNumberOfUnitsAffected?: number;
      associatedProducts?: { productMake: string; productModel: string }[];
    }[];
  };
};

/**
 * Child car seat recalls. The search matches brand and model names (not model numbers), and each seat carries
 * its recalls; one recall usually covers several seats, so they're merged by campaign number.
 */
export async function childSeatRecalls(query: string): Promise<Notice[]> {
  const j = await getJson<{ results: Seat[] }>(`https://api.nhtsa.gov/childSeats/bySearch?query=${encodeURIComponent(query)}&max=60`, { timeoutMs: 15_000 });
  const byCampaign = new Map<string, Notice>();
  for (const seat of j?.results ?? []) {
    for (const r of seat.safetyIssues?.recalls ?? []) {
      const have = byCampaign.get(r.nhtsaCampaignNumber);
      const seatName = `${seat.make} ${seat.productModel}${seat.modelNumber ? ` (${seat.modelNumber})` : ""}`;
      if (have) {
        if (!have.text!.includes(seatName)) have.text += `\n${seatName}`;
        if (seat.modelNumber && !have.models.includes(seat.modelNumber)) have.models.push(seat.modelNumber);
        continue;
      }
      const products = (r.associatedProducts ?? []).map((p) => `${p.productMake} ${p.productModel}`);
      byCampaign.set(r.nhtsaCampaignNumber, {
        source: "nhtsa",
        id: r.nhtsaCampaignNumber,
        title: `${titleCase(seat.make)} car seats: ${clean(r.subject)}`,
        date: r.reportReceivedDate.slice(0, 10),
        url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.nhtsaCampaignNumber}`,
        firm: titleCase(seat.make),
        hazard: clean(r.consequence),
        remedy: clean(r.correctiveAction),
        image: seat.picture || undefined,
        models: seat.modelNumber ? [seat.modelNumber] : [],
        lots: [],
        upcs: [],
        units: r.potentialNumberOfUnitsAffected,
        text: [clean(r.subject), clean(r.summary), seatName, ...products].join("\n"),
      });
    }
  }
  return [...byCampaign.values()].sort((a, b) => b.date.localeCompare(a.date));
}

<div align="center">

<img src="docs/cover.png" alt="Tagout: is anything you own recalled? A Vornado heater tagged Do not use, a Honda CR-V tagged Check the label, a Lasko heater tagged Checked." width="100%">

<br>

[![CI](https://github.com/RohanGlitched/tagout/actions/workflows/ci.yml/badge.svg)](https://github.com/RohanGlitched/tagout/actions/workflows/ci.yml)
[![Nemotron 3 Ultra on Nebius Token Factory](https://img.shields.io/badge/model-Nemotron%203%20Ultra%20on%20Nebius%20Token%20Factory-76b900)](#how-nemotron-and-nebius-token-factory-are-used)
[![Tavily](https://img.shields.io/badge/web%20search-Tavily-2b6cb0)](#how-tavily-is-used)
[![Eval](https://img.shields.io/badge/eval-104%2F105%20real%20cases-15191e)](#results-105-real-cases)
[![Sources](https://img.shields.io/badge/recalls-NHTSA%20%C2%B7%20CPSC%20%C2%B7%20openFDA%20%C2%B7%20FSIS-c8102e)](#data-sources)
[![License: MIT](https://img.shields.io/badge/license-MIT-15191e)](LICENSE)

**[Try it live](https://tagout-recalls.vercel.app)** · **[A finished check](https://tagout-recalls.vercel.app/check/kj6iutme8c)** · **[The eval](https://tagout-recalls.vercel.app/proof)** · **[A watched household](https://tagout-recalls.vercel.app/watch/5ehharz7sr)** · **[Caught on the web](https://tagout-recalls.vercel.app/check/vk9vuyk3zi)** · **[How it works](https://tagout-recalls.vercel.app/how)**

<!-- TODO(video): swap in the public YouTube URL once the video is set to Public or re-uploaded -->
**Demo video:** https://youtu.be/kqVtw3pK6nw (2:45)

</div>

---

**On 105 real recall cases, Tagout tagged all 46 recalled units Do not use and wrongly told nobody to stop using something. NVIDIA Nemotron 3 Ultra on its own caught 5 of the 46, cleared 36, and told five people to stop using things no recall lists.**

Tagout checks what a household owns against live U.S. recalls. List what you own, or photograph the label. An agent on **NVIDIA Nemotron** (served by **Nebius Token Factory**) searches NHTSA, CPSC and the FDA with tools, and **Tavily** searches the agencies' newsrooms and USDA for anything the databases don't have yet. Nemotron reads each notice's list of affected models and lots, every code is checked against the notice's own text, and plain rules hang the tag. Save the list as a watch and a daily sweep reads every new recall once and matches it against the list; the watch's Atom feed tells you when one covers something you own.

## Try it in one minute

1. Open https://tagout-recalls.vercel.app. No account, nothing to install.
2. Tap **A space heater** and **A medicine**, then **Check my things**.
3. Watch the agent search CPSC, the FDA and the web (about 25 seconds an item). Then the tags are hung: the Vornado heater (`TYPE SRTH`) and Tylenol lot `EJA022` are both **Do not use**, each with the recall's own line next to yours.
4. Try a car (`2019 Honda CR-V`) or a car seat with no model number (`Evenflo car seat`): both are **Check the label**, and the tag says exactly what to look up.
5. At the bottom of a finished check, **Watch these things** saves the list. [This watch](https://tagout-recalls.vercel.app/watch/5ehharz7sr) started from the Oct 8 showcase; the daily sweep checks it against every new recall, and [its feed](https://tagout-recalls.vercel.app/watch/5ehharz7sr/feed.xml) works in any feed reader.
6. The [eval](https://tagout-recalls.vercel.app/proof) shows every case and every answer, including the ones that were wrong.
7. [This check](https://tagout-recalls.vercel.app/check/vk9vuyk3zi) shows two recalls only the web search could find, each marked on its tag.

Every check gets its own link, so you can send it to someone.

## Why

CPSC alone announced 479 recalls in 2026 by Oct 8; the FDA and NHTSA add thousands more. Each sits in its own database, in its own words, and the deciding detail (a model number, a lot, a date window) is usually buried in a paragraph. CPSC's own staff measured what that costs: recalls announced only by press release got **6%** of consumers to act, while recalls sent straight to owners got **50%** ([CPSC Recall Effectiveness Workshop, recall data, closed cases FY2013–2016](https://www.slideshare.net/slideshow/cpsc-recall-effectiveness-workshop-recall-data/78744492)). Tagout takes the list of things a household actually owns, does the looking, and keeps looking.

## Results: 105 real cases

Cases come from 2025–26 CPSC recalls, openFDA enforcement reports and NHTSA's recall API: 46 units whose code is printed in a recall, 27 near misses (a neighbouring lot or model, a date outside the window), 12 recalled product lines with no code given, 12 cars and 8 things no recall lists. [`eval/verify.mjs`](eval/verify.mjs) checks every expected answer against the agency's own record without any Tagout code. All 105 verify.

| Arm | Right | Wrongly told to stop using | Recalled, but cleared | Red tags right | Recalled units caught | Cost per item |
|---|---|---|---|---|---|---|
| **Tagout** (Ultra reads the list, runs the agent, reads the notices; rules decide) | **104/105** | **0** | **0** | 100% (46/46) | 100% (46/46) | 2.6¢ |
| Nemotron 3 Ultra reading Tavily's results, no rules | 75/105 | 5 | 12 | 85% (29/34) | 63% (29/46) | 0.32¢ |
| Nemotron 3 Ultra alone, no tools | 45/105 | 5 | 36 | 50% (5/10) | 11% (5/46) | 0.26¢ |
| Fixed search plan, Nano reads the notices (the lite tier) | 98/105 | 1 | 0 | 98% (45/46) | 98% (45/46) | 0.29¢ |
| No model at all (fixed plan, pattern reader, rules) | 87/105 | 2 | 10 | 95% (37/39) | 80% (37/46) | 0¢ |

- **Nemotron alone invents recalls.** All five of its wrong red tags cite a recall number and a reason, such as "CPSC 23-231, Model 53101-209 is explicitly listed" for a ZWILLING kettle that recall doesn't list. Tagout's rules can't do that: red needs your code printed in the notice.
- **The first run was worse, and it says so.** The first full run got 98 of 105: 2 units wrongly red and 2 recalled units cleared. Each miss was traced and fixed in code with a unit test (a lot list cut short at its first group, a date code, a one-sided date window, an FDA page replacing a record's text, a brand field openFDA leaves empty, a trailing X read as a wildcard). One expected answer was wrong and was corrected: a Jan 2026 recall covers all lots of one distributor's Claritin. The numbers above are measured on cases that shaped those fixes; the first run is the fairer estimate for new ones. Both are on [/proof](https://tagout-recalls.vercel.app/proof).
- **Where the agent earns its place.** With the same rules, the fixed search plan is nearly as safe on red tags but sends more needless "check the label" tags on things nobody recalled (3 of 8 right vs 7 of 8), and costs a ninth as much. So it became the fallback, not the default.
- **Limits.** One run per arm, not an average. We picked the cases. Recalled units come from notices that print a code; a recall that prints none can only ever be orange.

Reproduce it (every HTTP response is cached, so a re-run reads the same data and costs nothing):

```bash
node eval/verify.mjs                                          # ground truth against the agencies
npx tsx --conditions=react-server eval/run.ts tagout          # one arm; also alone-ultra, search-ultra, fixed-plan-nano, rules, ...
node eval/score.mjs                                           # eval/summary.json and the table above
node eval/spend.mjs                                           # what the eval spent on Token Factory
```

The whole eval, including the runs thrown away while the harness was fixed, cost $4.66 of Token Factory tokens.

## What happens in a check

```mermaid
flowchart LR
  A[Your list or a label photo] --> B[Read into items<br/>Nemotron 3 Ultra · photos: Qwen3.8 27B]
  B -->|codes not in what you typed are dropped| C[Agent searches with tools<br/>Nemotron 3 Ultra]
  C --> D1[NHTSA vehicles]
  C --> D2[NHTSA car seats]
  C --> D3[CPSC]
  C --> D4[openFDA]
  C --> D5[Tavily search + extract<br/>newsrooms, USDA FSIS, makers]
  D1 & D2 & D3 & D4 & D5 --> E[Read each notice's model and lot list<br/>Nemotron 3 Ultra]
  E -->|codes not printed in the notice are struck| F[Deterministic matcher]
  F --> G{Tag}
  G --> R[Do not use]
  G --> O[Check the label]
  G --> K[Checked]
```

1. **Read.** Nemotron turns each line into a kind of product, a brand and the codes a recall turns on (model, lot, VIN, UPC, NDC). Each code it returns must appear in what the person typed or it is dropped. VINs are decoded with NHTSA's vPIC. Label photos are read by Qwen3.8 27B on Token Factory, with Gemma 3 27B as its fallback (Token Factory has no NVIDIA vision model today).
2. **Search.** Nemotron 3 Ultra runs an agent loop with six tools: NHTSA vehicle recalls, NHTSA child-seat recalls, CPSC (SaferProducts.gov), openFDA enforcement reports, Tavily search and Tavily extract. It reads results and searches again with better words (CPSC files a space heater under "tower heaters"). It always runs a Tavily search too, because the databases trail the agencies' newsrooms by one to six weeks, and USDA FSIS is only reachable through the web. A few rules keep recalls the model may not drop: any notice containing the item's own code, a brand's car-seat campaigns, and a brand's FDA recalls of the product when no lot was given.
3. **Read the notices.** CPSC prints model numbers only in prose ("The model 'TYPE SRTH' is printed on the silver rating label"). Nemotron reads the affected models, lots, UPCs and date windows from each notice. Every code is then looked up in the notice's text, character for character; anything not printed there is struck, and the check says so.
4. **Match.** [`lib/match.ts`](lib/match.ts) compares the household's codes with each list, without a model: exact codes, printed ranges (`2LC1234 through 2LC1240`), family codes (`5160X`, in model lists only), TYPE codes and manufacture-date windows, open at one end or both. When the reader's list missed a code that the notice's own text prints, the text wins. A near miss (`CT22425` vs `CT22425B`), or a model match when the recall is limited to date codes that yours isn't, is orange, never red. Cars are orange at most: NHTSA has no public per-VIN API, so the tag links to its VIN lookup.

The tags follow industrial lockout/tagout colours:

| Tag | Meaning |
|---|---|
| 🟥 **Do not use** | A code printed on your product is on the recall's list. Remedy and contact shown. |
| 🟧 **Check the label** | The product line is recalled; yours isn't confirmed either way. The tag says where the code is printed. |
| 🟩 **Checked** | No recall lists it on the day of the check; the sources searched are named. |

## How Nemotron and Nebius Token Factory are used

All model calls go to **Nebius Token Factory**'s OpenAI-compatible API (`https://api.tokenfactory.nebius.com/v1`) from [`lib/nebius.ts`](lib/nebius.ts).

| Role | Model | How | Measured alternative |
|---|---|---|---|
| Read the household's list | `nvidia/Nemotron-3-Ultra-550b-a55b` | Strict `json_schema`; every code verified against the input | Super filed 11 of 105 eye drops and foods as products (the wrong database); Nano dropped a car's year |
| Search agent | `nvidia/Nemotron-3-Ultra-550b-a55b` | OpenAI-style `tools`, parallel tool calls, up to 6 rounds, forced `finish` on the last | On 18 cases, Super was right on 17 at half the cost and Nano on 15: too few to move the agent |
| Read each recall notice | `nvidia/Nemotron-3-Ultra-550b-a55b` | Strict `json_schema`; codes verified against the notice text | Super: 1 unit wrongly red; Nano: 2 |
| Lite tier notice reader | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | With the fixed search plan, once the day's Ultra budget is spent | 98 of 105 right, none cleared, 0.29¢ an item |
| Fallback for every role | `nvidia/nemotron-3-super-120b-a12b` | Same calls; used when the first model errors or times out | |
| Read label photos | `Qwen/Qwen3.8-27B`, then `google/gemma-3-27b-it` | Vision chat with `json_schema` | |

The track asks for Ultra where reasoning is hard and Nano or Super for the everyday calls. We measured each size in each role and kept Ultra where a cheaper model made a mistake that matters (a wrong red tag, a medicine searched in the wrong database). Where Nano held up, it now runs: when the demo's daily Ultra allowance is spent, checks drop to the **lite tier** (fixed plan plus Nano reading the notices, about a ninth of the cost), where they used to drop to no model at all (87 of 105, 10 recalled units cleared). Past the lite allowance too, the rules-only plan still runs, and the page says which tier a check used.

A full check costs about **2.6¢ an item**; the five-item showcase took 37 Token Factory calls and about 114k tokens. Each finished check reports its own calls and tokens under "How this check ran". Model chains are set by env (`NEBIUS_AGENT_MODELS`, `NEBIUS_READER_MODELS`, `NEBIUS_INTAKE_MODELS`, `NEBIUS_LITE_READER_MODELS`, `NEBIUS_VISION_MODELS`).

## How Tavily is used

[`lib/sources/web.ts`](lib/sources/web.ts) calls Tavily at runtime on every check:
- **Search**, limited to `cpsc.gov`, `nhtsa.gov`, `fda.gov`, `fsis.usda.gov`, `recalls.gov` and `foodsafety.gov`, plus a maker's domain when the agent asks for one. It catches recalls newer than the databases (CPSC's newsroom runs about a week ahead of its API) and USDA FSIS meat and poultry recalls, whose API turns away automated clients.
- **Extract**, to read a recall page in full when the snippet doesn't show which models or lots are affected.
- A `cpsc.gov` page that CPSC's database also has is swapped for the database record, so tags cite recall numbers. The log says so: "Tavily web search … 6 found, 2 new" means four pages confirmed recalls already found and two added new ones.
- A recall that only Tavily found carries a badge on the tag: **Ahead of the database** when CPSC's database didn't have it on the day of the check, **Found by Tavily** otherwise (with the USDA note for FSIS recalls).
- [This check](https://tagout-recalls.vercel.app/check/vk9vuyk3zi) (Oct 15) shows both cases: an Oct 8 FDA company announcement for Gardeners Basics broccoli sprouting seeds that openFDA had no report for (matched on its UPC, tagged **Ahead of the database**), and a USDA FSIS recall of Ukrop's Chicken Cobbler (establishment P-19979), reachable only through Tavily.
- In the eval, the Vornado heater's red tag came from the CPSC newsroom page Tavily found, after the database record's own text failed to give up the code.

## Watch mode

**Watch these things**, under any finished check, saves the typed list (photos aren't kept) and gives it a link. From then on Tagout does the looking:

- **A daily sweep reads each new recall once** ([`lib/sweep/run.ts`](lib/sweep/run.ts)). It pulls the last 30 days of CPSC recalls (by recall date, plus records CPSC re-published since the last run), the CPSC newsroom feed (a week ahead of the database), openFDA's drug, food and device enforcement reports, NHTSA's recalls for each distinct watched vehicle and car-seat brand (NHTSA has no "published since" query), and USDA FSIS through one Tavily search.
- **An inverted index matches them against every watch** ([`lib/sweep/index.ts`](lib/sweep/index.ts)): the brands and printed codes of every watched thing, from each watch's newest check. A recall goes on only if it names a watched brand for the same kind of product (a Vornado steamer recall doesn't touch a Vornado heater) or prints a watched code. The rest cost nothing.
- **Nemotron reads each of those once.** Readings are cached in storage by source, recall number, a hash of the exact text read and the model, so the same wording is never read twice, by the sweep or by a check (a check reports the readings it reused). The deterministic matcher then hangs the tag, exactly as in a check.
- **The recalls a watch already cites are compared with the agency's current record.** A changed record is re-read and re-matched; one missing from its agency on two sweeps running is reported as no longer listed.
- **Each watch gets an event log and an Atom feed**: `/watch/<id>/feed.xml` (stable entry ids, each linking to the watch page) and `/api/watches/<id>/events` (JSON). Events: **new recall** (red or orange), **recall changed**, **recall no longer listed**, and **tag changed** after a "check again now".
- **Opening a watch runs nothing.** "Check again now" queues a full check of the list at most once an hour (every six hours, on the lite tier, for the showcase watch), under the same budget as any check; what it changed goes into the same log.

Cost grows with recalls, not households. Measured on Oct 25 against the production watches: 409 recalls in the 30-day window, 13 agency calls, 1 Tavily credit, 0 Token Factory calls (no new recall touched a watched brand), about 10 seconds. A recall that does touch a watch costs one Nemotron 3 Ultra reading, once (measured: 329 + 663 tokens, 0.23¢, for CPSC 27-040). Even if every one of the roughly 14 new recalls a day touched someone's list, that is about 3¢ a day for all households together; a watch itself adds two small storage reads a day. Every run writes its report, with its calls, tokens, cents and Tavily credits, to `sweep/runs/` in storage.

**Scheduling.** [`vercel.json`](vercel.json) runs `GET /api/cron/sweep` once a day at 06:00 UTC (Vercel Hobby runs daily crons somewhere within that hour). Vercel sends `Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` set, the route refuses to run.

The same sweep runs as a standalone job ([`scripts/sweep.mts`](scripts/sweep.mts), [`Dockerfile`](Dockerfile)), for example as a **Nebius AI Cloud Serverless Job**:

```bash
npx tsx --conditions=react-server scripts/sweep.mts --dry --no-model     # measure what would be read: no writes, no model
npx tsx --conditions=react-server scripts/sweep.mts --prefix=sweep-test/ --gcloud --max-reads=1   # trial run in the real bucket, under sweep-test/
docker build -t tagout-sweep .
docker run --rm -e NEBIUS_API_KEY -e TAVILY_API_KEY -e GCS_BUCKET -e GCS_SA_KEY tagout-sweep
```

On Nebius: push the image to Nebius Container Registry (`docker tag tagout-sweep cr.<region>.nebius.cloud/<registry-id>/tagout-sweep:1`, then `docker push` it), create a Serverless Job from it on a CPU preset with the env vars above (the job needs a way into the bucket: `GCS_SA_KEY`, a service-account key, or `GCS_ACCESS_TOKEN`), and run it daily (`nebius ai job create --help` lists the flags for your CLI version). Or let the job only trigger the deployed route: `scripts/sweep.mts --remote` with `CRON_SECRET` needs no storage credentials. Run one scheduler, not both; a second run that starts while one is in progress stops at once.

**When the model isn't there.** A tag is never green when no model answered for the thing (the rules tier, an empty balance, every call timing out): it is held at orange with "Model unavailable: not cleared". Model calls are retried only on 429, 5xx and timeouts (honouring Retry-After); 401, 402 and 403 end the chain at once. Each check has a 200-second deadline: after 150 s the remaining things run on the lite tier, and after 200 s no model call starts. A daily GitHub Actions canary ([`.github/workflows/token-canary.yml`](.github/workflows/token-canary.yml)) makes one 1-token Nemotron Nano call and fails on a 401, 402 or 403, so GitHub emails the owner.

## Who pays

Households use it free. The people who lose money when a recall doesn't reach an owner would pay to run it for their customers:
- **Home, renters and auto insurers, and home-warranty firms**: a recalled heater or dryer is a claim waiting to happen. They already hold the list of insured items.
- **Property managers**: appliances in every unit, one watch per building.
- **Baby-registry retailers and pediatric practices**: car seats, bassinets and formula are where recalls hit hardest, and they know what was bought.
- **The recalling firms**: CPSC's own numbers say direct notice moves consumer response from 6% to 50%. A watch's feed is a direct channel the owner set up: a new recall that lists their code reaches them without their having to look.

At 2.6¢ an item for a full check (0.29¢ on the lite tier), checking a 20-item household every month costs about $6 a year on the full tier, or 70¢ on the lite tier.

## Data sources

| Source | Endpoint | Used for |
|---|---|---|
| NHTSA vPIC | `vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues` | VIN → make, model, year |
| NHTSA recalls | `api.nhtsa.gov/recalls/recallsByVehicle`, `api.nhtsa.gov/childSeats/bySearch` | Vehicle and child seat recalls, "do not drive" flags |
| CPSC | `saferproducts.gov/RestWebServices/Recall`, CPSC recalls RSS | Consumer products |
| FDA | `api.fda.gov/{drug,food,device}/enforcement.json` | Drugs, food and supplements, medical devices (an optional `OPENFDA_API_KEY` raises the per-IP limit) |
| Tavily | `api.tavily.com/search`, `/extract` | The newest recalls, USDA FSIS, full recall pages |

All are public and keyless except Tavily and Token Factory.

## Screens

**The home page**: a real check pinned to the pegboard, one tag per thing.

![Tagout's home page: a household's labels, each with a tag. A Vornado heater is tagged Do not use, a Honda CR-V Check the label, a Lasko heater Checked.](docs/screens/home.png)

**Every CPSC recall of 2026, one tag each**, by month and hazard (live, on the home page):

![A wall of small tags, one per CPSC recall in 2026, grouped by month and coloured by hazard](docs/screens/wall.png)

**Anatomy of a red tag:** the notice's own wording, the code read from it, the same code on the plate.

![CPSC recall 26-532's text with TYPE SRTH highlighted, joined by an equals sign to the Vornado rating plate with a red tag](docs/screens/anatomy.png)

**The eval** ([/proof](https://tagout-recalls.vercel.app/proof)): the same 105 cases five ways, then every case and every answer.

![The proof page: five plates comparing Tagout, Nemotron with Tavily, Nemotron alone, the fixed plan with Nano, and no model, on right answers, false alarms, recalled units cleared and cost](docs/screens/proof.png)

**A watch** checked again a week later: what changed since the last check, then the tags.

![A watch page: watching 5 things, what changed since 8 Oct 2026, and the check's tags](docs/screens/watch.png)

| Check with the agent's log | Phone |
|---|---|
| ![A check: the Vornado heater's label with a red tag, the agent's searches, the matching code next to CPSC recall 26-532, and what to do](docs/screens/check-log.png) | ![The same check on a phone](docs/screens/phone-check.png) |

## Run it

```bash
npm install
cp .env.example .env.local   # add NEBIUS_API_KEY and TAVILY_API_KEY
npm run dev                  # http://localhost:3000
```

Checks and watches are stored as JSON under `.data/` locally. In production they live in a private Google Cloud Storage bucket, reached keylessly: the function's Vercel OIDC token is exchanged for a Google access token through a workload identity pool (`GCS_BUCKET`, `GCS_WIF_AUDIENCE`), so no key exists anywhere. A Vercel Blob store (`BLOB_READ_WRITE_TOKEN`) also works; it was the first store, until the Hobby account's shared monthly Blob allowance ran out on Oct 8. See [`lib/storage.ts`](lib/storage.ts).

```bash
npm test           # matcher, watch, sweep index and events, feed, never-green, redirect and web-filter unit tests
npm run typecheck
npx tsx --conditions=react-server scripts/try-check.ts "Vornado heater TYPE SRTH\n2019 Honda CR-V"   # one check in the terminal
```

## Code map

| Path | What |
|---|---|
| `lib/agent/intake.ts` | List and photo → items; typed-code verification; fixed parser fallback |
| `lib/agent/investigate.ts` | The Nemotron tool loop, tool runners, must-keep rules, fixed plan |
| `lib/agent/read-notice.ts` | Reads model/lot lists and date windows from a notice and strikes codes it doesn't print |
| `lib/match.ts` | The deterministic matcher (tested in `test/match.test.ts`) |
| `lib/agent/verdict.ts` | Tag, headline and steps from the match |
| `lib/agent/run.ts` | One check as an event stream (NDJSON to the page); full or lite tier |
| `lib/budget.ts` | Per-visitor and daily allowances for the full and lite tiers |
| `lib/watch.ts`, `lib/watches.ts` | Watches and what changed between two checks (tested in `test/watch.test.ts`) |
| `lib/sweep/` | The daily sweep: inverted index, events, run, store (tested in `test/sweep.test.ts`) |
| `lib/feed.ts` | A watch's Atom feed |
| `lib/sources/*` | NHTSA, CPSC, openFDA and Tavily clients, with the quirks measured on day one |
| `eval/` | Cases, ground-truth check, cached harness, scorer, results ([/proof](https://tagout-recalls.vercel.app/proof)) |
| `components/label`, `components/tag` | Product labels (rating plate, door-jamb sticker, car seat label, carton) and the lockout tags |

## Honest notes

- U.S. recalls only. A product sold only elsewhere may be recalled there without a U.S. notice.
- Green means nothing was found that day, not that a product is safe.
- CPSC's API returns a fake error record and caches it per URL, so every call carries a cache-buster and retries. Its `Model` field is always empty, which is why model numbers are read from the prose.
- The demo has per-visitor and daily limits on model calls: 12 checks per 10 minutes and 15 a day per address on the full tier, 60 a day in all (`IP_DAILY_MODEL_CAP`, `DAILY_MODEL_CAP`); then 30 and 120 on the lite tier (`IP_DAILY_LITE_CAP`, `DAILY_LITE_CAP`); past both, the rules-only plan.
- The vision fallback changed on Oct 5: GLM-5.3-Flash took over three minutes to answer a one-line prompt, so Gemma 3 27B (7 s on the sample label) now backs up Qwen3.8 27B.
- Tagout isn't affiliated with NHTSA, CPSC, FDA or USDA. Always confirm with the recall notice; every tag links to it.

## License

MIT. See [LICENSE](LICENSE).

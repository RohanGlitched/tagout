# Held-out eval, Oct 25 2026

The 105 cases in `cases.json` were used while fixing Tagout, so 104/105 on them is an in-sample number. This is a fresh set that no fix has seen: 39 cases written on Oct 25, committed before any arm ran, and run once.

## What was held out

- **Committed first.** `cases-holdout.json` went in as commit `d9dce10` (Oct 25 00:37:01 IST) and its ground truth as `e2d6481` (00:37:05). Every arm ran after that, from a detached worktree at `a1d8b21`, so nobody's uncommitted work could leak in. The code under test is `lib/` as of Oct 15 20:28 IST, plus one change made earlier on Oct 25: Nemotron 3.5 Super VL reads label photos first.
- **None of these recalls is in the tuned set.** `verify-holdout.mjs` checks this for every case.
- **27 database cases.** These recalls were already in an API Tagout queries:
  - CPSC recalls posted Oct 15 and Oct 22;
  - openFDA's report of Oct 14 (on Oct 25 openFDA had nothing newer);
  - NHTSA campaigns received Oct 19 and Oct 21.

  The mix: 14 recalled units with a code, 6 near misses, 6 lines with no code, 3 cars and 1 clean item.
- **12 lag-window cases.** These recalls were published Oct 16-22 and were in no database Tagout queries:
  - FDA company announcements (Natural Grocers mung beans, WinCo hoagie rolls, Lidl Gelatelli gelato, Starfish smoked salmon, Wedgewood veterinary compounds), none of which had an openFDA report;
  - a USDA FSIS recall (Kayem, 1.58 million lb). Tagout has no FSIS database tool.

  Only the web search can find these.
- **Forms.** 30 cases are clean lines. 8 are messy: a misspelt brand, a synonym, lowercase, no "model"/"lot" keyword, a dash dropped, or a label-style string like `leader dry eye drops LT25B01 EXP 02/2027`. 1 is a photo: CPSC's own image of the recalled Primark coin purse's price tag, which shows seven numbers and no brand.
- **Expectations.** These are the same as before, plus one new one, `flag` (orange or red, never green). It is used where a recall covers every unit, or is limited by dates the line doesn't give. Green would clear a recalled unit; orange and red are both defensible.
- **Ground truth.** `verify-holdout.mjs` checks every case without any Tagout code (39/39):
  - the code is printed in the CPSC or FDA record, or in the notice text saved in `notices-holdout/` (read in a browser, because fda.gov and fsis.usda.gov refuse scripts);
  - near-miss codes are printed in no CPSC or FDA record;
  - lag-window recalls are absent from the APIs.

## Results (run once; 95% exact intervals)

| Arm | Right | Red recall | Wrongly red | Wrongly cleared | Database | Lag window | Model cost per item | Tavily credits per item | Cost per item with Tavily |
|---|---|---|---|---|---|---|---|---|---|
| **Tagout** (Ultra agent and readers) | **31/39** (64-91%) | 14/19 (49-91%) | **0/10** (0-31%) | 4/31 | 25/27 | 6/12 | 2.65¢ | 2.77 | 4.87¢ |
| Tagout, Tavily off | 27/39 | 12/19 | 0/10 | 12/31 | 25/27 | 2/12 | 2.16¢ | 0 | 2.16¢ |
| Fixed plan, Ultra readers | 29/39 | 13/19 | 0/10 | 7/31 | 23/27 | 6/12 | 1.16¢ | 1.72 | 2.53¢ |
| Fixed plan, Nano reader (the lite tier) | 30/39 | 13/19 | 0/10 | 6/31 | 23/27 | 7/12 | 0.28¢ | 1.72 | 1.66¢ |
| Lite tier, Tavily off | 26/39 | 11/19 | 0/10 | 12/31 | 23/27 | 3/12 | 0.26¢ | 0 | 0.26¢ |

- **Forms (Tagout).** Clean lines 24/30, messy lines 6/8, photo 1/1. All 5 messy database lines were right. Two of the 3 messy lag-window lines came out orange, not red.
- **Model cost** is Token Factory list price for every call a case made. **Tavily** is priced at the pay-as-you-go $0.008 per credit (docs.tavily.com, API credits page, checked Oct 25):
  - a basic search is 1 credit;
  - a basic extract is 1 credit per 5 successful URLs, and Tagout sends one URL per extract, so each extract is counted as a credit (an upper bound).

  At that rate Tavily costs Tagout about 2.2¢ an item, close to the 2.65¢ of Nemotron.
- **Median time.** 17.5 s for Tagout, over the 13 cases that ran with no cached call. The other arms reused cached calls, so their times aren't meaningful.

## What Tavily contributes (measured, same cases, same code)

- **Without Tavily, Tagout cleared all 10 lag-window recalls as green.** These are the cases that should be orange or red: recalled lots, an all-lots allergen recall, an FSIS recall and a veterinary recall.
- **With Tavily it flagged 8 of the 10:**
  - 3 red: Gelatelli lot 085261 in both the clean and the messy line, and the WinCo hoagie-roll UPC;
  - 5 orange, each citing the FDA notice;
  - the 2 Kayem (FSIS) lines stayed green.
- **Net effect.** Turning Tavily off took Tagout from 31/39 to 27/39 right, and its wrongly cleared count from 4 to 12. The lite tier went from 30/39 to 26/39, and from 6 to 12 cleared.
- **On the 27 database cases Tavily changed nothing:** 25/27 with it and without it.
- **Tuned set.** Turning the web step off in the no-model arm (free, replayed from the cache) took it from 87/105 to 81/105, and its recalled units cleared green from 10 to 19 (`replay-summary.json`, arm `rules-noweb`).
- **Caveat.** On the database cases, Tavily also turned one green near miss orange (h12, still right). In the tuned set's no-model arm it caused one wrong red (n12) that the Tavily-off variant doesn't have.

## What went wrong on the held-out set (not fixed; fixing would tune on it)

- **h15: a Gatorade lot with a space in it, cleared green by every arm.** The line was `Gatorade Lemon Lime 28 oz, lot 091026 DL`. The FDA lot search found H-0009-2027, which prints `Lot 091026 DL`, and the tag even says a recall exists for the brand. But two checks missed the lot:
  - the notice reader listed it as `091026`, dropping the `DL` line code (`eval/replay.ts tagout h15 results-holdout cases-holdout.json` shows this);
  - `printedIn()` in `lib/match.ts` splits the notice text on spaces and compares one token at a time, so a two-part code can never match.
- **h08: Hatsan Blitz air rifle (all units recalled), cleared green by every arm.** CPSC's title search returned 27-025 (and an old Striker recall), but no notice reached the tag. The cause is probably the title's "HatsanUSA" not matching the brand "Hatsan" as a word; this is not yet traced.
- **h38 and h39: Kayem hot dogs (FSIS), cleared green by the agent.** The fixed plan's single web search flagged both orange.
- **Lag-window recalled units came out orange instead of red in 4 of 6 cases** (h32, h37, h40, h42). The web copy Tagout read didn't let the matcher confirm the code. That is safe, but it is not the exact answer.
- **Ladder.** The agent's edge over the fixed plan is small on this set: 31 against 29 (Ultra readers) and 30 (Nano reader). The agent was better on database cases (25/27 against 23/27) and worse on the FSIS pair.

## Label photos: Nemotron 3.5 Super VL

- **Model id.** `nvidia/Nemotron-3.5-Super-VL`, from `GET /v1/models`.
- **How it was run.** `scripts/vision-eval.ts` sends each photo through the app's own photo path (`readItems`), one model at a time. The results are in `photos/vision-results.json`.

| Photo | Nemotron 3.5 Super VL | Qwen3.8 27B | Gemma 3 27B |
|---|---|---|---|
| Sample Vornado label 1 (TYPE SRTH, serial, date code) | 3/3 codes, 5.3-6.4 s, ~1.4k+1.3-1.8k tokens | 3/3, 2.1-3.4 s | 3/3, 15-46 s |
| Sample Vornado label 2 (model VH-SRTH-BLK, TYPE, serial, date code) | 4/4, 5.0-5.6 s, ~0.75k+2.0k tokens | 4/4, 1.7-2.7 s | 4/4, 7-16 s |
| CPSC's photo of the Primark tag (model 2595301) | no answer twice: it used the whole 2,500-token output budget reasoning | no answer once, read it once (held-out run) | read it |

- **Decision: Nemotron 3.5 Super VL leads `MODELS.vision`; Qwen and Gemma stay as fallbacks.** It read the sample labels exactly. When it runs out of budget, the same call falls through the chain. In the held-out run (h07), VL failed, Qwen read the tag, and the case came out red.
- **Budget probe.** With an 8,000-token budget, VL read the real tag correctly (about 3,000 tokens, 2,900 of them reasoning, 7.4 s).
- **One-line fix (in `lib/agent/intake.ts`, not made here).** Raise the photo call's `maxTokens` from 2,500 to about 6,000, or turn reasoning off for it.

## Replaying (`npm run eval:replay`)

- **What it does.** It re-runs every recorded arm offline from `eval/.cache` against the current code: no network, no keys, no spend. Then it re-scores into `replay-summary.json` and compares with the recorded tags and with the committed replay. It exits 1 if any tag moved since the committed replay.
- **Held-out set.** `npm run eval:replay -- --holdout` does the same for this set. All 5 arms replay with no cache misses.
- **Determinism.** Two offline replays in a row gave identical tags.
- **Tagout on the 105, current code: 105/105, every call from the cache.**
  - Against the code that shipped after Oct 15, 11 tuned cases made model calls the cache didn't have. The code changed under them: listing pages filtered out of web results, and the struck-code cleanup.
  - Those 11 were filled with one live run, $0.09 of Token Factory and keyless Tavily, into `results-current/`.
  - Two cases changed tag against the recorded run, both for the better and both still right or now right: n12 green→orange, k04 orange→green.
- **What still needs live calls to re-measure:**
  - `search-ultra`: 5 cases (p03 p24 n02 n12 c10). The web results it is shown changed with the listing filter.
  - `super-readers` p04, `super-agent` c08, `nano-agent` v08.
  - The fixed plan with Ultra readers on the 105: 69 cases need Ultra notice reads that were never cached (about $0.4, more than this pass's budget). It is measured on the held-out set above instead.
- **Agency misses that don't matter.** The openFDA "has this firm reported lately" check (added after Oct 15) misses the cache on old runs. It fails as an unreachable API would, and it only adds an "ahead of the database" badge, never a tag.
- **Getting the cache.** The cache (`eval/.cache`, about 3,300 files and 22 MB) is not in git. Ask the team for `eval-cache.tgz` and unpack it to `eval/.cache`, or point `EVAL_CACHE` at a copy.
  - Before sharing it, run `node scripts/cache-scrub.mjs --fix <out-dir>`. It checks every file against the real key values in `.env.local` and `../.env.keys` and against key-shaped patterns, and writes a redacted copy.
  - On Oct 25 it found no matches. An earlier review reported two files with key-like strings; this pass could not reproduce that, so scrub anyway.

## Caveats to state with these numbers

- **Small and recent.** 39 cases, so the intervals are wide: 31/39 is 64-91%. Wrongly red 0/10 bounds the false-red rate only below 31%. The tuned set's 0/59 bounds it below 6% (two-sided) or 5% (one-sided), but that set is in-sample.
- **Database dates.** No database had a record newer than Oct 14 (openFDA) or Oct 22 (CPSC) on Oct 25. So the database part is the newest records available, plus NHTSA campaigns from Oct 19-21. It is not strictly "published Oct 16-29": the CPSC Oct 15 postings and openFDA's Oct 14 report came out before the window.
- **Run once, with one restart.** The Tagout arm's first attempt was stopped after 17 cases by a harness bug: retries reused an expired timeout during Tavily's keyless rate limit. Calls that had succeeded were reused from the cache, and the rest ran again. The fixed-plan arm hit its spend cap at case 34; its last 5 cases were then completed entirely from cached calls.
- **Tavily mode differed by arm.** It was keyed for most Tagout and lite calls (84 credits) and keyless for 36 calls. Keyless and keyed search the same index, as far as we know.
- **h03 differs between the run and the replay in the lite arm.** It was green when run and orange on replay; both are right. A response that failed during the run was probably cached later by another arm.
- **Ground truth for the lag window rests on saved excerpts** of the FDA and FSIS pages (`notices-holdout/`). The Kayem cases are scored orange-or-red because the product list is a PDF we did not parse.
- **The code measured is commit `a1d8b21`.** Changes made to `lib/` after it are not in these numbers. On Oct 25 another engineer had uncommitted work in `lib/agent`, `lib/match.ts` and `lib/sources`.

## Spend for this pass

- **Token Factory: $1.80 through the harness** (ledger `eval/.cache/spend.json`: $3.1447 before, $4.9448 after):

  | Run | Spend |
  |---|---|
  | Tagout arm, both attempts | $1.04 |
  | Tagout with Tavily off | $0.47 |
  | Fixed plan, Ultra readers | $0.17 |
  | Lite tier | $0.03 |
  | Lite tier with Tavily off | $0 |
  | Refill of the 11 tuned cases | $0.09 |

  About $0.02 more went on the vision comparison and probes.
- **Tavily: 84 credits on the key**, plus 36 keyless calls. The `/usage` counter lags by about an hour.

## Files

| Path | What it is |
|---|---|
| `cases-holdout.json` | The cases |
| `verify-holdout.mjs`, `verified-holdout.json` | Ground-truth check and its output |
| `notices-holdout/` | Notice texts for the lag window |
| `photos/` | Label photos and vision results |
| `results-holdout/` | One file per arm |
| `holdout-summary.json` | Scores, intervals, Tavily ablation, run facts |
| `holdout-meta.json` | Commits, run notes, spend |
| `results-replay/`, `replay-summary.json` | Offline replay of the 105 |
| `results-holdout-replay/`, `holdout-replay-summary.json` | Offline replay of this set |
| `results-current/` | The 11 refilled tuned cases |

Commands:

- `npm run eval:holdout:score` re-scores this set.
- `npm run eval:replay` replays everything offline.

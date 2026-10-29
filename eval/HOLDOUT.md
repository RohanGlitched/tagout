# Held-out eval, Oct 25 2026

The 105 cases in `cases.json` were used while fixing Tagout, so 104/105 on them is an in-sample number. This is a fresh set that no fix has seen: 39 cases written on Oct 25, committed before any arm ran, and run once.

## What was held out

- **Committed first.** `cases-holdout.json` went in as commit `d9dce10` (Oct 25 00:37:01 IST) and its ground truth as `e2d6481` (00:37:05). Every arm ran after that, from a detached worktree at `a1d8b21`, so nobody's uncommitted work could leak in.
- **What can be checked from outside.** The cases (`d9dce10`) and all runs were committed locally on Oct 25 and pushed together on Oct 24 at 20:47:55 UTC (02:17 IST on Oct 25); commit times are local, set by whoever commits, so GitHub alone can't show the cases came first. The file has not changed since: sha256 of `eval/cases-holdout.json` is `3f6243656600030a76bdbd793e51ce151a81eb2f89f7b08e96836285a8e37bd0` (also in `holdout-meta.json`). The next held-out set is pushed, and tagged, before anything runs on it (see "Held out #2"). The code under test is `lib/` as of Oct 15 20:28 IST, plus one change made earlier on Oct 25: Nemotron 3.5 Super VL reads label photos first.
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
  - a basic extract is 1 credit per 5 successful URLs, and Tagout sends one URL per extract, so each extract is counted as a credit (an upper bound). Rows recorded from Oct 25 (`ed2dc77`) carry `tavilyCredits`, billed exactly that way from each response, and the app's own tally (`engine.tavily`) does the same.

  At that rate Tavily costs Tagout about 2.2¢ an item, close to the 2.65¢ of Nemotron.
- **Median time.** 17.5 s for Tagout, over the 13 cases that ran with no cached call. The other arms reused cached calls, so their times aren't meaningful.

## What Tavily contributes (measured, same cases, same code)

- **Without Tavily, Tagout cleared all 10 lag-window recalls as green.** These are the cases that should be orange or red: recalled lots, an all-lots allergen recall, an FSIS recall and a veterinary recall.
- **With Tavily it flagged 8 of the 10:**
  - 3 red: Gelatelli lot 085261 in both the clean and the messy line, and the WinCo hoagie-roll UPC (2 of the 3 on cases that want red on an exact code; the messy Gelatelli line, h34, accepts orange or red);
  - 5 orange, each citing the FDA notice;
  - the 2 Kayem (FSIS) lines stayed green.
- **Count corrected on Oct 25.** `holdout-report.mjs` used to count only the reds on the 6 exact-code cases, so `tavilyAblation.*.lag.withTavily.red` said 2 and /proof printed "2 red". It now counts every red among the 10 lag-window recalls (`red`: 3 for Tagout, 2 for the lite tier) and keeps the narrower count as `redOnExactCode` (2 and 2). Only those fields of `holdout-summary.json` were regenerated; every other held-out number is unchanged.
- **Net effect.** Turning Tavily off took Tagout from 31/39 to 27/39 right, and its wrongly cleared count from 4 to 12. The lite tier went from 30/39 to 26/39, and from 6 to 12 cleared.
- **On the 27 database cases Tavily changed nothing:** 25/27 with it and without it.
- **Tuned set.** Turning the web step off in the no-model arm (free, replayed from the cache) took it from 87/105 to 81/105 on the Oct 15 replay, and its recalled units cleared green from 10 to 19; at the current code it is 83/105 to 78/105 (`replay-summary.json`, arms `rules` and `rules-noweb`).
- **Caveat.** On the database cases, Tavily also turned one green near miss orange (h12, still right). In the tuned set's no-model arm it caused one wrong red (n12) that the Tavily-off variant doesn't have.

## What went wrong on the held-out set (as run; fixed afterwards, see "After the fixes")

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
- **One-line fix (in `lib/agent/intake.ts`, not made here).** Raise the photo call's `maxTokens` from 2,500 to about 6,000, or turn reasoning off for it. Made later in `cda64eb` (6,000 tokens; see "After the fixes").

## After the fixes (Oct 25; these 39 cases are no longer held out)

**These numbers come after reading the misses above and fixing them, so the 39 cases are now in-sample, like the 105.** The held-out numbers above (Tagout 31/39, measured once at `a1d8b21`) stay the headline. The fixes are in commits `9677671`, `37ee47f`, `cda64eb` and `a9a0f8f`, on top of the Oct 25 changes to `lib/` (`3adbbab` to `2965b11`). Every rule is general: no case ids or brand names in the logic. `test/holdout-fixes.test.ts` covers each failure mode on made-up examples, with near misses that must still not match.

What each miss was, and what changed:

- **h15, a lot printed in two parts (`091026 DL`).** Three causes:
  - openFDA's own lot parse split on spaces and dropped `DL`;
  - `splitIds` split a reader's `091026 DL` the same way;
  - `printedIn()` compared one word at a time.

  Now a lot list keeps a 1-3 letter capital line code with the number before it, and `printedIn()` finds a code printed in parts. It joins words only where the code itself breaks (a space or dash in it, or digits meeting letters). It never matches a number the text prints with a line code after it.
  - Near misses stay out: `091226 DL` (h16) and `091026 TL` don't match, and digits never join across a date (`0607` in `JUN 06 07`).
  - A lot that is a listed lot minus its line code (`091026` against `091026 DL`) is orange, not green.
  - At this commit the Ultra reader runs out of its 1,500 tokens on this record, so the record's own lot list decides.
- **h08, a whole product line with no codes.** CPSC's title says "HatsanUSA", and `brandIn()` needed "Hatsan" as a separate word, so the notice matched nothing and the tag was green. Two changes:
  - a brand written as one word with a company suffix (`usa`, `inc`, `llc`, ...) now counts;
  - a recall that prints no codes at all and names the brand in its text is orange for that brand's item, never green.

  Also, for a product with no model number, the brand's CPSC recalls of that kind of product stay whatever the agent picks.
- **h38 and h39, the FSIS recall (Kayem).** The agent did search the web and did read the FSIS page. But that page prints about 28,000 characters of menus before the announcement, and pages were cut at 16,000 characters, so the reader and the agent's excerpt saw only navigation. The agent then left the page out of `finish`. Three changes:
  - a long page is now read from its dateline (`WASHINGTON, Oct. 17, 2026 –`, `FSIS Announcement`, `Company Announcement Date:`) when the dateline sits past the middle of the window. Of the 182 pages read in the eval cache, only this one changes;
  - for food, drugs and devices with no lot, UPC or NDC, the brand's recalls on the official sites now stay whatever the agent chose, as FDA records already did. That includes range recalls such as "Recalls Meat and Poultry Products";
  - an undated web page is dated by its own dateline, so the brand's 2015-2025 recalls count as old.

  The `read_page` off-item refusal was not involved: both pages named the brand.
- **Lag-window units orange instead of red.**
  - **h32 and h40 are fixed.** The code on the item was a pack date typed without the word "lot" (`pack date 26-196`, or a bare `26-196`). A pack date, serial or bare code that the notice's lot list lists is now the lot, when the brand, UPC or model ties the item to the recall. A code the list doesn't print stays orange: the near miss h33, `26-161`, is orange. When the reader read no lists at all, the UPC and the pack code both printed in the text decide; either one alone doesn't.
  - **h37 and h42 stay orange, correctly for the data.** The Starfish salmon lot `D080-148` is in none of the text Tavily returns: not in search snippets, not in basic extract, and not in advanced extract (probed once; the same 3,153 characters with no product table). Orange is the most that text supports.
- **Found while tracing, in the fixed plan.** Notices were cut to the eight newest, with undated web pages sorted last. So a brand's eight old FDA records pushed out the week's company announcement (the lite tier cleared the mung beans this way). Undated pages now get the room the dated ones leave, and at least three.
- **Label photos.** The vision call now has 6,000 output tokens. On the Primark tag (h07), Super VL answered with about 3,900 tokens, and the Tagout arm tagged it red.

Results at `a9a0f8f`, and again at `ed2dc77` after the reasoning-budget change below (`holdout-after-fixes.json`, `results-holdout-after/`; the `a9a0f8f` rows are kept in it as `afterA9a0f8f`). Live calls ran only where the eval cache had no answer, and an offline replay of both arms gives the same 39 tags:

| Arm | Right | Wrongly red | Wrongly cleared | Database | Lag window | Model cost per item | Tavily credits per item |
|---|---|---|---|---|---|---|---|
| Tagout, first run (headline, `a1d8b21`) | 31/39 | 0/10 | 4/31 | 25/27 | 6/12 | 2.65¢ | 2.77 |
| Tagout, after the fixes (`a9a0f8f`) | 37/39 | 0/10 | 0/31 | 27/27 | 10/12 | 2.72¢ | 2.26 |
| **Tagout, after the reasoning change (`ed2dc77`)** | **37/39** | **0/10** | **0/31** | 27/27 | 10/12 | 2.81¢ | 2.21 |
| Lite tier, first run (`a1d8b21`) | 30/39 | 0/10 | 6/31 | 23/27 | 7/12 | 0.28¢ | 1.72 |
| Lite tier, after the fixes (`a9a0f8f`) | 33/39 | 0/10 | 1/31 | 24/27 | 9/12 | 0.29¢ | 1.56 |
| **Lite tier, after the reasoning change (`ed2dc77`)** | **35/39** | **0/10** | **1/31** | 26/27 | 9/12 | 0.19¢ | 1.56 |

The `ed2dc77` Tavily column is billed credits (an extract is 1 credit per 5 URLs read); the earlier rows count each call as a credit.

- **Still wrong, Tagout:** h37 and h42, orange where red is right (see above).
- **Still wrong, lite tier (`ed2dc77`):**
  - h37 and h42, the same as Tagout;
  - h43 green: the single web search didn't return the Wedgewood announcement;
  - h07 orange, held by the "never green without a model" guard: the fixed plan searches CPSC by brand, and the photo has none;
  - h23 and h24, orange at `a9a0f8f`, are now green and right: with reasoning off, Nano's notice reads answer instead of failing.
- **The 105 tuned cases** (`summary-current.json`, `results-after/`; `summary.json` is unchanged; only the Tagout and lite arms were re-run at `ed2dc77`, the other arms in `results-after/` are still `a9a0f8f`):
  - **Tagout: 105/105**, 0/59 wrongly red, 0/67 cleared, at `a9a0f8f` and at `ed2dc77`;
  - **lite tier: 101/105 at `ed2dc77`** (95/105 at `a9a0f8f`, 98/105 on Oct 15), 1/59 wrongly red (n12, as before), 0/67 cleared. v10-v12 are green again. Still wrong: n12 red, and k04, k06 and k09 orange where green is right.

  The fixes in this section changed no tag on the 105. An offline replay of the code just before them (`665dd4e`, whose `lib/` differs from `2965b11` by one line in `lib/wall.ts`), on the same cache, gives the same tags for both arms. The lite tier's three lost cases at `a9a0f8f` (v10-v12, clean cars orange) came from the earlier "never green without a model" change: Nano failed to read NHTSA's PDF pages within 1,500 tokens. The reasoning change brought them back.
- **Replay.** `npm run eval:replay` replays the 105 at `ed2dc77` with no Tagout model or Tavily cache misses (the lite arm misses two Nano calls that timed out live, d10 and v09, with the same tags), and `replay-summary.json` is rewritten; a second run exits 0. `holdout-replay-summary.json` is refreshed from `ed2dc77` too, so `npm run eval:replay -- --holdout` exits 0 at this code (Tagout 37/39 and the lite tier 35/39 replay exactly; the fixed plan with Ultra readers and Tagout with Tavily off need live calls for 7 and 2 cases).
- **Spend.** $0.36 of Token Factory through the harness (ledger $4.9448 → $5.3000):

  | Run | Spend |
  |---|---|
  | Held-out Tagout arm | $0.11 |
  | Held-out lite arm | under $0.01 |
  | 105 Tagout arm | $0.14 |
  | 105 lite arm | $0.01 |
  | Every other 105 arm | $0.09 |

  Tavily: 55 credits (53 keyed calls, plus 2 for the advanced-extract probe), and 15 keyless calls.
- **Spend for the reasoning-budget pass (`c3cdc1a`..`ed2dc77`).** About $0.21 of Token Factory: the harness ledger went from $5.2999 to $5.5046, and `eval/spend.mjs` (the cache at list prices, now including Super VL, Qwen and Gemma) from $6.7595 to $6.9467; the switch probes and the three sample photos on Super VL (about $0.004) ran outside the cache. Tavily: 1 keyed credit (ledger 456 to 457), no keyless calls.

### Reasoning control, tested

**Token Factory honours Nemotron's chat-template switch `chat_template_kwargs: {"enable_thinking": false}`; a `/no_think` line in the system prompt does nothing.** On one small extraction call each (two lots and a UPC), the switch took Nano from 116 to 56 completion tokens, Ultra from 314 (270 reasoning) to 43 (0 reasoning) and Super VL from 457 (413 reasoning) to 44 (0), all with the same answer; `/no_think` left 173, 306 and 237. On the eval cases: with reasoning off, the Nano reader got v11 and v12 right, but on v10 it padded its JSON with whitespace up to the cap, at 1,500 and again at 3,750 tokens, a decoding runaway rather than reasoning; with reasoning on and a 2.5x retry, v10 was right and v11 and v12 were cut off again at 3,750. The rule that shipped (`c3cdc1a`) is reasoning off for the Nano reader, plus one retry of any reply cut off with nothing usable, with 2.5x the cap and reasoning back on: v10, v11 and v12 all came out green, which is right, and the lite arm's output on the 105 fell from 547k to 217k tokens (0.30¢ to 0.23¢ an item), with 42 Nano replies cut off in 22 cases, each followed by a retry that finished. With reasoning off, the Ultra reader read h15's lot list in 350 tokens, where with reasoning on it had used up 1,500, and h15 was red. Super VL with reasoning off read every expected code on all three sample photos in 101-131 output tokens and 1.1-2.2 s (it had used 1.3k to 3.9k tokens and 5-7 s), and h07 was red. **So reasoning is off for the Nano notice reader and Super VL.** The Ultra notice reader keeps reasoning on, with the retry (h15 is red that way too): switching it off would change every Ultra read in the eval, and re-measuring those costs about $1-2, more than this pass's budget. `NEBIUS_READER_NO_THINK` and `NEBIUS_VISION_NO_THINK` set the model lists. The check's usage now counts `truncated` and `retried` calls, and eval rows count `truncated`.

### Two more arms, free from the cache (`holdout-arms-extra.json`)

`node eval/holdout-arms-extra.mjs` needs no model or Tavily calls. **Cascade ("lite first, Ultra only on red")**: every item runs on the lite tier, and an item the lite tier tags red is run again on the full agent and takes its tag.

| Arm (39 cases) | Right | Wrongly red | Wrongly cleared | Database | Lag window | Cost per item with Tavily |
|---|---|---|---|---|---|---|
| Cascade, first run (`a1d8b21`, held out) | 30/39 | 0/10 | 6/31 | 23/27 | 7/12 | 3.03¢ (14 of 39 escalated) |
| Cascade, at `ed2dc77` (in-sample) | 35/39 | 0/10 | 1/31 | 26/27 | 9/12 | 3.20¢ (18 escalated) |
| Rules only, all 39 measured (`6149853`, filled Oct 25) | 24/39 | 0/10 | 0/31 | 17/27 | 7/12 | 1.09¢ (Tavily only, priced as if keyed) |

- **On this set the agent never overturned a lite red**, so the cascade scores what the lite tier scores and costs about twice as much; what it buys is a confirmed red. On the 105 at `ed2dc77` it does overturn one: the lite tier's false red n12 becomes orange, giving 102/105 with 0/59 wrongly red and 0/67 cleared, at 2.95¢ an item with Tavily (the lite tier alone is 1.38¢, Tagout 4.38¢).
- **Where the full agent and the lite tier differ, first run:** the agent was right on h07 (the brand-less photo), h24 and h43; the lite tier was right on h38 and h39 (Kayem, FSIS). At `ed2dc77` the agent is right on h07 and h43 and the lite tier on none.
- **Rules only** is never green, because of the "never green without a model" guard: it clears nothing and gets the clean items wrong. Its pattern reader reads different items from Ultra's, so 21 of its 39 cases needed calls the cache didn't have (19 cases ask CPSC other searches, 9 ask Tavily other queries); the first table counted those as failures (24/39, 14/18 on the 18 that replayed exactly). **On Oct 25 they were filled with no model and no credits** (`eval/run.ts rules --keyless`: free CPSC, openFDA and NHTSA calls and 9 keyless Tavily searches), so all 39 are measured: **24/39, 0 wrongly red, 0 cleared**, 17/27 on the database cases and 7/12 in the lag window. The filled calls changed no tag; an offline replay of the arm now has no cache misses. This is the "no model at all" row: on unseen recalls, Nemotron takes the same pipeline from 24/39 to 31/39 as run once (37/39 after the fixes), and the lite tier's Nano reader alone to 30/39.
- **Routing policy.** A first check runs the full agent: it is the most right (37/39 and 105/105 at this code, 31/39 held out) and clears nothing. A re-check runs as the daily sweep: each new recall is read once and matched by rules against every watched item, so it costs nothing per household until a recall names a watched brand or code. Resale screening runs the cascade: the lite price for every listing, and the full agent only to confirm a red before it costs a sale.

### What decided each red tag (`redBasis`, free from the replay)

Every eval row now records how its red tag was reached (`basis` in `eval/run.ts`, from the matcher in `lib/match.ts`): the code was in a model, lot or UPC list **Nemotron's notice reader** read, in the **agency record's own list** (an openFDA `code_info` lot parsed without a model, a UPC or NDC in the description), or only in the **notice's text** (the matcher's fallback); matched exactly, inside a printed **range**, or by a **family** code; and whether a made-date **window** was checked too. `node eval/basis-split.mjs` copies the split from the offline replays into `summary-current.json` and `holdout-after-fixes.json`, after checking that the replay gives the recorded tag on every case.

| Set, arm (current code) | Red tags | Reader's list | Record's own list | Text fallback | Range or family | Window checked |
|---|---|---|---|---|---|---|
| 105, Tagout | 46 | 31 | 15 | 0 | 0 | 1 (p24) |
| 105, lite tier | 47 | 31 | 15 | 1 | 0 | 0 |
| 105, no model | 39 | 0 | 9 | 30 | 0 | 0 |
| 39, Tagout | 19 | 15 | 4 | 0 | 0 | 0 |
| 39, lite tier | 18 | 14 | 4 | 0 | 0 | 0 |

- **Nemotron's reading decided 31 of the 46 red tags on the 105 and 15 of the 19 on the 39**; the rest came from lists the agency record already prints. With no model, the text fallback decides 30 of 39 reds and the arm is right on 83 of 105, against 105 with the reader.
- **The limit the critics named holds.** Every code a reader lists must also be printed in the notice (that is the guard below), so "reader's list" says which path decided, not that only a model could have found the code. And no red tag in either set came from a printed range or a family code: those paths are unit-tested (`test/match.test.ts`) but were not measured on a recalled unit here. Held out #2 measured them on Oct 30: its 7 Tagout reds were all exact too, and both range and family units came out orange (see "Held out #2").

### The code guard, as its own module (`lib/agent/verify-codes.ts`)

The step that strikes invented codes used to test `norm(text).includes(norm(code))`, a substring test with no word edges, and it skipped the "not included" sentence check that the matcher's text fallback applies. It is now `verifyCodes()`: a code must be spelled by whole words of the notice (`SS1MODEL` out of `NS-RGFGSS1. Model` is struck, so are `RGFG` and `GSS`), and a code printed only in a sentence that says some units are not included is struck. Eight fixture tests in `test/verify-codes.test.ts` cover a cross-word fake, an excluded model, a range with one end missing, prose and paths, a UPC printed in groups, a two-part lot and its neighbour, product names with accents, plurals and symbols, and a wildcard family code.

- **Re-replayed after the change (free): 105/105 and 37/39 still hold**, every case matches the committed replays (`npm run eval:replay`, `npm run eval:replay -- --holdout`, both exit 0).
- **What the stricter test would have struck, measured.** Run over every notice the Tagout and lite arms read on both sets, the first version struck only product names the reader had put in its model list, or pieces of one (a name longer than eight words, a plural, an accent, a "™", a "*05/27" date mark); the shipped version accepts those and strikes nothing the old test kept on these arms. No code that decided a tag was affected.

### Allergy alerts (`cases-allergen.json`, Oct 25)

An undeclared-allergen recall is a danger only to someone allergic, so its red tag now says so: "Do not eat if anyone in your home is allergic to milk; return it to the place of purchase", with an allergen chip. The allergen is read from the notice without a model (`lib/notice-facts.ts`: "undeclared X" in openFDA's reason or the announcement's own sentence, and only when no other hazard such as Listeria or foreign matter is named). On openFDA, 295 of the 1,049 food enforcement reports of 2026 give "undeclared" in the reason (28%; `api.fda.gov/food/enforcement.json?search=report_date:[20260101+TO+20261231]+AND+reason_for_recall:undeclared`, Oct 25), mostly allergens, plus undeclared dyes and drug ingredients.

- **Four new cases**, none in the other sets: three recalled lots (Donutful donuts, undeclared milk, H-0011-2027; Cloud Cafe collagen milk, fish, H-1400-2026; Organiccs collagen capsules, shellfish, H-1401-2026) and one neighbouring lot (Donutful `26079`). `node eval/verify-allergen.mjs` checks them against openFDA with no Tagout code: 4/4.
- **Tagout, run once (`results-allergen/`, `allergen-summary.json`): 4/4**, three red allergy alerts naming milk, fish and shellfish, and the near miss orange. $0.076 of Token Factory; Tavily in keyless mode, no credits.

## Held out #2: pre-registered in public

**Run once on Oct 30 2026 (00:00-00:45 IST; Oct 29 18:30-19:15 UTC) at `889b9b0`, exactly as laid out below; results committed unedited in `22fa07a`** (`results-holdout2/`, `holdout2-summary.json`, both run logs). `lib/` was untouched between the tag and the run (`git diff prereg-2026-10-25 889b9b0 -- lib` changes only `lib/site.ts`: the video link and showcase ids), and both result files record `libChanged: false`.

| Arm (19 cases, run once; 95% exact intervals) | Right | Red tags right | Recalled units red | Wrongly red | Wrongly cleared | Database | Lag window | Model cost per item | Tavily credits per item | Cost per item with Tavily |
|---|---|---|---|---|---|---|---|---|---|---|
| **Tagout** (Ultra agent and readers) | **15/19** (54-94%) | 6/7 | 6/8 | **1/9** (g07) | **0/11** | 12/16 | 3/3 | 2.84¢ | 2.26 | 4.65¢ |
| Lite tier (fixed plan, Nano reader) | 13/19 (43-87%) | 4/6 | 4/8 | 2/9 (g07, g14) | 1/11 (g06) | 10/16 | 3/3 | 0.30¢ | 1.37 | 1.40¢ |

**What the set was built to measure, case by case (Tagout):**

- **Printed serial range (g01, g02):** the unit inside the range came out orange, not red (wrong); the one outside, orange (right). The list reader kept no code from `serial 00010 2450`, so nothing was compared with the range.
- **Prefix family (g03, g04):** both orange. The notice prints `PR01` followed by a number from 25091 to 26168; the matcher found `PR01` listed but has no rule for a prefix plus a number range, so the recalled unit (g03) was orange (wrong) and the one outside it (g04) orange (right).
- **Best-by and use-by windows (g06-g09):** g06, g08 red and g09 orange are right, but g06 and g08 are red only because the UPC is in openFDA's own record. **g07 is the one wrong red:** the same pizza UPC with a best-by date of 06/20/2027, outside "all dates through 3/30/2027". The matcher checks a made-date window for codes a reader lists, not for a UPC taken from the record's own list.
- **Gaps in a listed run of codes (g10, g12, g14, g17): 4/4 right.** No gap was read as inside a range.
- **Listed codes (g05, g11, g13, g16): 4/4 red**, one with its dash dropped (g11) and one from a page only Tavily reached (g16, Pan Pepin, a sesame allergy alert).
- **Lag window (g15-g17): 3/3 right**, all from FDA pages no database lists: the Haifa sprats advisory orange (every lot), Pan Pepin lot `3B1 280` red, and its gap `3B1 279` green.
- **Car (g18) right. Clean item (g19) wrong:** Tavily's keyless hourly cap made the check wait about five minutes for its web searches, past its 150-second soft deadline and its 200-second hard one, so CPSC's 2014 Dyson recall was never read and an unread brand recall holds the tag at orange.

**What decided each red** (`redBasis` in `holdout2-summary.json`, recorded by the run itself): Tagout's 7 reds came 2 from the reader's list, 3 from the record's own list and 2 from the notice text; **all 7 exact, none from a range or a family, and none with a made-date window checked.** So on the first recalled units built for them, the range and family paths did not fire (both orange, the safe miss), and the missing window check on record-list UPCs produced the first wrong red on a held-out set.

**Lite tier misses:** g01 and g03 orange (as Tagout); g06 **cleared green** (the list reader kept the brand as "St Francis" and the single openFDA query, UPC and brand together, found nothing; the agent searched again); g07 wrong red (as Tagout); **g14 wrong red** (the reader kept the product name "GRVL AF GRX" as a code, and `GRVL` is printed in the recall); g11 orange (its notice reads never ran: the check was past its deadline).

**The agent against the fixed plan:** 15 against 13 here, with 1 wrongly red against 2 and none cleared against 1. Only the agent got g06 (it searched openFDA again) and g14.

**Caveats, as run:**

- **Tavily was keyless for both arms.** The key's October plan was spent (1,021 of 1,000 credits on Oct 30), so every call went out in keyless mode (`--keyless`, which the steps below allow), 43 calls for Tagout and 26 for the lite tier: **0 credits**. The credit columns count what those calls would have billed. Keyless mode has an hourly cap; the harness waits out each 429. That pushed g19 (Tagout) and 10 of the 19 lite-tier cases past the check's 150-second soft deadline; in the lite tier g10 and g12 were held at orange because no model answered (both still right) and g11's notice reads never ran.
- **The run date.** `--today 2026-10-29` as written below; the run started at 00:00 IST on Oct 30 (18:30 UTC on Oct 29). `verify-holdout2.mjs` was re-run right before: 19/19 (`verified-holdout2.json` updated in the same commit).
- **Run once, no restart.** Neither arm was stopped or re-run. The lite tier reused calls the Tagout arm had cached (the Ultra list reader is shared), so its own spend is small.
- **Spend: $0.5127 of Token Factory** (ledger `eval/.cache/spend.json`, $5.5810 → $6.0937: Tagout $0.5042, lite tier $0.0085), inside the run's $0.70 and $0.10 caps. Tavily: 0 credits.
- **Small:** 19 cases, so 15/19 is 54-94% and 1/9 wrongly red bounds the false-red rate only below 48%.

These 19 cases are now read. Any fix made from them is in-sample, like the 105, and is reported as such below them, never in place of this table.

**Added afterwards, not pre-registered: no model at all.** The rules-only arm (`eval/run.ts rules`, no Token Factory call, keyless Tavily) ran on the same 19 cases after the two arms above, at the same code, to say what Nemotron adds on unseen cases at one commit: **10/19 right, 1/9 wrongly red (the same g07), 0/11 cleared** (it is never green without a model, so its misses are oranges), against Tagout's 15/19. Its row is in `holdout2-summary.json` as `rules`, its log in `results-holdout2/rules.log`.

### After held out #2 (Oct 30, in-sample: written after reading the misses above)

Two general rules, each with unit tests, made after `22fa07a`; the table above stays the held-out result.

- **Best-by and use-by windows from the record's own text** (`dateWindowIn`, `looseDate` in `lib/match.ts`; `test/date-window.test.ts`). When no reader gave a made-date window, a food or drug record that prints one best-by or use-by window ("Best By: all dates through 3/30/2027", "Best If Used By Dates from August 14th, 2026 to September 25th, 2026") is compared with the date on the household's line. Outside it, that recall doesn't tag the item red. Replayed offline on held out #2, **g07 moves from red to orange in all three arms** (right), and nothing else moves.
- **USDA FSIS product lists, read through Tavily Extract** (`fsisProductList` in `lib/sources/web.ts`; `test/product-list.test.ts`). FSIS prints a recall's products (SKU, UPC, lot, dates, establishment) only in a linked PDF, `Recall_<number>-productlist.pdf`. Tavily Extract reads PDFs, so the list is now read with the page (one more extract call, 1 credit) and appended to its text, cut into one line per product row; a UPC and a lot count together only on the same row. This was the gap the held-out write-up named for Kayem ("the product list is a PDF we did not parse"). Probed on Oct 30 in keyless mode: the Kayem list (026-2026) came back as 44,785 characters of rows.
  - **In-sample probe, 2 cases** (`cases-fsis-probe.json`, ground truth from that PDF, `results-fsis-probe/`): Kayem 8:1 lower sodium hot dogs, UPC 030771010182, lot 26-225 (its row) → **Do not use**; the same UPC with lot 26-203 (printed only on other products' rows) → Check the label, not red. $0.094 of Token Factory, keyless Tavily.
- **Tavily's lot tables on fda.gov: no gain, measured.** For h37 and h42 (Starfish salmon, lot `D080-148`), a keyless advanced search with `chunks_per_source: 3` and `include_raw_content` found the announcement but not the lot in any content or raw content, as advanced extract hadn't on Oct 25. So nothing changed there; those two stay orange.
- **Replayed offline after both changes:** the 105 match the committed replay on every arm (`npm run eval:replay` exits 0). Held out #1: every arm matches except Tagout's **h38** (Kayem, EST. 7839), orange → red, still inside its expected orange-or-red; its page text now carries the product list, so its notice-reader call isn't in the cache and the replay ran without it. A live re-run of h38 and h39 was started and stopped when Tavily's keyless hourly cap asked for a 20-minute wait. Held out #2 (`results-holdout2-replay/`): only g07 moves, in every arm.
- **Not fixed:** the serial range (g01: the list reader drops a serial printed in two groups) and the code family (g03: no rule for a prefix with a number range). Both stay orange, the safe miss.
- **Spend for this section:** $0.117 of Token Factory (the probe $0.094, the stopped re-run $0.023); Tavily keyless only.

### How it was built (Oct 25)

Nineteen new cases (`cases-holdout2.json`, commit `45dc3a1`, sha256 `34907813bf703a3dafc877c60cfdf0a7f775a9e57a8cab9ac23432fcc2014cbd`), built for what the first sets never tested on a recalled unit:

- **2 inside a printed serial range** and its edge (Giant SureLock serial `00010 2450` inside `00010 2303`-`00010 2607`; `00010 2650` outside), **2 on a prefix family** (Lestoil `PR01` followed by a number between 25091 and 26168), **4 on a best-by or use-by window** (two pizza best-by dates either side of "all dates through 3/30/2027", a bean dip inside "August 14th to September 25th, 2026", a salad with no code inside its use-by window), and **4 gaps in an enumerated list**, which a range reading would wrongly call recalled (a rollator lot, a tirzepatide lot, the next product ID after a list, a Pan Pepin lot between two listed ones).
- **2 lag-window recalls** no database has: FDA's Oct 23 advisory on Haifa cold smoked sprats (every lot), and Pan Pepin's allergy alert (a listed lot and a gap).
- **Plus** 3 listed codes (one with its dash dropped, one model with a sale window), a car and a clean item.
- **Dates.** On Oct 25 no database had a record dated Oct 23 or later (CPSC's newest batch is Oct 22, openFDA's newest report Oct 14), so the database cases are the freshest records in no other case file (CPSC Sep 3 - Oct 8, openFDA Oct 14). Nothing in `lib/` was changed with these cases in view.
- **Ground truth** (`verify-holdout2.mjs`, `verified-holdout2.json`, commit `9ecb544`): 19/19, checked with no Tagout code. For a range, family or window it parses the printed bounds and compares; a gap's neighbours must be printed and the value printed in no CPSC or FDA record of the brand. Re-run it right before the run: NHTSA can add a campaign.
- **Pre-registered:** the cases were pushed with the tag `prereg-2026-10-25` (commit 45dc3a1) on Oct 25, before any run. **To run once:**

  ```bash
  node eval/verify-holdout2.mjs
  npx tsx --conditions=react-server eval/run.ts tagout --cases cases-holdout2.json --results results-holdout2 --today 2026-10-29 --cap 0.7
  npx tsx --conditions=react-server eval/run.ts fixed-plan-nano --cases cases-holdout2.json --results results-holdout2 --today 2026-10-29 --cap 0.1
  node eval/score.mjs --cases cases-holdout2.json --verified verified-holdout2.json --results results-holdout2 --out holdout2-summary.json --first none
  ```

  Expected spend: about $0.55 of Token Factory for Tagout and $0.05 for the lite tier (19 cases at the measured 2.8¢ and 0.2¢), and about 40 + 30 Tavily credits keyed (add `--keyless` to spend none).

## Replaying (`npm run eval:replay`)

- **What it does.** It re-runs every recorded arm offline from `eval/.cache` against the checked-out code: no network, no keys, no spend. Then it re-scores into `replay-summary.json` and compares with the recorded tags and with the committed replay. It exits 1 if any tag moved since the committed replay.
- **Held-out set.** `npm run eval:replay -- --holdout` does the same for this set. At `a1d8b21` all 5 arms replayed with no cache misses; at `ed2dc77` (the committed `holdout-replay-summary.json`) Tagout, the lite tier and the lite tier with Tavily off replay exactly, and the run exits 0.
- **Determinism.** Two offline replays in a row gave identical tags.
- **Tagout on the 105 at `a1d8b21`: 105/105, every call from the cache.**
  - Against the code that shipped after Oct 15, 11 tuned cases made model calls the cache didn't have. The code changed under them: listing pages filtered out of web results, and the struck-code cleanup.
  - Those 11 were filled with one live run, $0.09 of Token Factory and keyless Tavily, into `results-current/`.
  - Two cases changed tag against the recorded run, both for the better and both still right or now right: n12 green→orange, k04 orange→green.
- **What still needs live calls to re-measure:**
  - `search-ultra`: 5 cases (p03 p24 n02 n12 c10). The web results it is shown changed with the listing filter.
  - `super-readers` p04, `super-agent` c08, `nano-agent` v08.
  - The fixed plan with Ultra readers on the 105: 69 cases need Ultra notice reads that were never cached (about $0.4, more than this pass's budget). It is measured on the held-out set above instead.
  - Since `c3cdc1a`, the arms that were not re-run: `nano-readers` (Nano reads now go out with reasoning off) replays 58 of 105 exactly, and `nano-agent`, `super-agent`, `super-readers` and the held-out fixed plan with Ultra readers miss a few of the new cut-off retries. The committed replays record those misses; re-measuring `nano-readers` would cost about $0.05.
- **Agency misses that don't matter.** The openFDA "has this firm reported lately" check (added after Oct 15) misses the cache on old runs. It fails as an unreachable API would, and it only adds an "ahead of the database" badge, never a tag.
- **Getting the cache.** The cache (`eval/.cache`, about 4,700 files and 32 MB) is not in git. `eval-cache.tgz` (5.2 MB, scrubbed) holds it as `eval/.cache/...`: from the repo root, `tar -xzf eval-cache.tgz`, then `npm run eval:replay` and `npm run eval:replay -- --holdout` need no keys and cost nothing. Or point `EVAL_CACHE` at a copy.
  - Before sharing it, run `node scripts/cache-scrub.mjs --fix <out-dir>`. It checks every file against the real key values in `.env.local` and `../.env.keys` and against key-shaped patterns, and writes a redacted copy.
  - On Oct 25, run on the cache after the reasoning-budget re-run, it found no matches in 4,697 files (6 key values, 10 patterns). An earlier review reported two files with key-like strings; this pass could not reproduce that, so scrub anyway.
  - The Oct 25 archive was built from that scrubbed copy (sha256 `9d5c1d281a7db875a13b6774fff5e1abed76a9e295640da90bfde348ba68b909`); a spot check, an offline Tagout replay of h07, h15 and h32 from the unpacked archive, gave the same tags with no cache misses. It is attached to the GitHub release `eval-2026-10-25`.

## Caveats to state with these numbers

- **Small and recent.** 39 cases, so the intervals are wide: 31/39 is 64-91%. Wrongly red 0/10 bounds the false-red rate only below 31%. The tuned set's 0/59 bounds it below 6% (two-sided) or 5% (one-sided), but that set is in-sample.
- **Database dates.** No database had a record newer than Oct 14 (openFDA) or Oct 22 (CPSC) on Oct 25. So the database part is the newest records available, plus NHTSA campaigns from Oct 19-21. It is not strictly "published Oct 16-29": the CPSC Oct 15 postings and openFDA's Oct 14 report came out before the window.
- **Run once, with one restart.** The Tagout arm's first attempt was stopped after 17 cases by a harness bug: retries reused an expired timeout during Tavily's keyless rate limit. Calls that had succeeded were reused from the cache, and the rest ran again. The fixed-plan arm hit its spend cap at case 34; its last 5 cases were then completed entirely from cached calls.
- **Tavily mode differed by arm.** It was keyed for most Tagout and lite calls (84 credits) and keyless for 36 calls. Keyless and keyed search the same index, as far as we know.
- **h03 differs between the run and the replay in the lite arm.** It was green when run and orange on replay; both are right. A response that failed during the run was probably cached later by another arm.
- **Ground truth for the lag window rests on saved excerpts** of the FDA and FSIS pages (`notices-holdout/`). The Kayem cases are scored orange-or-red because the product list is a PDF we did not parse.
- **The code measured is commit `a1d8b21`, not the newest code.** `lib/` changed after it, in commits `3adbbab` through `2965b11` on Oct 25: never green without a model, retries only where they help, cached notice reads, and the daily sweep. An offline replay at `2965b11` ran into cache misses:
  - held-out Tagout arm: 30 of 39 cases replay exactly and 9 need live calls (h03 h10 h11 h12 h21 h23 h37 h38 h39). Among the exact ones, h15 and h16 moved from green to orange;
  - tuned Tagout arm: 88 of 105 replay exactly, and 17 need live calls.

  To quote these as current-code numbers, re-run the held-out arms at the final commit. That is about $0.3 of Token Factory, since most calls are cached. Then run `npm run eval:replay` and commit the new replay summaries. Anyone who reads these results before changing `lib/` makes the set less held-out; say so if it happens.

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
| `results-holdout-after/`, `holdout-after-fixes.json` | This set after the fixes (no longer held out) |
| `results-after/`, `summary-current.json` | Every arm of the 105 at `a9a0f8f`; Tagout and the lite tier again at `ed2dc77` |
| `results-holdout-extra/`, `holdout-arms-extra.mjs`, `holdout-arms-extra.json` | Rules-only arm on all 39 and the cascade on this set (and the cascade on the 105) |
| `basis-split.mjs` | What decided each red tag, copied from the replays into `summary-current.json` and `holdout-after-fixes.json` |
| `cases-allergen.json`, `verify-allergen.mjs`, `verified-allergen.json`, `results-allergen/`, `allergen-summary.json` | The allergy-alert cases and their one run |
| `cases-holdout2.json`, `verify-holdout2.mjs`, `verified-holdout2.json`, `notices-holdout2/` | Held out #2, pre-registered (tag `prereg-2026-10-25`) |
| `results-holdout2/`, `holdout2-summary.json` | Held out #2, run once on Oct 30 (both arms, their logs, and the rules-only arm added afterwards) |

Commands:

- `npm run eval:holdout:score` re-scores this set.
- `npm run eval:replay` replays everything offline.

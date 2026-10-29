import current from "@/eval/summary-current.json";

/**
 * Unit costs, all measured on the 105-case eval at today's code (eval/summary-current.json: Tagout and the lite
 * tier re-run at ed2dc77 on Oct 25): Nemotron tokens at Token Factory list price, and Tavily credits per item as
 * billed (a basic search is 1 credit, a basic extract 1 per 5 URLs read), priced at Tavily's pay-as-you-go rate.
 */
export const TAVILY_USD_PER_CREDIT = 0.008;

/** The date the numbers below were measured, for any page that prints them. */
export const COST_MEASURED = "Oct 25 2026, 105 cases";

const arm = (id: string) => current.arms.find((a) => a.arm === id)!;

/** Tavily credits an item used on average in the 105-case eval (search + extract, as billed), per tier. */
export const TAVILY_CREDITS_PER_ITEM = { full: arm("tagout").tavilyPerItem, lite: arm("fixed-plan-nano").tavilyPerItem };

export const COST = {
  full: { model: arm("tagout").usdPerItem, tavily: TAVILY_CREDITS_PER_ITEM.full * TAVILY_USD_PER_CREDIT },
  lite: { model: arm("fixed-plan-nano").usdPerItem, tavily: TAVILY_CREDITS_PER_ITEM.lite * TAVILY_USD_PER_CREDIT },
};

export const perItem = (tier: keyof typeof COST) => COST[tier].model + COST[tier].tavily;

/** "4.4¢" for amounts under a dollar, "$1.20" above. */
export function money(usd: number): string {
  return usd < 1 ? `${(usd * 100).toFixed(usd < 0.1 ? 1 : 0)}¢` : `$${usd.toFixed(2)}`;
}

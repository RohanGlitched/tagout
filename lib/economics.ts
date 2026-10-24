import summary from "@/eval/summary.json";

/**
 * Unit costs, all measured: Nemotron tokens at Token Factory list price from the eval (eval/summary.json), Tavily
 * credits per item counted in the eval's cached runs, priced at Tavily's pay-as-you-go rate.
 */
export const TAVILY_USD_PER_CREDIT = 0.008;

const arm = (id: string) => summary.arms.find((a) => a.arm === id)!;

/** Tavily credits an item used on average in the 105-case eval (search + extract), per tier. */
export const TAVILY_CREDITS_PER_ITEM = { full: 2.48, lite: 1.44 };

export const COST = {
  full: { model: arm("tagout").usdPerItem, tavily: TAVILY_CREDITS_PER_ITEM.full * TAVILY_USD_PER_CREDIT },
  lite: { model: arm("fixed-plan-nano").usdPerItem, tavily: TAVILY_CREDITS_PER_ITEM.lite * TAVILY_USD_PER_CREDIT },
};

export const perItem = (tier: keyof typeof COST) => COST[tier].model + COST[tier].tavily;

/** "4.6¢" for amounts under a dollar, "$1.20" above. */
export function money(usd: number): string {
  return usd < 1 ? `${(usd * 100).toFixed(usd < 0.1 ? 1 : 0)}¢` : `$${usd.toFixed(2)}`;
}

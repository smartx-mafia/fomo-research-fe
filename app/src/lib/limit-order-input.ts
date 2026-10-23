import type { OrderInput } from "@/api/limit-orders";
import { parseUnits } from "@/api/trade";
import { parseExactDecimal } from "./exact-decimal";

export const CASH_CHAIN = "solana:mainnet";
export const CASH_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const ORDER_CHAINS = [
  { slug: "solana", caip: CASH_CHAIN },
  { slug: "base", caip: "eip155:8453" },
  { slug: "eth", caip: "eip155:1" },
  { slug: "bsc", caip: "eip155:56" },
] as const;
export type OrderDraft = {
  scenario: 1 | 2 | 3 | 4;
  chain: string;
  token: string;
  amount: string;
  quantityMode: "amount" | "percent";
  target: string;
  targetMode: "usd" | "percent";
  slippage: string;
  feeCap: string;
  expiry: string;
  sourceWallet: string;
  destinationWallet: string;
};
function positive(value: string, label: string) {
  if (value.length > 80 || parseExactDecimal(value).coefficient <= BigInt(0))
    throw new Error(`${label} must be positive.`);
}
export function orderInput(
  d: OrderDraft,
  tokenDecimals: number,
  now = Date.now(),
): OrderInput {
  const chain = ORDER_CHAINS.find((c) => c.slug === d.chain);
  if (!chain || !d.token.trim() || !d.sourceWallet || !d.destinationWallet)
    throw new Error("Select a token and both embedded wallets.");
  const buy = d.scenario <= 2;
  positive(d.amount, "Quantity");
  positive(d.feeCap, "Fee cap");
  if (
    d.quantityMode === "percent" &&
    parseUnits(d.amount, 8) > BigInt(100) * BigInt(10) ** BigInt(8)
  )
    throw new Error("Quantity percentage must be at most 100.");
  if (d.targetMode === "usd") positive(d.target, "Target price");
  else {
    const change = parseExactDecimal(d.target);
    if (change.coefficient === BigInt(0))
      throw new Error("Target percentage must be nonzero.");
    if (
      (d.scenario === 1 || d.scenario === 4) !==
      change.coefficient < BigInt(0)
    )
      throw new Error(
        "Dip/stop loss need a negative change; breakout/take profit need a positive change.",
      );
  }
  const expires = new Date(d.expiry);
  if (!Number.isFinite(expires.getTime()) || expires.getTime() <= now)
    throw new Error("Expiry must be in the future.");
  const manual = d.slippage.trim() !== "";
  const bps = manual ? Number(parseUnits(d.slippage, 2)) : 0;
  if (manual && (!Number.isInteger(bps) || bps < 0 || bps > 10000))
    throw new Error("Slippage must be between 0 and 100%.");
  const amount =
    d.quantityMode === "amount"
      ? parseUnits(d.amount, buy ? 6 : tokenDecimals).toString()
      : "";
  if (d.quantityMode === "amount" && BigInt(amount) <= BigInt(0))
    throw new Error("Quantity rounds to zero.");
  return {
    scenario: d.scenario,
    intent: {
      origin_chain: buy ? CASH_CHAIN : chain.caip,
      destination_chain: buy ? chain.caip : CASH_CHAIN,
      origin_asset: buy ? CASH_ASSET : d.token.trim(),
      destination_asset: buy ? d.token.trim() : CASH_ASSET,
      amount_in_raw: amount,
      source_wallet_id: d.sourceWallet,
      destination_wallet_id: d.destinationWallet,
      side: chain.slug === "solana" ? 3 : buy ? 1 : 2,
      fee_policy: 1,
      slippage_mode: manual ? 2 : 1,
      ...(manual ? { slippage_bps: bps } : {}),
    },
    ...(d.targetMode === "usd"
      ? { target_usd: d.target.trim() }
      : { target_percent: d.target.trim() }),
    ...(d.quantityMode === "percent"
      ? { quantity_percent: d.amount.trim() }
      : {}),
    fee_cap_usd: d.feeCap.trim(),
    expires_at: expires.toISOString(),
  };
}

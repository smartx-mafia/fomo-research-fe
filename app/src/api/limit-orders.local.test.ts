// Opt-in contract test against the real local sx_limitorder HTTP service.
// Uses a synthetic JWT and local provider fixtures; no Privy login or chain E2E.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cancelOrder, createOrder, getOrder, listOrders, modifyOrder,
  orderAuthorization, orderBalance, orderEvents, type OrderInput,
} from "./limit-orders";
import { LIMIT_ORDER_API_BASE } from "@/config";

const jwtFile = process.env.LIMITORDER_LOCAL_JWT_FILE;
describe.skipIf(!jwtFile)("real local order HTTP contract", () => {
  let bearer: string;
  beforeAll(() => {
    const url = new URL(LIMIT_ORDER_API_BASE);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "19500") {
      throw new Error("Local contract tests require http://127.0.0.1:19500");
    }
    bearer = readFileSync(jwtFile!, "utf8").trim();
  });

  it("requires an authenticated HTTP request", async () => {
    await expect(listOrders("invalid-local-jwt", 1)).rejects.toThrow();
    expect(await orderAuthorization(bearer, "src", "solana:mainnet"))
      .toMatchObject({ wallet_id: "src", authorized: true });
    expect(await orderBalance(bearer, "src", "solana:mainnet", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"))
      .toMatchObject({ wallet_id: "src", balance_raw: "100000000" });
    await expect(orderBalance("invalid-local-jwt", "src", "solana:mainnet", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).rejects.toThrow();
  });

  it.each([1, 2, 3, 4] as const)("creates, modifies and cancels scenario %i with the real adapter", async (scenario) => {
    const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const token = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const buy = scenario <= 2;
    const above = scenario === 2 || scenario === 3;
    const manual = scenario === 2 || scenario === 4;
    // Local TokenData publishes 1 USD. Keep every order away from triggering.
    const input: OrderInput = {
      scenario,
      intent: {
        origin_chain: "solana:mainnet", destination_chain: "solana:mainnet",
        source_wallet_id: "src", destination_wallet_id: "src",
        origin_asset: buy ? usdc : token, destination_asset: buy ? token : usdc,
        amount_in_raw: "100", side: 3, fee_policy: 1,
        ...(manual ? { slippage_mode: 2 as const, slippage_bps: 100 } : {}),
      },
      target_usd: above ? "2" : "0.5", fee_cap_usd: "1",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    const key = `local-fe-${randomUUID()}`;
    // Respect the real write limiter (2 requests/second), including replays.
    await delay(550);
    const created = await createOrder(bearer, key, input);
    try {
      expect(created).toMatchObject({ state: 1, version: "1", configuration: { scenario } });
      expect(created.configuration.intent.slippage_mode).toBe(manual ? 2 : 1);
      if (manual) expect(created.configuration.intent.slippage_bps).toBe(100);
      await delay(550);
      expect((await createOrder(bearer, key, input)).order_id).toBe(created.order_id);
      expect((await listOrders(bearer, 1)).orders.some(o => o.order_id === created.order_id)).toBe(true);
      const changed = { ...input, target_usd: above ? "3" : "0.4" };
      await delay(550);
      const modified = await modifyOrder(bearer, created, changed);
      expect(modified).toMatchObject({ state: 1, version: "2", configuration: { target_usd: changed.target_usd } });
      await delay(550);
      await expect(modifyOrder(bearer, created, changed)).rejects.toMatchObject({ code: 420800 });
      expect((await getOrder(bearer, created.order_id)).version).toBe("2");
      const canceled = await cancelOrder(bearer, created.order_id);
      expect(canceled.state).toBe(6);
      expect(canceled.swap_id || "").toBe("");
      const events = await orderEvents(bearer, created.order_id, "0");
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.at(-1)).toMatchObject({ order_id: created.order_id, state: 6 });
      expect((await listOrders(bearer, 2)).orders.some(o => o.order_id === created.order_id)).toBe(true);
    } finally {
      await cancelOrder(bearer, created.order_id);
    }
  });
});

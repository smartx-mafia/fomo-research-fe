import { describe, it, expect } from "vitest";
import { orderInput, CASH_ASSET, type OrderDraft } from "./limit-order-input";
const draft: OrderDraft = {
  scenario: 1,
  chain: "solana",
  token: "So11111111111111111111111111111111111111112",
  sourceWallet: "s",
  destinationWallet: "d",
  amount: "9007199254740993.123456",
  quantityMode: "amount",
  target: "0.000000000000000001",
  targetMode: "usd",
  feeCap: "1",
  slippage: "",
  expiry: "2030-01-01T00:00:00Z",
};
describe("order input", () => {
  it("preserves exact amounts and AUTO instead of converting via float", () => {
    const r = orderInput(draft, 9, 0);
    expect(r.intent.amount_in_raw).toBe("9007199254740993123456");
    expect(r.intent.slippage_mode).toBe(1);
    expect(r.intent.slippage_bps).toBeUndefined();
    expect(r.target_usd).toBe(draft.target);
  });
  it.each([1, 2, 3, 4] as const)(
    "builds cash route for scenario %s",
    (scenario) => {
      const r = orderInput({ ...draft, scenario, amount: "1" }, 9, 0);
      expect(r.intent.side).toBe(3);
      expect(
        scenario <= 2 ? r.intent.origin_asset : r.intent.destination_asset,
      ).toBe(CASH_ASSET);
      expect(r.intent.amount_in_raw).toBe(
        scenario <= 2 ? "1000000" : "1000000000",
      );
    },
  );
  it("uses original EVM route semantics and manual bps", () => {
    const r = orderInput(
      { ...draft, chain: "base", scenario: 3, amount: "1", slippage: "0.25" },
      18,
      0,
    );
    expect(r.intent.side).toBe(2);
    expect(r.intent.slippage_bps).toBe(25);
    expect(r.intent.destination_chain).toBe("solana:mainnet");
  });
  it("sends percentage for authoritative conversion, not competing amount", () => {
    const r = orderInput(
      {
        ...draft,
        amount: "25",
        quantityMode: "percent",
        targetMode: "percent",
        target: "-10",
      },
      9,
      0,
    );
    expect(r.intent.amount_in_raw).toBe("");
    expect(r.quantity_percent).toBe("25");
    expect(r.target_percent).toBe("-10");
  });
  it.each([
    { amount: "0" },
    { amount: "101", quantityMode: "percent" },
    { slippage: "0.001" },
    { target: "10", targetMode: "percent" },
    { expiry: "bad" },
    { chain: "unknown" },
  ])("rejects invalid input %s", (change) => {
    expect(() =>
      orderInput({ ...draft, ...change } as OrderDraft, 9, 0),
    ).toThrow();
  });
});

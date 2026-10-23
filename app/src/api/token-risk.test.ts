import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/config", () => ({
  BUSINESS_API_BASE: "http://localhost:8080",
  LIMIT_ORDER_API_BASE: "http://localhost:8083",
}));
vi.mock("@/lib/market", () => ({ MARKET_API_BASE: "http://localhost:8080" }));
import { ApiError } from "./envelope";
import {
  riskScope,
  confirmOrderRisk,
  canConfirmRisk,
  type RiskAssessment,
} from "./token-risk";
import type { OrderInput } from "./limit-orders";
const input = {
  scenario: 1,
  intent: { destination_chain: "eip155:8453", destination_asset: "0xAbC" },
} as OrderInput;
const scope = {
  chain: "base",
  address: "0xabc",
  flow_id: "fastswap:limit:original:1",
};
const assessment: RiskAssessment = {
  mode: "enforce",
  grade: 4,
  buy_action: "confirm",
  confirmation_version: "risk-v1",
  valid_until_ms: "4102444800000",
};
afterEach(() => vi.unstubAllGlobals());
it("binds server flow to the exact buy token and chain", () => {
  const error = new ApiError(
    "business",
    403,
    "risk",
    "TOKEN_RISK_CONFIRMATION_REQUIRED",
    undefined,
    undefined,
    undefined,
    scope,
  );
  expect(riskScope(error, input)).toEqual(scope);
  expect(() => riskScope(error, { ...input, scenario: 3 })).toThrow();
  expect(() =>
    riskScope(error, {
      ...input,
      intent: { ...input.intent, destination_chain: "eip155:56" },
    }),
  ).toThrow();
  expect(() =>
    riskScope(error, {
      ...input,
      intent: { ...input.intent, destination_asset: "0xdef" },
    }),
  ).toThrow();
});
it.each([
  { grade: 5 },
  { mode: "observe" },
  { buy_action: "block" },
  { confirmation_version: "" },
  { valid_until_ms: "1" },
])("never confirms invalid evidence %s", async (change) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const risk = { ...assessment, ...change };
  expect(canConfirmRisk(risk)).toBe(false);
  await expect(confirmOrderRisk("jwt", scope, risk)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("submits only the server flow and explicit confirmation version through the existing user channel", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  await confirmOrderRisk("jwt", scope, assessment);
  expect(fetch.mock.calls[0][0]).toBe(
    "http://localhost:8080/v1/tokens/base/0xabc/risk/confirm",
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    flow_id: scope.flow_id,
    confirmation_version: "risk-v1",
  });
  expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer jwt");
});

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config", () => ({
  LIMIT_ORDER_API_BASE: "http://localhost:8083",
  BUSINESS_API_BASE: "http://localhost:8080",
}));
import {
  createOrder,
  modifyOrder,
  mergeOrderEvents,
  type LimitOrder,
  type OrderInput,
} from "./limit-orders";
const snapshot = {
  order_id: "id",
  version: "9007199254740993",
  event_version: "9007199254740995",
  state: 1,
  configuration: {},
} as LimitOrder;
const input = {
  scenario: 1,
  intent: { amount_in_raw: "9007199254740993123456" },
  fee_cap_usd: "1",
  target_usd: "0.01",
} as OrderInput;
describe("order transport", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 200, data: { order: snapshot } }),
            { status: 200 },
          ),
        ),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());
  it("uses isolated endpoint, JWT and persistent creation key", async () => {
    const o = await createOrder("jwt", "same-key", input);
    expect(o.version).toBe(snapshot.version);
    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:8083/v1/limit-orders");
    expect((opts!.headers as Record<string, string>).authorization).toBe(
      "Bearer jwt",
    );
    expect(JSON.parse(opts!.body as string)).toEqual({
      creation_key: "same-key",
      input,
    });
  });
  it("modifies with exact server version", async () => {
    await modifyOrder("jwt", snapshot, input);
    const opts = vi.mocked(fetch).mock.calls[0][1]!;
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body as string).expected_version).toBe(
      snapshot.version,
    );
  });
  it("does not treat business failure HTTP 200 as success", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 420800,
          error: "LIMITORDER_VERSION_CONFLICT",
          msg: "conflict",
        }),
        { status: 200 },
      ),
    );
    await expect(modifyOrder("jwt", snapshot, input)).rejects.toMatchObject({
      code: 420800,
    });
  });
  it("deduplicates event identity without unsafe number conversion", () => {
    const a = {
      order_id: "a",
      event_version: "9007199254740993",
      state: 1,
      reason: "",
      created_at: "",
    };
    const b = { ...a, event_version: "9007199254740992" };
    expect(mergeOrderEvents([a], [b, a])).toEqual([b, a]);
  });
});

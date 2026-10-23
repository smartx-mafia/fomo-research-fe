// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/config", () => ({
  LIMIT_ORDER_API_BASE: "http://localhost:8083",
  LIMIT_ORDER_SIGNER_ID: "signer",
  PRIVY_APP_ID: "app",
  BUSINESS_API_BASE: "http://localhost:8080",
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: true,
    user: {
      linkedAccounts: [
        {
          type: "wallet",
          id: "wallet",
          address: "wallet-address",
          chainType: "solana",
          walletClientType: "privy",
        },
      ],
    },
  }),
  useSigners: () => ({ addSigners: vi.fn(), removeSigners: vi.fn() }),
}));
vi.mock("@/session/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/session/storage")>()),
  useSession: () => ({ jwt: "token", user: { identifier: "alice" } }),
}));
vi.mock("@/api/trade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/trade")>()),
  getTokenInfo: vi.fn().mockResolvedValue({ decimals: 9 }),
}));
vi.mock("@/api/limit-orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/limit-orders")>()),
  listOrders: vi.fn().mockResolvedValue({ orders: [], next_cursor: "" }),
  getOrder: vi.fn(),
  orderEvents: vi.fn().mockResolvedValue([]),
  orderAuthorization: vi
    .fn()
    .mockResolvedValue({
      authorized: true,
      signer_id: "signer",
      checked_at: "now",
    }),
  createOrder: vi.fn(),
}));
import { LimitOrdersView } from "./LimitOrdersView";
import * as api from "@/api/limit-orders";
import { readPendingLimitOrder } from "@/session/storage";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("replays the identical persisted creation after response loss and page reopen", async () => {
  const user = userEvent.setup();
  const view = render(<LimitOrdersView />);
  await user.type(
    screen.getByLabelText("标的地址"),
    "So11111111111111111111111111111111111111112",
  );
  await user.selectOptions(screen.getByLabelText("支付钱包"), "wallet");
  await user.selectOptions(screen.getByLabelText("接收钱包"), "wallet");
  await user.type(screen.getByLabelText("数量 / 比例"), "1");
  await user.type(screen.getByLabelText("目标价 / 涨跌百分比"), "2");
  await user.type(screen.getByLabelText(/有效期/), "2030-01-01T00:00:00Z");
  await user.click(screen.getByRole("button", { name: "检查并预览" }));
  vi.mocked(api.createOrder).mockRejectedValueOnce(new Error("response lost"));
  await user.click(
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await screen.findByText("response lost");
  const first = vi.mocked(api.createOrder).mock.calls[0];
  expect(first[2].intent.amount_in_raw).toBe("1000000");
  expect(readPendingLimitOrder("alice", "http://localhost:8083")?.key).toBe(
    first[1],
  );
  view.unmount();
  render(<LimitOrdersView />);
  const result = {
    order_id: "order",
    version: "1",
    event_version: "1",
    state: 1,
    reason: "",
    configuration: {
      ...first[2],
      chain: "solana",
      token: "token",
      target_usd: "2",
      expires_at: "2030-01-01T00:00:00Z",
    },
    cancel_requested: false,
    needs_attention: false,
  } as api.LimitOrder;
  vi.mocked(api.createOrder).mockResolvedValueOnce(result);
  vi.mocked(api.getOrder).mockResolvedValue(result);
  await user.click(
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await waitFor(() =>
    expect(vi.mocked(api.createOrder).mock.calls).toHaveLength(2),
  );
  expect(vi.mocked(api.createOrder).mock.calls[1]).toEqual(first);
  await waitFor(() =>
    expect(
      readPendingLimitOrder("alice", "http://localhost:8083"),
    ).toBeUndefined(),
  );
});

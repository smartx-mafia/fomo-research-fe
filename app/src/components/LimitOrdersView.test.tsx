// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const sessionState = vi.hoisted(() => ({ jwt: "token", owner: "alice" }));
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
  useSession: () => ({
    jwt: sessionState.jwt,
    user: { identifier: sessionState.owner },
  }),
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
  orderAuthorization: vi.fn().mockResolvedValue({
    authorized: true,
    signer_id: "signer",
    checked_at: "now",
  }),
  orderBalance: vi.fn(),
  createOrder: vi.fn(),
  modifyOrder: vi.fn(),
}));
vi.mock("@/api/token-risk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/token-risk")>()),
  getOrderRisk: vi.fn(),
  confirmOrderRisk: vi.fn(),
}));
import * as riskAPI from "@/api/token-risk";
import { LimitOrdersView } from "./LimitOrdersView";
import * as api from "@/api/limit-orders";
import { ApiError } from "@/api/envelope";
import {
  readPendingLimitOrder,
  savePendingLimitOrder,
} from "@/session/storage";
beforeEach(() => {
  sessionState.jwt = "token";
  sessionState.owner = "alice";
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.clearAllMocks();
  vi.mocked(api.orderBalance).mockImplementation(async (_bearer, wallet_id, chain, asset) => ({
    wallet_id, chain, asset, balance_raw: "100000000000000000000", observed_at: new Date().toISOString(),
  }));
  vi.mocked(api.listOrders).mockResolvedValue({ orders: [], next_cursor: "" });
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

const recoveryInput: api.OrderInput = {
  scenario: 1,
  intent: {
    origin_chain: "solana:mainnet",
    destination_chain: "solana:mainnet",
    origin_asset: "cash",
    destination_asset: "token",
    source_wallet_id: "wallet",
    destination_wallet_id: "wallet",
    amount_in_raw: "1000000",
    side: 3,
    fee_policy: 1,
  },
  target_usd: "2",
  fee_cap_usd: "1",
  expires_at: "2030-01-01T00:00:00Z",
};
function recoveryOrder(version: string, state = 1): api.LimitOrder {
  return {
    order_id: "original",
    version,
    event_version: version,
    state,
    reason: "",
    cancel_requested: false,
    needs_attention: false,
    created_at: "",
    updated_at: "",
    configuration: {
      ...recoveryInput,
      chain: "solana",
      token: "token",
      target_usd: "2",
      expires_at: "2030-01-01T00:00:00Z",
    },
  };
}
it("checks the original after a modification conflict without creating or applying a new version", async () => {
  savePendingLimitOrder("alice", "http://localhost:8083", {
    key: "pending-edit",
    input: recoveryInput,
    edit: { order_id: "original", version: "9007199254740992" },
  });
  vi.mocked(api.modifyOrder).mockRejectedValue(
    new ApiError("business", 420800, "conflict", "LIMITORDER_VERSION_CONFLICT"),
  );
  vi.mocked(api.getOrder).mockResolvedValue(recoveryOrder("9007199254740993"));
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await screen.findByText(/原版本已失效/);
  expect(api.createOrder).not.toHaveBeenCalled();
  expect(api.modifyOrder).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.modifyOrder).mock.calls[0][1]).toEqual({
    order_id: "original",
    version: "9007199254740992",
  });
  expect(
    readPendingLimitOrder("alice", "http://localhost:8083"),
  ).toBeUndefined();
});
it("retains an uncertain modification when a read still sees the same waiting version", async () => {
  savePendingLimitOrder("alice", "http://localhost:8083", {
    key: "pending-edit",
    input: recoveryInput,
    edit: { order_id: "original", version: "7" },
  });
  vi.mocked(api.getOrder).mockResolvedValue(recoveryOrder("7"));
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: "核对原订单修改结果" }),
  );
  await screen.findByText(/修改是否完成尚未确认/);
  expect(
    readPendingLimitOrder("alice", "http://localhost:8083")?.edit?.version,
  ).toBe("7");
  expect(api.createOrder).not.toHaveBeenCalled();
  expect(api.modifyOrder).not.toHaveBeenCalled();
});
it("copies a confirmed failed order into a draft without automatically creating", async () => {
  const failed = recoveryOrder("1", 5);
  vi.mocked(api.listOrders).mockResolvedValue({
    orders: [failed],
    next_cursor: "",
  });
  vi.mocked(api.getOrder).mockResolvedValue(failed);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(await screen.findByRole("button", { name: "以此重新创建" }));
  await screen.findByText(/已复制失败订单的固定条件/);
  expect((screen.getByLabelText("数量 / 比例") as HTMLInputElement).value).toBe(
    "1",
  );
  expect((screen.getByLabelText(/有效期/) as HTMLInputElement).value).toBe("");
  expect(api.createOrder).not.toHaveBeenCalled();
  expect(api.modifyOrder).not.toHaveBeenCalled();
});
it("requires explicit risk confirmation and retries the same creation identity", async () => {
  savePendingLimitOrder("alice", "http://localhost:8083", {
    key: "same-risk-key",
    input: recoveryInput,
  });
  const scope = {
    chain: "solana",
    address: "token",
    flow_id: "fastswap:limit:original:1",
  };
  vi.mocked(api.createOrder)
    .mockRejectedValueOnce(
      new ApiError(
        "business",
        430403,
        "confirmation required",
        "TOKEN_RISK_CONFIRMATION_REQUIRED",
        undefined,
        undefined,
        undefined,
        scope,
      ),
    )
    .mockResolvedValueOnce(recoveryOrder("1"));
  vi.mocked(api.getOrder).mockResolvedValue(recoveryOrder("1"));
  const assessment = {
    mode: "enforce",
    grade: 4,
    buy_action: "confirm",
    confirmation_version: "risk-version",
    items: [{ code: "known_risk", title: "已知风险", detail: "测试风险说明" }],
  };
  vi.mocked(riskAPI.getOrderRisk).mockResolvedValue(assessment);
  vi.mocked(riskAPI.confirmOrderRisk).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await screen.findByText("已知风险 测试风险说明");
  expect(riskAPI.confirmOrderRisk).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "已阅读风险，确认本次流程" }),
  );
  await screen.findByText(/风险确认已记录/);
  expect(riskAPI.confirmOrderRisk).toHaveBeenCalledWith(
    "token",
    scope,
    assessment,
  );
  expect(api.createOrder).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.createOrder).mock.calls[1]).toEqual(
    vi.mocked(api.createOrder).mock.calls[0],
  );
});

it("returns to editing after a definitive capacity rejection instead of retaining an uncertain create", async () => {
  savePendingLimitOrder("alice", "http://localhost:8083", {
    key: "capacity",
    input: recoveryInput,
  });
  vi.mocked(api.createOrder).mockRejectedValueOnce(
    new ApiError(
      "business",
      420803,
      "capacity exceeded",
      "LIMITORDER_MARKET_CAPACITY",
    ),
  );
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" }),
  );
  await screen.findByText(/LIMITORDER_MARKET_CAPACITY/);
  expect(
    readPendingLimitOrder("alice", "http://localhost:8083"),
  ).toBeUndefined();
  expect(screen.getByRole("button", { name: "检查并预览" })).toBeTruthy();
  expect(api.createOrder).toHaveBeenCalledTimes(1);
});

it("keeps percentage preview distinct from a fixed atomic amount", async () => {
  savePendingLimitOrder("alice", "http://localhost:8083", {
    key: "percentage-preview",
    input: {
      ...recoveryInput,
      intent: { ...recoveryInput.intent, amount_in_raw: "" },
      quantity_percent: "25",
    },
  });
  render(<LimitOrdersView />);
  const preview = await screen.findByText(/确认：创建时余额的 25%/);
  expect(preview.textContent).toContain("服务端换算为固定数量");
  expect(preview.textContent).not.toContain("原子单位");
  expect(api.createOrder).not.toHaveBeenCalled();
});

it.each([3, 5])("shows original slippage cause without treating it as refund completion (state %s)", async (state) => {
  const order = recoveryOrder("1", state);
  order.reason = state === 5 ? "refunded" : "";
  order.execution = {
    revision: "1", actual_slippage_bps: 100, expected_out_raw: "100", min_out_raw: "99", quoted_fees: [],
    execution: { failure_cause: "slippage", recovery_action: "adjust_slippage" },
    settlement: state === 5 ? { amount_refunded_raw: "990000", refund_fee_delta_raw: "10000" } : {},
  };
  vi.mocked(api.listOrders).mockResolvedValue({ orders: [order], next_cursor: "" });
  vi.mocked(api.getOrder).mockResolvedValue(order);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(await screen.findByRole("button", { name: /回落买入.*\$/ }));
  const failure = await screen.findByRole("region", { name: "执行失败原因" });
  expect(failure.textContent).toContain("slippage");
  expect(failure.textContent).toContain("adjust_slippage");
  expect(failure.textContent).toContain("失败原因不代表退款已完成");
  expect(failure.textContent).toContain("不会按此处置码自动重下");
  expect(api.createOrder).not.toHaveBeenCalled();
  if (state === 3) expect(screen.getByText(/实际退款数量/).textContent).toContain("未确认");
  else expect(screen.getByText(/实际退款数量/).textContent).toContain("990000");
});

it("separates resolved quantity, quoted fees and settlement actuals without losing precision", async () => {
  const order = recoveryOrder("1");
  order.configuration.quantity_percent = "25";
  order.execution = {
    revision: "3",
    actual_slippage_bps: 0,
    expected_out_raw: "2000",
    min_out_raw: "1990",
    quoted_fees: [
      {
        chain: "solana",
        asset: "cash",
        symbol: "USDC",
        amount_raw: "9007199254740993",
        decimals: 6,
        payer: 1,
        kind: 1,
        amount_usd: "0.010000",
      },
      {
        chain: "solana",
        asset: "native",
        symbol: "SOL",
        amount_raw: "0",
        decimals: 9,
        payer: 2,
        kind: 3,
      },
      { chain: "solana", asset: "unknown", amount_raw: "123" },
    ],
    settlement: {
      amount_in_actual_raw: "0",
      amount_out_actual_raw: "0",
      amount_refunded_raw: "1000000",
      refund_fee_delta_raw: "0",
    },
  };
  vi.mocked(api.listOrders).mockResolvedValue({
    orders: [order],
    next_cursor: "",
  });
  vi.mocked(api.getOrder).mockResolvedValue(order);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: /回落买入.*等待触发/ }),
  );
  await screen.findByText(
    /固定输入：1000000 原子单位（创建时余额的 25% 换算结果）/,
  );
  const quoted = screen.getByRole("region", { name: "执行报价信息" });
  expect(quoted.textContent).toContain("9007199254.740993 USDC");
  expect(quoted.textContent).toContain("用户承担");
  expect(quoted.textContent).toContain("平台承担");
  expect(quoted.textContent).toContain("付款方未知");
  expect(quoted.textContent).toContain("123 base units");
  expect(quoted.textContent).toContain("美元估值 未知");
  expect(quoted.textContent).toContain("报价费用估计（非实际扣费）");
  expect(quoted.textContent).toContain("0 bps（非实际成交滑点）");
  await screen.findByText(/实际输入 \/ 输出（原子单位）：0 \/ 0/);
  await screen.findByText(/实际退款数量（原子单位）：1000000/);
});

it("shows unreported settlement values as unknown instead of blank or zero", async () => {
  const order = recoveryOrder("1", 3);
  order.execution = {
    revision: "1",
    actual_slippage_bps: 100,
    expected_out_raw: "",
    min_out_raw: "",
    quoted_fees: [],
    settlement: {
      amount_in_actual_raw: "",
      amount_out_actual_raw: "",
      amount_refunded_raw: "",
      refund_fee_delta_raw: "",
    },
  };
  vi.mocked(api.listOrders).mockResolvedValue({
    orders: [order],
    next_cursor: "",
  });
  vi.mocked(api.getOrder).mockResolvedValue(order);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: /回落买入.*待确认/ }),
  );
  await screen.findByText(/实际输入 \/ 输出（原子单位）：未确认 \/ 未确认/);
  await screen.findByText(/实际退款数量（原子单位）：未确认/);
  await screen.findByText(
    /报价预计输出 \/ 最低输出（原子单位）：未提供 \/ 未提供/,
  );
});

it("shows posted signed fee facts separately from estimates and platform gas", async () => {
  const order = recoveryOrder("1", 4);
  order.execution = {
    revision: "1",
    actual_slippage_bps: 50,
    expected_out_raw: "100",
    min_out_raw: "99",
    quoted_fees: [],
    settled_fees: {
      chain: "solana",
      chain_id: "792703809",
      asset: "cash",
      execution_raw: "0",
      app_raw: "9007199254740993",
      swap_raw: "-9378",
      platform_gas_raw: "5000",
      app_usd_reported: "0.01000000",
    },
  };
  vi.mocked(api.listOrders).mockResolvedValue({
    orders: [order],
    next_cursor: "",
  });
  vi.mocked(api.getOrder).mockResolvedValue(order);
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.click(
    await screen.findByRole("button", { name: /回落买入.*成功/ }),
  );
  const facts = screen.getByRole("region", { name: "已入账费用" });
  expect(facts.textContent).toContain("执行费用：0");
  expect(facts.textContent).toContain("结算方平台费：未知");
  expect(facts.textContent).toContain("应用平台费：9007199254740993");
  expect(facts.textContent).toContain("兑换成本（可为负）：-9378");
  expect(facts.textContent).toContain("源链原生币原子单位）：5000");
  expect(facts.textContent).toContain("结算记录自报，非全部费用");
});

it("clears the previous account draft and signer consent when the session changes", async () => {
  const user = userEvent.setup();
  const view = render(<LimitOrdersView />);
  await user.type(screen.getByLabelText("标的地址"), "previous-account-token");
  await user.selectOptions(screen.getByLabelText("支付钱包"), "wallet");
  await user.click(screen.getByLabelText("我理解后台签名权限及撤销范围"));
  expect(
    (screen.getByLabelText("我理解后台签名权限及撤销范围") as HTMLInputElement).checked,
  ).toBe(true);
  sessionState.jwt = "alice-refreshed-token";
  view.rerender(<LimitOrdersView />);
  expect(
    (screen.getByLabelText("标的地址") as HTMLInputElement).value,
  ).toBe("previous-account-token");
  expect(
    (screen.getByLabelText("支付钱包") as HTMLSelectElement).value,
  ).toBe("wallet");
  expect(
    (screen.getByLabelText("我理解后台签名权限及撤销范围") as HTMLInputElement).checked,
  ).toBe(true);
  sessionState.jwt = "bob-token";
  sessionState.owner = "bob";
  view.rerender(<LimitOrdersView />);
  expect(
    (screen.getByLabelText("标的地址") as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("支付钱包") as HTMLSelectElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("我理解后台签名权限及撤销范围") as HTMLInputElement).checked,
  ).toBe(false);
  expect(api.createOrder).not.toHaveBeenCalled();
});

it.each(["exact", "exceeds", "zero", "fraction", "unavailable"])("checks the single order against raw balance: %s", async (mode) => {
  vi.mocked(api.orderBalance).mockImplementation(async (_bearer, wallet_id, chain, asset) => {
    if (mode === "unavailable") throw new Error("balance RPC unavailable");
    return { wallet_id, chain, asset, balance_raw: mode === "exact" ? "1000000" : mode === "exceeds" ? "999999" : mode === "fraction" ? "1" : "0", observed_at: new Date().toISOString() };
  });
  const user = userEvent.setup();
  render(<LimitOrdersView />);
  await user.type(screen.getByLabelText("标的地址"), "So11111111111111111111111111111111111111112");
  await user.selectOptions(screen.getByLabelText("支付钱包"), "wallet");
  await user.selectOptions(screen.getByLabelText("接收钱包"), "wallet");
  if (mode === "fraction") await user.selectOptions(screen.getByLabelText("数量方式"), "percent");
  await user.type(screen.getByLabelText("数量 / 比例"), mode === "fraction" ? "0.1" : "1");
  await user.type(screen.getByLabelText("目标价 / 涨跌百分比"), "2");
  await user.type(screen.getByLabelText(/有效期/), "2030-01-01T00:00:00Z");
  await user.click(screen.getByRole("button", { name: "检查并预览" }));
  if (mode === "exact") {
    await screen.findByRole("button", { name: "确认提交 / 重试同一请求" });
    expect(screen.getByText(/当前链上余额：1（/)).toBeTruthy();
  } else {
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(mode === "unavailable" ? "balance RPC unavailable" : (mode === "exceeds" || mode === "zero") ? "超过当前链上余额" : "数量为零");
    expect(screen.queryByRole("button", { name: "确认提交 / 重试同一请求" })).toBeNull();
    if (mode === "unavailable") expect(screen.queryByText(/当前链上余额：/)).toBeNull();
    if (mode === "zero") expect(screen.getByText(/当前链上余额：0（/)).toBeTruthy();
  }
  expect(api.createOrder).not.toHaveBeenCalled();
});

import { call } from "./envelope";
import { LIMIT_ORDER_API_BASE } from "@/config";

export type OrderIntent = {
  origin_chain: string;
  destination_chain: string;
  origin_asset: string;
  destination_asset: string;
  source_wallet_id: string;
  destination_wallet_id: string;
  amount_in_raw: string;
  side: 1 | 2 | 3;
  fee_policy: 1;
  slippage_mode?: 1 | 2;
  slippage_bps?: number;
};
export type OrderInput = {
  scenario: 1 | 2 | 3 | 4;
  intent: OrderIntent;
  target_usd?: string;
  target_percent?: string;
  quantity_percent?: string;
  fee_cap_usd: string;
  expires_at?: string;
};
export type OrderEvent = {
  order_id: string;
  event_version: string;
  state: number;
  reason: string;
  created_at: string;
};
export type LimitOrder = {
  order_id: string;
  version: string;
  event_version: string;
  state: number;
  reason: string;
  cancel_requested: boolean;
  needs_attention: boolean;
  created_at: string;
  updated_at: string;
  configuration: OrderInput & {
    chain: string;
    token: string;
    target_usd: string;
    base_usd?: string;
    base_at?: string;
    expires_at: string;
  };
  trigger?: { price_usd: string; collected_at: string; triggered_at: string };
  swap_id?: string;
  execution?: {
    revision: string;
    actual_slippage_bps: number;
    expected_out_raw: string;
    min_out_raw: string;
    quoted_fees: {
      chain: string;
      asset: string;
      amount_raw: string;
      decimals?: number;
      symbol?: string;
      payer?: number;
      kind?: number;
      amount_usd?: string;
    }[];
    settled_fees?: {
      chain: string;
      chain_id: string;
      asset: string;
      execution_raw?: string;
      platform_raw?: string;
      app_raw?: string;
      swap_raw?: string;
      platform_gas_raw?: string;
      app_usd_reported?: string;
    };
    settlement?: {
      amount_in_actual_raw?: string;
      amount_out_actual_raw?: string;
      amount_refunded_raw?: string;
      refund_fee_delta_raw?: string;
      destination_tx_hash?: string;
    };
    execution?: {
      origin_tx_hash?: string;
      failure_cause?: string;
      recovery_action?: string;
    };
  };
};
export type OrderAuthorization = {
  wallet_id: string;
  signer_id: string;
  authorized: boolean;
  checked_at: string;
  reason: string;
};
function endpoint(path = "") {
  if (!LIMIT_ORDER_API_BASE)
    throw new Error(
      "Configure NEXT_PUBLIC_LIMIT_ORDER_API_BASE before using limit orders.",
    );
  return `${LIMIT_ORDER_API_BASE}/v1/limit-orders${path}`;
}
function checkOrder(order: LimitOrder): LimitOrder {
  if (
    !order ||
    !order.order_id ||
    !/^[1-9]\d*$/.test(order.version) ||
    !/^[1-9]\d*$/.test(order.event_version) ||
    !order.configuration ||
    !Number.isInteger(order.state) ||
    order.state < 1 ||
    order.state > 7
  ) {
    throw new Error("Invalid order snapshot. Refresh before taking action.");
  }
  return order;
}
export async function listOrders(
  bearer: string,
  scope: 1 | 2,
  cursor = "",
  signal?: AbortSignal,
) {
  const { data } = await call<{ orders?: LimitOrder[]; next_cursor?: string }>(
    endpoint(
      `?${new URLSearchParams({ scope: String(scope), cursor, limit: "20" })}`,
    ),
    { bearer, signal },
  );
  return {
    orders: (data.orders ?? []).map(checkOrder),
    next_cursor: data.next_cursor || "",
  };
}
export async function getOrder(
  bearer: string,
  id: string,
  signal?: AbortSignal,
) {
  return checkOrder(
    (
      await call<{ order: LimitOrder }>(
        endpoint(`/${encodeURIComponent(id)}`),
        { bearer, signal },
      )
    ).data.order,
  );
}
export async function createOrder(
  bearer: string,
  creation_key: string,
  input: OrderInput,
) {
  return checkOrder(
    (
      await call<{ order: LimitOrder }>(endpoint(), {
        bearer,
        method: "POST",
        body: { creation_key, input },
      })
    ).data.order,
  );
}
export async function modifyOrder(
  bearer: string,
  order: Pick<LimitOrder, "order_id" | "version">,
  input: OrderInput,
) {
  return checkOrder(
    (
      await call<{ order: LimitOrder }>(
        endpoint(`/${encodeURIComponent(order.order_id)}`),
        {
          bearer,
          method: "PUT",
          body: { expected_version: order.version, input },
        },
      )
    ).data.order,
  );
}
export async function cancelOrder(bearer: string, id: string) {
  return checkOrder(
    (
      await call<{ order: LimitOrder }>(
        endpoint(`/${encodeURIComponent(id)}/cancel`),
        { bearer, method: "POST", body: {} },
      )
    ).data.order,
  );
}
export async function orderAuthorization(
  bearer: string,
  wallet_id: string,
  chain: string,
) {
  return (
    await call<OrderAuthorization>(
      endpoint(`/authorization?${new URLSearchParams({ wallet_id, chain })}`),
      { bearer },
    )
  ).data;
}
export async function orderEvents(
  bearer: string,
  id: string,
  after: string,
  signal?: AbortSignal,
) {
  return (
    (
      await call<{ events?: OrderEvent[] }>(
        endpoint(
          `/${encodeURIComponent(id)}/events?${new URLSearchParams({ after_event_version: after, limit: "256" })}`,
        ),
        { bearer, signal },
      )
    ).data.events ?? []
  );
}
export function mergeOrderEvents(
  old: readonly OrderEvent[],
  incoming: readonly OrderEvent[],
): OrderEvent[] {
  const events = new Map(
    old.map((e) => [`${e.order_id}:${e.event_version}`, e]),
  );
  for (const e of incoming) {
    if (!/^[1-9]\d*$/.test(e.event_version))
      throw new Error("Invalid order event version.");
    events.set(`${e.order_id}:${e.event_version}`, e);
  }
  return [...events.values()].sort(
    (a, b) =>
      a.order_id.localeCompare(b.order_id) ||
      (BigInt(a.event_version) < BigInt(b.event_version)
        ? -1
        : BigInt(a.event_version) > BigInt(b.event_version)
          ? 1
          : 0),
  );
}

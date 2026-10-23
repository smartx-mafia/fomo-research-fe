"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePrivy, useSigners } from "@privy-io/react-auth";
import {
  LIMIT_ORDER_API_BASE,
  LIMIT_ORDER_SIGNER_ID,
  PRIVY_APP_ID,
} from "@/config";
import {
  useSession,
  readPendingLimitOrder,
  savePendingLimitOrder,
  type PendingLimitOrder,
} from "@/session/storage";
import { ApiError } from "@/api/envelope";
import * as api from "@/api/limit-orders";
import {
  riskScope,
  getOrderRisk,
  canConfirmRisk,
  confirmOrderRisk,
  type RiskScope,
  type RiskAssessment,
} from "@/api/token-risk";
import { getTokenInfo, formatUnits } from "@/api/trade";
import { formatBaseUnitsExact, parseExactDecimal } from "@/lib/exact-decimal";
import {
  orderInput,
  ORDER_CHAINS,
  type OrderDraft,
} from "@/lib/limit-order-input";

const labels = [
  "",
  "等待触发",
  "执行中",
  "待确认",
  "成功",
  "失败",
  "已取消",
  "已过期",
];
const scenarios = ["回落买入", "突破买入", "止盈卖出", "止损卖出"];
const field = "rounded border border-border bg-background p-2 w-full";
const button = "rounded border border-border px-3 py-2 disabled:opacity-40";
const initial: OrderDraft = {
  scenario: 1,
  chain: "solana",
  token: "",
  amount: "",
  quantityMode: "amount",
  target: "",
  targetMode: "usd",
  slippage: "",
  feeCap: "1",
  expiry: "",
  sourceWallet: "",
  destinationWallet: "",
};
function message(e: unknown) {
  if (e instanceof ApiError)
    return `${e.reason || e.kind} (${e.code}) · ${e.message}`;
  return e instanceof Error ? e.message : "请求失败";
}
export function LimitOrdersView() {
  if (!PRIVY_APP_ID || !LIMIT_ORDER_API_BASE)
    return (
      <section>
        <h1 className="text-2xl">挂单测试</h1>
        <p>请配置 Privy 和 NEXT_PUBLIC_LIMIT_ORDER_API_BASE 后启动测试页面。</p>
        <Link href="/login">前往登录</Link>
      </section>
    );
  return <OrderWorkspace />;
}
function OrderWorkspace() {
  const session = useSession();
  const { user, ready, authenticated } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const [draft, setDraft] = useState<OrderDraft>(initial);
  const [scope, setScope] = useState<1 | 2>(1);
  const [orders, setOrders] = useState<api.LimitOrder[]>([]);
  const [cursor, setCursor] = useState("");
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<api.LimitOrder>();
  const [events, setEvents] = useState<api.OrderEvent[]>([]);
  const [editing, setEditing] = useState<api.LimitOrder>();
  const [review, setReview] = useState<PendingLimitOrder>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [risk, setRisk] = useState<{
    scope: RiskScope;
    assessment: RiskAssessment;
  }>();
  const [sent, setSent] = useState(false);
  const [auth, setAuth] = useState<api.OrderAuthorization>();
  const [consent, setConsent] = useState(false);
  const [balance, setBalance] = useState<(api.OrderBalance & { decimals: number })>();
  const jwt = session?.jwt;
  const current = useRef(jwt);
  current.current = jwt;
  type EmbeddedWallet = Extract<
    NonNullable<typeof user>["linkedAccounts"][number],
    { type: "wallet" }
  >;
  const wallets = (user?.linkedAccounts ?? []).filter(
    (a): a is EmbeddedWallet =>
      a.type === "wallet" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2"),
  );
  const chain = ORDER_CHAINS.find((c) => c.slug === draft.chain)!;
  const buy = draft.scenario <= 2;
  const sourceKind = buy || draft.chain === "solana" ? "solana" : "ethereum";
  const destinationKind =
    !buy || draft.chain === "solana" ? "solana" : "ethereum";
  const source = wallets.find(
    (w) => w.type === "wallet" && (w.id || w.address) === draft.sourceWallet,
  );
  function change<K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setReview(undefined);
    setRisk(undefined);
    setAuth(undefined);
    if (["scenario", "chain", "token", "sourceWallet"].includes(key)) setBalance(undefined);
  }
  async function run(action: (bearer: string) => Promise<void>) {
    if (!jwt || busy) return;
    const bearer = jwt;
    setBusy(true);
    setError("");
    try {
      await action(bearer);
    } catch (e) {
      if (current.current === bearer) setError(message(e));
    } finally {
      if (current.current === bearer) setBusy(false);
    }
  }
  useEffect(() => {
    setDraft(initial);
    setConsent(false);
    setBalance(undefined);
  }, [session?.user?.identifier]);
  useEffect(() => {
    setOrders([]);
    setNotice("");
    setRisk(undefined);
    setSelected(undefined);
    setEvents([]);
    setEditing(undefined);
    const recovered = session?.user?.identifier
      ? readPendingLimitOrder(session.user.identifier, LIMIT_ORDER_API_BASE)
      : undefined;
    setReview(recovered);
    setSent(!!recovered);
    setAuth(undefined);
    setBusy(false);
    setError("");
  }, [jwt, session?.user?.identifier]);
  useEffect(() => {
    if (!jwt) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const bearer = jwt;
    async function poll() {
      try {
        let next = "";
        const rows: api.LimitOrder[] = [];
        for (let page = 0; page < pages; page++) {
          const result = await api.listOrders(
            bearer,
            scope,
            next,
            abort.signal,
          );
          rows.push(...result.orders);
          next = result.next_cursor;
          if (!next) break;
        }
        if (abort.signal.aborted || current.current !== bearer) return;
        setOrders([...new Map(rows.map((o) => [o.order_id, o])).values()]);
        setCursor(next);
      } catch (e) {
        if (!abort.signal.aborted) setError(message(e));
      } finally {
        if (!abort.signal.aborted && scope === 1)
          timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [jwt, scope, pages]);
  useEffect(() => {
    if (!jwt || !selected?.order_id) return;
    const id = selected.order_id;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let after = "0";
    setEvents([]);
    async function poll() {
      try {
        const [order, incoming] = await Promise.all([
          api.getOrder(jwt!, id, abort.signal),
          api.orderEvents(jwt!, id, after, abort.signal),
        ]);
        if (abort.signal.aborted) return;
        setSelected((old) =>
          old?.order_id === order.order_id &&
          BigInt(old.event_version) > BigInt(order.event_version)
            ? old
            : order,
        );
        setEvents((old) => api.mergeOrderEvents(old, incoming));
        for (const e of incoming)
          if (BigInt(e.event_version) > BigInt(after)) after = e.event_version;
      } catch (e) {
        if (!abort.signal.aborted) setError(message(e));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [jwt, selected?.order_id]);
  async function loadMore() {
    setPages((p) => p + 1);
  }
  async function prepare() {
    await run(async (bearer) => {
      setBalance(undefined);
      const info = await getTokenInfo(draft.chain, draft.token.trim());
      const destination = wallets.find(
        (w) =>
          w.type === "wallet" &&
          (w.id || w.address) === draft.destinationWallet,
      );
      if (
        !source?.id ||
        !destination ||
        destination.type !== "wallet" ||
        !destination.id
      )
        throw new Error("请先授权并刷新钱包资料，再选择具备 ID 的钱包。");
      const input = orderInput(
        {
          ...draft,
          sourceWallet: source.id,
          destinationWallet: destination.id,
        },
        info.decimals,
      );
      const observed = await api.orderBalance(
        bearer, input.intent.source_wallet_id, input.intent.origin_chain, input.intent.origin_asset,
      );
      if (current.current !== bearer) return;
      setBalance({ ...observed, decimals: buy ? 6 : info.decimals });
      const raw = BigInt(observed.balance_raw);
      const percent = input.quantity_percent ? parseExactDecimal(input.quantity_percent) : undefined;
      const amount = percent
        ? raw * percent.coefficient / (BigInt(100) * BigInt(10) ** BigInt(percent.scale))
        : BigInt(input.intent.amount_in_raw);
      if (amount <= BigInt(0)) throw new Error("余额或比例换算后的数量为零，请调整数量。");
      if (amount > raw) throw new Error("本单数量超过当前链上余额，请调整数量。");
      const authorization = await api.orderAuthorization(
        bearer,
        input.intent.source_wallet_id,
        input.intent.origin_chain,
      );
      if (current.current !== bearer) return;
      setAuth(authorization);
      if (!authorization.authorized)
        throw new Error("请先授权后台 signer，再创建挂单。");
      setReview({
        input,
        key: crypto.randomUUID(),
        ...(editing
          ? { edit: { order_id: editing.order_id, version: editing.version } }
          : {}),
      });
      setSent(false);
    });
  }
  async function reconcileModification(
    bearer: string,
    pending: PendingLimitOrder,
  ) {
    if (!pending.edit) return;
    const fresh = await api.getOrder(bearer, pending.edit.order_id);
    if (current.current !== bearer) return;
    setSelected(fresh);
    if (
      fresh.state === 1 &&
      BigInt(fresh.version) <= BigInt(pending.edit.version)
    ) {
      setNotice(
        "原版本仍在等待中，修改是否完成尚未确认。可重试同一修改请求，不能据此另建订单。",
      );
      return;
    }
    const owner = session?.user?.identifier;
    if (!owner) return;
    savePendingLimitOrder(owner, LIMIT_ORDER_API_BASE);
    setReview(undefined);
    setRisk(undefined);
    setEditing(undefined);
    setSent(false);
    setNotice(
      "原版本已失效，已读取原订单的最新事实。请核对详情；这不代表本次修改一定成功，系统没有另建订单。",
    );
  }
  async function submit() {
    if (!review) return;
    await run(async (bearer) => {
      const owner = session?.user?.identifier;
      if (!owner) throw new Error("请重新登录以获取账号身份。");
      savePendingLimitOrder(owner, LIMIT_ORDER_API_BASE, review);
      setSent(true);
      let order: api.LimitOrder;
      try {
        order = review.edit
          ? await api.modifyOrder(bearer, review.edit, review.input)
          : await api.createOrder(bearer, review.key, review.input);
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.reason === "TOKEN_RISK_CONFIRMATION_REQUIRED"
        ) {
          const scope = riskScope(e, review.input);
          const assessment = await getOrderRisk(bearer, scope);
          if (current.current === bearer) setRisk({ scope, assessment });
          return;
        }
        if (e instanceof ApiError && e.code === 420800 && review.edit) {
          await reconcileModification(bearer, review);
          return;
        }
        if (
          e instanceof ApiError &&
          [100800, 430800, 430801, 430802, 420802, 420803].includes(e.code)
        ) {
          savePendingLimitOrder(owner, LIMIT_ORDER_API_BASE);
          if (current.current === bearer) {
            setReview(undefined);
            setRisk(undefined);
            setSent(false);
          }
        }
        throw e;
      }
      savePendingLimitOrder(owner, LIMIT_ORDER_API_BASE);
      if (current.current !== bearer) return;
      setSelected(order);
      setOrders((old) => [
        order,
        ...old.filter((o) => o.order_id !== order.order_id),
      ]);
      setReview(undefined);
      setRisk(undefined);
      setEditing(undefined);
    });
  }
  async function edit(order: api.LimitOrder, recreate = false) {
    if (review) return;
    await run(async (bearer) => {
      const fresh = await api.getOrder(bearer, order.order_id);
      if (fresh.state !== (recreate ? 5 : 1))
        throw new Error(
          recreate
            ? "原订单尚未确认失败，不能据此重新创建。"
            : "只有等待中的挂单可以修改。",
        );
      const c = fresh.configuration;
      const info = await getTokenInfo(c.chain, c.token);
      if (current.current !== bearer) return;
      setDraft({
        scenario: c.scenario,
        chain: c.chain,
        token: c.token,
        amount: formatUnits(
          c.intent.amount_in_raw,
          c.scenario <= 2 ? 6 : info.decimals,
        ),
        quantityMode: "amount",
        target: c.target_usd,
        targetMode: "usd",
        slippage:
          c.intent.slippage_mode === 2
            ? String((c.intent.slippage_bps ?? 0) / 100)
            : "",
        feeCap: c.fee_cap_usd,
        expiry: recreate ? "" : c.expires_at,
        sourceWallet: c.intent.source_wallet_id,
        destinationWallet: c.intent.destination_wallet_id,
      });
      setBalance(undefined);
      setEditing(recreate ? undefined : fresh);
      setNotice(
        recreate
          ? "已复制失败订单的固定条件。请设置新的有效期并检查授权，确认后才会创建新订单。"
          : "修改仅对原订单当前版本生效；提交前会再次检查授权与风险。",
      );
      setReview(undefined);
      setRisk(undefined);
      setSelected(fresh);
    });
  }
  if (!jwt)
    return (
      <section>
        <h1 className="text-2xl">挂单测试</h1>
        <Link href="/login">登录后创建和管理挂单</Link>
      </section>
    );
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">挂单测试</h1>
        <p className="text-muted">
          到价触发 FastSwap。关闭页面后仍由后台执行。
        </p>
      </header>
      <div className="rounded border border-amber-500/50 p-3 text-sm">
        等待中不冻结资金；到价不保证成交价格。失败也可能产生网络费用。比例在服务端创建时换算为固定数量，之后不随余额变化。现有接口未提供可配置防夹选项。
      </div>
      {notice && (
        <p role="status" className="rounded border border-border p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="break-all text-red-400">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded border border-border p-4">
          <h2 className="font-semibold">
            {editing ? "修改等待中的挂单" : "新建挂单"}
          </h2>
          <fieldset
            disabled={busy || !!review}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label>
              场景
              <select
                className={field}
                value={draft.scenario}
                onChange={(e) =>
                  change(
                    "scenario",
                    Number(e.target.value) as OrderDraft["scenario"],
                  )
                }
              >
                {scenarios.map((s, i) => (
                  <option key={s} value={i + 1}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标的链
              <select
                className={field}
                value={draft.chain}
                onChange={(e) => change("chain", e.target.value)}
              >
                {ORDER_CHAINS.map((c) => (
                  <option key={c.slug}>{c.slug}</option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              标的地址
              <input
                className={field}
                value={draft.token}
                onChange={(e) => change("token", e.target.value)}
              />
            </label>
            {(["sourceWallet", "destinationWallet"] as const).map((key, i) => (
              <label key={key}>
                {i ? "接收钱包" : "支付钱包"}
                <select
                  className={field}
                  value={draft[key]}
                  onChange={(e) => change(key, e.target.value)}
                >
                  <option value="">选择嵌入式钱包</option>
                  {wallets
                    .filter(
                      (w) =>
                        w.type === "wallet" &&
                        w.chainType === (i ? destinationKind : sourceKind),
                    )
                    .map(
                      (w) =>
                        w.type === "wallet" && (
                          <option key={w.address} value={w.id || w.address}>
                            {w.address}
                            {!w.id ? "（需先授权）" : ""}
                          </option>
                        ),
                    )}
                </select>
              </label>
            ))}
            <label>
              数量方式
              <select
                className={field}
                value={draft.quantityMode}
                onChange={(e) =>
                  change(
                    "quantityMode",
                    e.target.value as OrderDraft["quantityMode"],
                  )
                }
              >
                <option value="amount">{buy ? "USDC 金额" : "代币数量"}</option>
                <option value="percent">余额比例 %</option>
              </select>
            </label>
            <label>
              数量 / 比例
              <input
                className={field}
                value={draft.amount}
                onChange={(e) => change("amount", e.target.value)}
              />
            </label>
            <p className="sm:col-span-2 text-sm text-muted">
              {balance
                ? `当前链上余额：${formatUnits(balance.balance_raw, balance.decimals)}（${balance.observed_at}）`
                : "检查并预览时读取当前链上余额；读取失败不会按零处理。"}
              {" "}等待挂单不冻结余额，触发时后台仍会重新检查。
            </p>
            <label>
              目标方式
              <select
                className={field}
                value={draft.targetMode}
                onChange={(e) =>
                  change(
                    "targetMode",
                    e.target.value as OrderDraft["targetMode"],
                  )
                }
              >
                <option value="usd">每枚 USD</option>
                <option value="percent">当前价格变化 %</option>
              </select>
            </label>
            <label>
              目标价 / 涨跌百分比
              <input
                className={field}
                value={draft.target}
                onChange={(e) => change("target", e.target.value)}
              />
            </label>
            <label>
              手动滑点 %（留空 AUTO）
              <input
                className={field}
                value={draft.slippage}
                onChange={(e) => change("slippage", e.target.value)}
              />
            </label>
            <label>
              累计费用上限 USD
              <input
                className={field}
                value={draft.feeCap}
                onChange={(e) => change("feeCap", e.target.value)}
              />
            </label>
            <label className="sm:col-span-2">
              有效期（含时区的时间，如 2026-10-24T12:00:00+08:00）
              <input
                className={field}
                value={draft.expiry}
                onChange={(e) => change("expiry", e.target.value)}
              />
            </label>
          </fieldset>
          <div className="space-y-2 border-t border-border pt-3">
            <h3>后台签名授权</h3>
            <p className="text-xs">
              授权允许后台 signer 在页面关闭后签名；撤销不撤回已提交交易。Privy
              当前 SDK 的撤销操作会移除该钱包全部 additional signers。
            </p>
            <label className="block">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              我理解后台签名权限及撤销范围
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy || !source?.id}
                onClick={() =>
                  void run(async (bearer) => {
                    const result = await api.orderAuthorization(
                      bearer,
                      source!.id!,
                      buy ? "solana:mainnet" : chain.caip,
                    );
                    if (current.current === bearer) setAuth(result);
                  })
                }
              >
                检查服务端授权
              </button>
              <button
                className={button}
                disabled={
                  busy ||
                  !ready ||
                  !authenticated ||
                  !source ||
                  !consent ||
                  !LIMIT_ORDER_SIGNER_ID
                }
                onClick={() =>
                  void run(async (bearer) => {
                    const updated = await addSigners({
                      address: source!.address,
                      signers: [{ signerId: LIMIT_ORDER_SIGNER_ID }],
                    });
                    const wallet = updated.user.linkedAccounts.find(
                      (w) =>
                        w.type === "wallet" && w.address === source!.address,
                    );
                    if (!wallet || wallet.type !== "wallet" || !wallet.id)
                      throw new Error(
                        "授权已提交，请刷新钱包资料后检查服务端授权。",
                      );
                    const result = await api.orderAuthorization(
                      bearer,
                      wallet.id,
                      buy ? "solana:mainnet" : chain.caip,
                    );
                    if (current.current === bearer) {
                      setAuth(result);
                      setDraft((d) => ({ ...d, sourceWallet: wallet.id! }));
                    }
                  })
                }
              >
                授权后台 signer
              </button>
              <button
                className={button}
                disabled={busy || !source || !consent}
                onClick={() =>
                  void run(async (bearer) => {
                    await removeSigners({ address: source!.address });
                    if (current.current === bearer) setAuth(undefined);
                  })
                }
              >
                撤销全部后台 signer
              </button>
            </div>
            {auth && (
              <p>
                {auth.authorized ? "服务端已确认授权" : "未授权或授权失效"} ·{" "}
                {auth.checked_at}
              </p>
            )}
          </div>
          {!review ? (
            <button
              className={button}
              disabled={busy}
              onClick={() => void prepare()}
            >
              检查并预览
            </button>
          ) : (
            <div className="space-y-2 rounded border border-border p-3">
              <p>
                确认：
                {review.input.quantity_percent
                  ? `创建时余额的 ${review.input.quantity_percent}%（服务端换算为固定数量，创建后查看结果）`
                  : `固定输入 ${review.input.intent.amount_in_raw} 原子单位`}
                ；目标{" "}
                {review.input.target_usd
                  ? `$${review.input.target_usd}`
                  : `${review.input.target_percent}%`}
                ；费用上限 ${review.input.fee_cap_usd}。
              </p>
              <button
                className={button}
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "处理中…" : "确认提交 / 重试同一请求"}
              </button>
              {sent && review.edit && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run((bearer) => reconcileModification(bearer, review))
                  }
                >
                  核对原订单修改结果
                </button>
              )}
              {risk && (
                <div
                  role="region"
                  aria-label="本次订单风险确认"
                  className="space-y-2 rounded border border-amber-500 p-3"
                >
                  <h3>当前风险等级 R{risk.assessment.grade}</h3>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      const owner = session?.user?.identifier;
                      if (!owner) return;
                      try {
                        savePendingLimitOrder(owner, LIMIT_ORDER_API_BASE);
                        setReview(undefined);
                        setRisk(undefined);
                        setSent(false);
                        setNotice(
                          "未确认本次风险。该请求已被准入拒绝，可修改条件后重新预览。",
                        );
                      } catch (e) {
                        setError(message(e));
                      }
                    }}
                  >
                    不确认，返回修改
                  </button>
                  <p>
                    仅确认本次挂单流程的当前风险版本；未来风险变化仍会在执行时重新检查。
                  </p>
                  {(risk.assessment.items ?? []).map((item, i) => (
                    <p key={`${item.code}:${i}`}>
                      {item.title || item.code} {item.detail}
                    </p>
                  ))}
                  <button
                    className={button}
                    disabled={busy || !canConfirmRisk(risk.assessment)}
                    onClick={() =>
                      void run(async (bearer) => {
                        await confirmOrderRisk(
                          bearer,
                          risk.scope,
                          risk.assessment,
                        );
                        if (current.current === bearer) {
                          setRisk(undefined);
                          setNotice(
                            "风险确认已记录。请重试同一挂单请求，仍需以服务端返回结果为准。",
                          );
                        }
                      })
                    }
                  >
                    已阅读风险，确认本次流程
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async (bearer) => {
                        const assessment = await getOrderRisk(
                          bearer,
                          risk.scope,
                        );
                        if (current.current === bearer)
                          setRisk({ ...risk, assessment });
                      })
                    }
                  >
                    刷新风险证据
                  </button>
                </div>
              )}
              {!sent && (
                <button className={button} onClick={() => setReview(undefined)}>
                  返回修改
                </button>
              )}
              <p className="text-xs">
                网络错误或刷新后保留同一请求，勿重复创建。
              </p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              className={button}
              onClick={() => {
                setPages(1);
                setOrders([]);
                setScope(1);
              }}
            >
              活跃
            </button>
            <button
              className={button}
              onClick={() => {
                setPages(1);
                setOrders([]);
                setScope(2);
              }}
            >
              历史
            </button>
          </div>
          {orders.map((o) => (
            <article
              key={o.order_id}
              className="space-y-2 rounded border border-border p-3"
            >
              <button
                className="text-left break-all underline"
                onClick={() => setSelected(o)}
              >
                {scenarios[o.configuration.scenario - 1]} · {labels[o.state]} ·
                ${o.configuration.target_usd}
              </button>
              <p className="text-xs break-all">{o.configuration.token}</p>
              <p>
                固定数量：{o.configuration.intent.amount_in_raw} 原子单位{" "}
                {o.configuration.quantity_percent &&
                  `（创建时 ${o.configuration.quantity_percent}%）`}
              </p>
              {o.reason && <p>{o.reason}</p>}
              <div className="flex gap-2">
                {o.state === 1 && (
                  <button
                    className={button}
                    disabled={busy || !!review}
                    onClick={() => void edit(o)}
                  >
                    修改
                  </button>
                )}
                {o.state === 5 && (
                  <button
                    className={button}
                    disabled={busy || !!review}
                    onClick={() => void edit(o, true)}
                  >
                    以此重新创建
                  </button>
                )}
                {o.state <= 3 && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async (bearer) => {
                        const result = await api.cancelOrder(
                          bearer,
                          o.order_id,
                        );
                        if (current.current === bearer) setSelected(result);
                      })
                    }
                  >
                    请求撤销
                  </button>
                )}
              </div>
            </article>
          ))}
          {cursor && (
            <button
              className={button}
              disabled={busy}
              onClick={() => void loadMore()}
            >
              加载更多
            </button>
          )}
        </div>
      </div>
      {selected && (
        <article className="space-y-2 rounded border border-border p-4">
          <h2>订单详情 · {labels[selected.state]}</h2>
          <p className="break-all">
            {selected.order_id} · 版本 {selected.version}
          </p>
          {selected.cancel_requested && (
            <p>已登记撤销请求；仍以最终状态为准。</p>
          )}
          {selected.needs_attention && (
            <p>确认超过 15 分钟，需关注；后台继续核对原交易。</p>
          )}
          <p>
            原因：{selected.reason || "—"} · 关联交易：
            {selected.swap_id || "尚无"}
          </p>
          <p>
            固定输入：{selected.configuration.intent.amount_in_raw} 原子单位
            {selected.configuration.quantity_percent &&
              `（创建时余额的 ${selected.configuration.quantity_percent}% 换算结果）`}
          </p>
          <p className="break-all">
            输入资产：{selected.configuration.intent.origin_chain} /{" "}
            {selected.configuration.intent.origin_asset}
            ；输出资产：{selected.configuration.intent.destination_chain} /{" "}
            {selected.configuration.intent.destination_asset}
          </p>
          <p>
            USD 目标价：${selected.configuration.target_usd}；整单费用上限：$
            {selected.configuration.fee_cap_usd}
          </p>
          <p>
            基准价：{selected.configuration.base_usd || "—"} · 基准时间：
            {selected.configuration.base_at || "—"}
          </p>
          <p>
            触发价格：{selected.trigger?.price_usd || "—"} · 时间：
            {selected.trigger?.triggered_at || "—"}
          </p>
          <p>
            实际输入 / 输出（原子单位）：
            {selected.execution?.settlement?.amount_in_actual_raw ||
              "未确认"} /{" "}
            {selected.execution?.settlement?.amount_out_actual_raw || "未确认"}
          </p>
          <p>
            退款费用差额（原子单位）：
            {selected.execution?.settlement?.refund_fee_delta_raw || "未确认"}
            ；未入账或未记录的费用仍为未知。
          </p>
          <p>
            实际退款数量（原子单位）：
            {selected.execution?.settlement?.amount_refunded_raw || "未确认"}
          </p>
          <section aria-label="已入账费用" className="space-y-2">
            <h3>已入账费用（原子单位）</h3>
            {selected.execution?.settled_fees ? (
              <>
                <p className="break-all">
                  费用资产：{selected.execution.settled_fees.chain}（链 ID{" "}
                  {selected.execution.settled_fees.chain_id}） /{" "}
                  {selected.execution.settled_fees.asset}
                </p>
                <p>
                  执行费用：
                  {selected.execution.settled_fees.execution_raw || "未知"}
                  ；结算方平台费：
                  {selected.execution.settled_fees.platform_raw || "未知"}
                </p>
                <p>
                  应用平台费：
                  {selected.execution.settled_fees.app_raw || "未知"}
                  ；兑换成本（可为负）：
                  {selected.execution.settled_fees.swap_raw || "未知"}
                </p>
                <p>
                  应用平台费美元值（结算记录自报，非全部费用）：
                  {selected.execution.settled_fees.app_usd_reported
                    ? `$${selected.execution.settled_fees.app_usd_reported}`
                    : "未知"}
                </p>
                <p>
                  平台承担的源链 Gas（源链原生币原子单位）：
                  {selected.execution.settled_fees.platform_gas_raw || "未知"}
                  ，不计入用户费用合计。
                </p>
              </>
            ) : (
              <p>
                尚无已确认的费用记录；不表示费用为零。失败交易的网络成本可能尚无记录。
              </p>
            )}
          </section>
          {selected.execution && (
            <section aria-label="执行报价信息" className="space-y-2">
              <p>
                执行版本：{selected.execution.revision}；该版滑点容忍：
                {selected.execution.actual_slippage_bps} bps（非实际成交滑点）
              </p>
              <p>
                报价预计输出 / 最低输出（原子单位）：
                {selected.execution.expected_out_raw || "未提供"} /{" "}
                {selected.execution.min_out_raw || "未提供"}
              </p>
              <h3>报价费用估计（非实际扣费）</h3>
              {selected.execution.quoted_fees?.length ? (
                <ul className="space-y-1">
                  {selected.execution.quoted_fees.map((fee, i) => (
                    <li
                      key={`${fee.chain}:${fee.asset}:${fee.kind}:${fee.payer}:${i}`}
                      className="break-all"
                    >
                      {[
                        "未知费用",
                        "平台费",
                        "结算方费用",
                        "Gas",
                        "账户租金",
                        "小费",
                      ][fee.kind ?? 0] || "未知费用"}
                      ：{formatBaseUnitsExact(fee.amount_raw, fee.decimals)}{" "}
                      {fee.symbol || fee.asset}；
                      {fee.payer === 1
                        ? "用户承担"
                        : fee.payer === 2
                          ? "平台承担"
                          : "付款方未知"}
                      ；美元估值{" "}
                      {fee.amount_usd ? `$${fee.amount_usd}` : "未知"}；
                      {fee.chain} / {fee.asset}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>尚无报价费用信息。</p>
              )}
            </section>
          )}
          <details>
            <summary>报价费用与执行事实</summary>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(selected.execution ?? {}, null, 2)}
            </pre>
          </details>
          <details>
            <summary>状态事件（按版本去重）</summary>
            {events.map((e) => (
              <p key={e.event_version}>
                {e.event_version} · {labels[e.state]} · {e.reason} ·{" "}
                {e.created_at}
              </p>
            ))}
          </details>
        </article>
      )}
    </section>
  );
}

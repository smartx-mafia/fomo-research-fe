// business 对外 HTTP 面的最小客户端。契约见 docs/contracts/meme-integration-notes.md §2。
//
// 这里刻意把那份文档里三条最容易踩的坑做成类型与代码：
//   ① 字段是 snake_case，不是 proto 的 lowerCamelCase
//   ② 金额是字符串（21 位十进制装不进 JS 的 number），一律不做 Number()
//   ③ 零值字段**不出现**，所以每个可选字段都是 `?`，判空要用 `in` 或 undefined，
//      而不是 `=== ''`

import {API_PREFIX} from './envs.browser';
import {newTraceID} from './trace';
import {emitTiming, nowMs, resolveUrl} from './transport';

/** 恒 200 信封（红线 9）。HTTP 状态码永远是 200，成败看 code。 */
type Envelope<T> = {
  code: number;
  msg: string;
  data?: T;
  /** 失败时才有，是错误原因的枚举名，如 `BIZ_IDENTITY_TOKEN_INVALID`。 */
  error?: string;
  trace_id?: string;
};

/**
 * 失败分三类 —— 它们指向完全不同的排查方向，绝不能混成一个"请求失败"。
 *
 * - `business`：请求到了、信封回来了，是业务拒绝。看六位码（`codes.ts`）。
 * - `transport`：HTTP 状态码不是 200，**没到信封层**。最常见的是 404
 *   （后端是旧构建，没有这条路由 —— X 绑定那四条路就这么撞过）。
 * - `network`：fetch 本身抛了。dev server 没起、代理目标不通，
 *   或者代码里写了绝对 URL 撞上了 CORS。
 *
 * 这一层从前只有前两类，而且 `transport` 抛的是裸 `Error` ——
 * 于是"这个后端没有这条路由"与"这笔单被业务规则拒了"在 catch 里长得一样，
 * 调用方只能靠读错误文案去猜。分类抄自
 * `../privy-login-demo/src/api/envelope.ts`，那边靠它把自检做成了两个探针。
 */
export type FailureKind = 'business' | 'transport' | 'network';

/** 业务错误。带上 code 与 trace_id —— 报障时这两个就是全部线索。 */
export class ApiError extends Error {
  /** 业务码（六位）。transport 类放 HTTP 状态码，network 类为 0。 */
  readonly code: number;
  readonly kind: FailureKind;
  /** 后端回包里的 trace_id。没到后端时为 undefined。 */
  readonly traceID?: string;
  /** 错误原因枚举名，如 `BIZ_IDENTITY_TOKEN_INVALID`。只有业务失败才有。 */
  readonly reason?: string;
  /**
   * 我们发出去的 `x-request-id`。**任何情况下都有**，这是它存在的意义 ——
   * 请求根本没到后端时（代理不通）本来是没有任何 ID 可报的。
   * 与 `traceID` 不一致说明这个值被后端判非法丢弃了（契约说这是静默失效，
   * 所以只能靠比对发现，见 `trace.ts`）。
   */
  readonly sentRequestID?: string;
  /** transport 类保留响应体前若干字符，用来一眼认出 HTML 错误页。 */
  readonly rawBody?: string;

  constructor(
    kind: FailureKind,
    code: number,
    msg: string,
    extra: {
      traceID?: string;
      reason?: string;
      sentRequestID?: string;
      rawBody?: string;
    } = {},
  ) {
    super(`${code} ${msg}${extra.traceID ? ` (trace_id=${extra.traceID})` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = code;
    this.traceID = extra.traceID;
    this.reason = extra.reason;
    this.sentRequestID = extra.sentRequestID;
    this.rawBody = extra.rawBody;
  }
}

async function call<T>(token: string | null, path: string, init?: RequestInit): Promise<T> {
  // **每次请求新生成，不复用**（契约硬规则，复用比不传更糟 —— 见 trace.ts）。
  const sentRequestID = newTraceID();

  // **目的地在这一处定，且只在这一处。** 走代理时加环境前缀（vite 的代理表
  // 只按路径前缀分流，理由见 `envs.ts`），直连时换成 origin —— 两者互斥，
  // 取舍在 `resolveUrl` 里，这里只认结果。
  //
  // 定在这里而不是各个端点函数里：那样等于每加一条新接口都要记得带上，
  // 而漏掉一处的症状是"这一发莫名其妙打到了另一个环境"，
  // 回包正常、只是数据对不上，没人会往前缀上想。
  const url = resolveUrl(API_PREFIX, path);

  // 计时。**原始时刻一律记下来，差值留给消费者算**（理由见 `RequestTiming`）。
  // 这些变量在失败路径上也要有值，所以声明在 try 外面，由下面的 finally 统一报。
  const method = (init?.method ?? 'GET').toUpperCase();
  const startedAtWall = Date.now();
  const startedAt = nowMs();
  let firstByteAt: number | undefined;
  let status: number | undefined;
  let code: number | undefined;
  let traceID: string | undefined;
  let ok = false;
  let failure: FailureKind | undefined;

  try {
    let resp: Response;
    try {
      resp = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': sentRequestID,
          // **token 为 null 时一个 Authorization 头都不发。**
          // 登录端点对无头请求放行，但带了坏/过期 token 一律 400000，绝不降级
          // 成匿名（docs/contracts/user.md §0）。而登录恰恰是"手上那个 token
          // 已经不能用了"的时刻 —— 顺手带上它会让重新登录这条自救路本身失败，
          // 而错误码说的是"未认证"，指的却是你正要换掉的那个 token。
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (e) {
      // fetch 自己抛 = 请求根本没发出去。它与"后端把我们拒了"是两回事，
      // 而浏览器给的文案（`Failed to fetch`）与"后端没起来"长得一模一样。
      failure = 'network';
      throw new ApiError(
        'network',
        0,
        `请求没能发出去：${e instanceof Error ? e.message : String(e)}`,
        {sentRequestID},
      );
    }

    // 响应头到手。body 还没读 —— 这两者要分开记：大回包的 body 传输时间会
    // 被算进「后端有多慢」，而它其实是网络在搬字节。
    firstByteAt = nowMs();
    status = resp.status;

    // **一律先读 text 再自己 JSON.parse。** 非 200 时 body 多半是一段 HTML
    // （nginx / vite 的错误页），`resp.json()` 会抛一个说"Unexpected token <"
    // 的解析错 —— 那句话指向的是 JSON，而真相是路由不存在。
    const text = await resp.text();

    // 恒 200 是**对外 HTTP 出口**的约定；真出了非 200（网关、代理、进程没起来、
    // 或者这个后端是没有这条路由的旧构建）说明请求根本没到 business 的信封层。
    if (resp.status !== 200) {
      failure = 'transport';
      throw new ApiError(
        'transport',
        resp.status,
        `HTTP ${resp.status} —— 请求没到 business 的信封层，检查代理、进程与这个后端有没有这条路由`,
        {sentRequestID, rawBody: text.slice(0, 300)},
      );
    }

    let env: Envelope<T>;
    try {
      env = JSON.parse(text) as Envelope<T>;
    } catch {
      failure = 'transport';
      throw new ApiError('transport', 200, '回包不是合法 JSON（大概率被中间层换成了 HTML）', {
        sentRequestID,
        rawBody: text.slice(0, 300),
      });
    }

    // 信封解出来了就记下这两个，失败路径上它们同样是线索 —— 报障时
    // 「哪个业务码、哪条 trace」正是全部的排查起点。
    code = env.code;
    traceID = env.trace_id;

    if (env.code !== 200) {
      failure = 'business';
      throw new ApiError('business', env.code, env.msg, {
        traceID: env.trace_id,
        reason: env.error,
        sentRequestID,
      });
    }
    if (env.data === undefined) {
      failure = 'business';
      throw new ApiError('business', 200, 'code=200 却没有 data —— 回包形状与契约不符', {
        traceID: env.trace_id,
        sentRequestID,
      });
    }
    ok = true;
    return env.data;
  } finally {
    // **成功和失败都报。** 只报成功的话，报告里「限流把速率压垮了」这种事
    // 会表现为样本数悄悄变少，而不是一条慢请求 —— 那是最难发现的一类失真。
    emitTiming({
      method,
      url,
      sentRequestID,
      startedAtWall,
      startedAt,
      firstByteAt,
      completedAt: nowMs(),
      status,
      code,
      traceID,
      ok,
      failure,
    });
  }
}

/**
 * `call` 的对外名字，给这个包里别的接口层用（当前是 `ximport.ts`）。
 *
 * 导出的是**带 token 的那一档**，而且 token 是必填的第一个参数：X 绑定那四条
 * 路全是 Required 档，从签名上让「忘了带 token」编译不过，比运行时回一个
 * 400000 好 —— 400000 的说明是"未认证"，看起来像登录出了问题，
 * 而真相只是这一发请求没带头。
 *
 * 登录端点那种**必须不带头**的，仍然只走本文件内部的 `call(null, …)`，
 * 不从这里出去。理由见 `call` 里那段注释。
 */
export function callWithToken<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  return call<T>(token, path, init);
}

export type Timestamp = {
  seconds: number; // Unix 秒。JS number 装得下（2^53 » 2^31）
  nanos: number;
};

/** `Timestamp` → 毫秒。排序和显示都用它，别各写各的。 */
export function timestampMs(t: Timestamp | undefined): number {
  if (!t) return 0;
  return t.seconds * 1000 + Math.floor(t.nanos / 1e6);
}

/**
 * 一行仓位的资产标识。**它是个嵌套对象**，不再是平铺的三个字段。
 *
 * `chain` 与 `chain_id` 说的是同一件事的两种写法，实测两者恒一致
 * （`bsc`↔56、`solana`↔792703809、`ethereum`↔1）。本仓一律拿 `chain_id` 去解
 * （见 `chainOfID`）：链号是结算方分配的数字，而链名是人写的字符串 ——
 * 后端哪天把 `bsc` 写成 `bnb`，认号的那条路不受影响。
 */
export type PositionAsset = {
  chain: string; // bsc | solana | ethereum | base | robinhood
  chain_id: number; // 56 = BSC，792703809 = Solana，1 = 以太坊主网
  kind: string; // erc20 | spl
  token_address: string; // 标的合约地址 / mint
};

/**
 * 一行仓位。**数据源是 `GET /v1/portfolio`，不是已经下线的 `/v1/meme/positions`。**
 *
 * # 这是一次彻底的换形，不是加字段
 *
 * 旧接口那一版的每一个字段名在这里都读不到 —— `shares` / `cost_basis` /
 * `total_buy_quote` / `total_sell_quote` / `total_realized_pnl` / `updated_at` /
 * `asset_chain_id` / `asset_kind`，以及平铺的 `asset` 字符串，全部是 `undefined`。
 * 这类错**不报错**：`p.shares` 读到 undefined，填进下单表单就是 `"undefined"`，
 * 而请求会一路发到结算方那里才失败，错误文案指向金额格式。
 *
 * # 三组数量，单位互不相同，不可相加
 *
 *   标的的最小单位：shares_raw / sellable_shares / pending_shares /
 *                   buy_amount_raw / sell_amount_raw
 *   USD 十进制（**不是最小单位，是人看的那个数**）：
 *                   cost_basis_usd / buy_value_usd / sell_value_usd /
 *                   realized_pnl_usd / market_value_usd / unrealized_pnl_usd /
 *                   total_pnl_usd / price_usd / avg_*_price_usd
 *   纯比值：pnl_ratio
 *
 * 旧接口那一版里的"计价资产最小单位"这一组**没有了**：`cost_basis` 从前是
 * USDC 的最小单位（6 位小数的整数串），现在的 `cost_basis_usd` 是 `"0.05660400"`。
 * 两者都是十进制字符串，混用不报错，只会差出 10^6 倍。
 *
 * **`*_raw` 那一组仍然不要 Number() 它**：实测见过 22 位（`shares_raw`
 * `35498383588196914774`），而 JS 的 number 只有 53 位尾数，转一次就悄悄变成
 * 另一个数。USD 那一组量级小，但也没有任何一处需要把它变成 number。
 */
export type Position = {
  asset: PositionAsset;
  /** 标的符号，如 `WBTC`。**展示用，不是身份** —— 它不唯一，也可能是空串。 */
  symbol: string;
  /** 标的精度。`shares_raw / 10^decimals` 才是人看的那个数量。 */
  decimals: number;
  // ── 下面这一组每次请求都在变，别拿它们判"仓位变了没有" ────────────────
  //
  // 实测（2026-09-16，同一份仓位连打两发 /v1/portfolio）会自行漂移的是：
  //   price_usd, price_as_of, market_value_usd, unrealized_pnl_usd,
  //   total_pnl_usd, pnl_ratio
  //
  // 它们全是**价格的函数**，而价格一直在动。把其中任何一个放进补查指纹
  // （见 positionsMark），每一跳都会判成"已看到本次成交带来的变化"——
  // 补查第一跳就收工，而那正是入账之前的那份列表。这个错不报错，日志上
  // 还会写着一句"已看到变化"。
  price_usd: string; // USD 十进制
  price_as_of: Timestamp;
  market_value_usd: string;
  unrealized_pnl_usd: string;
  total_pnl_usd: string; // = realized + unrealized
  pnl_ratio: string; // 比值，可为负，如 "-0.373942981476"
  // ── 数量三件套 ────────────────────────────────────────────────────
  //
  // **`sellable_shares` 是这次换接口真正拿到的新东西。** 旧接口只有一个
  // `shares`，而它是用户名下所有钱包的合并值 —— 拿它当"全部卖出"的量，
  // 交易会因链上余额不足而失败，且错误文案是"余额不足"，指不回真实原因
  // （旧契约 §仓位 ⑤ 明写"回包里没有任何字段能区分这两部分"）。现在有了：
  // 卖出一律用 sellable_shares。
  //
  // 实测这份样本里 pending 恒为 0、sellable === shares_raw，所以**三者相等
  // 不能当作它们是同一个字段的证据** —— 有在途卖单时才会分叉。
  shares_raw: string; // 当前持有量（含在途），标的最小单位
  pending_shares: string; // 其中被在途订单占住的量
  sellable_shares: string; // 现在真能卖的量。**填卖单用这个**
  // ── 开仓 ──────────────────────────────────────────────────────────
  //
  // `opened_at` 是**开仓时刻**，不是"最后更新时刻"。旧接口的 `updated_at`
  // 在这条回包里没有对应物 —— 按它倒序排出来的是"最近开的仓在前"，
  // 与从前那句"最近更新的排在前面"不是一回事，页面文案跟着改了。
  opened_entry_id: number; // 开仓那笔分录的 id。0 表示这仓不是下单开的（外部转入）
  opened_at: Timestamp;
  // ── 成本与累计 ────────────────────────────────────────────────────
  //
  // `cost_basis_usd` 与 `buy_value_usd` 答的是两个问题，卖出之后一个数答不了
  // 两个：前者是"还持有的这些花了多少"（卖出按比例扣减），后者是"一共投进去过
  // 多少"（卖出不减）。拿 buy_value_usd 去算持仓均价，清过仓的用户会看到一个
  // 凭空多出来的浮亏；反过来用 cost_basis_usd 展示"一共投了多少"，卖得越多这个
  // 数越小。两个字段都长得像"成本"，两种错都没有任何一处会报错。
  cost_basis_usd: string;
  buy_amount_raw: string; // 累计买入份额，标的最小单位。卖出不减
  sell_amount_raw: string; // 累计卖出份额，标的最小单位
  buy_value_usd: string; // 累计投入 USD。卖出不减
  sell_value_usd: string; // 累计卖回 USD
  realized_pnl_usd: string; // 累计已实现盈亏，可为负
  /**
   * 均价。**没卖过时 `avg_sell_price_usd` 是空串 `""`，不是 `"0"`。**
   *
   * 实测这份样本里有三行如此。空串在页面上显示成一片空白（合理），但
   * `Number("")` 是 `0`，而 `"".startsWith('-')` 是 `false` —— 任何"按正负号
   * 上色"或"算个差价"的写法都会把"从没卖过"渲染成"卖价是 0"。
   */
  avg_buy_price_usd: string;
  avg_sell_price_usd: string;
  // ── 账本状态 ──────────────────────────────────────────────────────
  //
  // 这一组是**补查指纹唯一能用的部分**（见 positionsMark）：它们只在账本
  // 真的被写过之后才变，不跟着价格动。
  //
  // `input_revision` / `applied_revision` 是这一行的修订号，成交入账后递增。
  // 实测这份样本里两者恒相等，但**不能因此只取一个**：分叉恰恰是"账本已经
  // 收到这笔、估值还没跟上"的样子，而那正是补查要等的那一刻。
  cycle_status: string; // ready | ...
  input_revision: string; // 十进制串
  applied_revision: string; // 十进制串
  valuation_status: string; // ready | ...
  cycle_key: string; // 如 `ledger:<uuid>` / `external:snap:...`
  history_epoch: string;
  /**
   * 这一行的数量是怎么来的：`ledger` = 账本推算，`verified` = 链上核对过。
   * 两者都是正常值，**不是错误状态**。
   */
  quantity_status: string;
  verified_block: string;
  /** 标的图标 URL。**可能是空串**，样本里有三行如此。 */
  logo: string;
};

/**
 * 一行仓位的稳定 key。
 *
 * **这三项就是这一行的身份。** 旧接口那一版是四项（含 `quote_chain_id` 与
 * `quote_asset`），portfolio 这条回包里**根本没有计价资产那两段** —— 照旧写
 * 会拼出 `"...:undefined:undefined"`，而那个 key 仍然唯一、仍然能渲染，
 * 于是错得悄无声息，直到哪天同一个币真的有了两种计价。
 *
 * 抽成函数而不是在 JSX 里拼，是因为这里的错**不报错**：拼错时同一个币的几行
 * 塌成同一个 key，React 那一类框架把它们认成同一行，渲染出来只剩一行。
 * 用户看到的是「我的币少了」，控制台一片安静。有了这个函数，那种塌陷就能被
 * 测试钉住。
 */
export function positionKey(p: Position): string {
  return `${p.asset.chain_id}:${p.asset.kind}:${p.asset.token_address}`;
}

/**
 * 一份仓位列表的指纹，用来回答"它变了没有"。
 *
 * # 只取账本量，一个价格字段都不碰
 *
 * 这是从旧版搬过来时**唯一必须重想的一处**。旧指纹是
 * `key@shares@updated_at`，而 portfolio 回包里没有 `updated_at`，却多了一组
 * 实时估值字段。顺手换成 `market_value_usd` 之类看起来最自然，实测却是致命的：
 * 2026-09-16 同一份仓位连打两发，`price_usd` / `market_value_usd` /
 * `unrealized_pnl_usd` / `total_pnl_usd` / `pnl_ratio` / `price_as_of` 六个字段
 * **在没有任何成交的情况下就变了**。含它们的指纹在补查第一跳就判成"变了"，
 * 于是补查停在入账之前 —— 而日志上写的是"已看到本次成交带来的变化"。
 *
 * 所以只取三样，全是账本写过才动的量：
 *
 *   · `shares_raw`        —— 量变了
 *   · `applied_revision`  —— 量恰好没变但这一行被重写过（反转、清仓再买回
 *                            同一个数），修订号还记得
 *   · `input_revision`    —— 账本已收到、估值还没跟上的那一刻。两者实测恒等，
 *                            但分叉正是补查要等的信号，只取一个就会漏掉
 *
 * # 为什么不只比行数
 *
 * **在已有的币上加仓是最常见的成交**，而它一行都不会多 —— 按行数判断的话
 * 这种成交永远判成"还没变"。
 *
 * # 顺序不排
 *
 * 实测（2026-09-16，16 行）后端按 `(chain_id, token_address)` 升序回。
 * **但这一条没有在契约里见到过白纸黑字**，与旧接口那句明写的保证不同。
 * 自己再排一遍不会更稳，只会掩盖"后端哪天不排了"这件该被发现的事 ——
 * 真不排了的症状是补查永远判成"变了"，而那一眼就看得出来。
 */
export function positionsMark(ps: Position[]): string {
  return ps
    .map((p) => `${positionKey(p)}@${p.shares_raw}@${p.applied_revision}@${p.input_revision}`)
    .join('|');
}

/**
 * 列出当前用户的全部仓位。
 *
 * **打的是 `GET /v1/portfolio`。** 旧的 `/v1/meme/positions` 已经从后端下线，
 * 打它收到的是 HTTP 404（transport 类，不是业务码）—— 这条路由不在了，
 * 而 404 的文案说的是"检查代理、进程与这个后端有没有这条路由"，指不回
 * "这个接口换了"。
 *
 * **不传任何身份参数**，查谁的仓位由 JWT 决定 —— 那个参数曾经存在，
 * 于是任何登录用户换个身份串就能读到别人的持仓（已修的越权）。
 *
 * # 这里**只取 positions，其余整条回包都丢掉**
 *
 * `/v1/portfolio` 同时回了一整套资产总览：`pnl`（d1/d7/d30/all 的数值与曲线
 * 点）、`cash_balances`（各链 USDC 余额、归集方式、是否够最小归集额）、
 * `total_value_usd` / `cash_balance_usd` / `total_assets_usd`、`completeness`
 * 与 `partial_errors`。这份 harness **有意不展示它们**（2026-09-16 定）：
 * 它要打的是下单那条链路，多摆一块资产面板只会让这一屏更难读。
 *
 * 写在这里是因为"接口没有这些数据"与"我们选择不看"在代码里长得一模一样，
 * 而下一个要做资产页的人会先来读这个函数。
 *
 * # 清仓的行不在列表里
 *
 * 旧接口会把 `shares === "0"` 的行继续留在回包里，作为"这个币一共买过多少、
 * 卖过多少、赚赔了多少"的唯一记录。实测 portfolio 这条**不留**：
 *
 *   · 2026-09-16 那份 16 行的样本里，`shares_raw` 为 0 的行数是 0；
 *   · 同一天隔几分钟再打，行数变成 15 —— 少掉的 SCRIBE 上一发还是
 *     `shares_raw = "1450844467"`（非零），这一发**整行不见了**，而不是留下
 *     一行 0。
 *
 * 第二条只能证明"行会整条消失"，证不到"因为清仓才消失"（那几分钟里这个账号
 * 上发生了什么，从回包里看不出来）。但两条合起来，页面上"已清仓"那一组多半
 * 永远是空的 —— 代码仍然分组，是因为"后端不回"与"恰好没有"在样本上分不出来，
 * 而把分组删掉的话，哪天后端开始回了就没人看得见。
 *
 * 顺带：行会整条消失这件事对补查是**安全**的。少一行 = 指纹少一段 = 判成
 * "变了"，而那正是该判的。
 */
export function listPositions(token: string): Promise<Position[]> {
  return call<{positions?: Position[]}>(token, '/v1/portfolio').then(
    // positions 为空时后端给 `[]`，但零值字段会整个消失是这套信封的常态，
    // 所以这里按"可能缺席"处理 —— 少写这个 ?? 的代价是 .map 时炸掉。
    (d) => d.positions ?? [],
  );
}

// ─────────────────────────────────────────────────────────────────────
// 登录

/** `POST /v1/auth/login` 的回包。只列本页要用的字段。 */
export type LoginReply = {
  /** 本站 JWT。后续每个 /v1 请求的 Bearer。 */
  token: string;
  user: {
    /** 本仓用户键。它同时是 Privy 那侧 custom_auth 的 custom_user_id。 */
    identifier: string;
    nickname?: string;
    privy_did?: string;
    email?: string;
  };
  /** 是不是这次调用建的号。重复登录是幂等的，第二次起为 false。 */
  is_new?: boolean;
};

/**
 * v1 只开这三种。其余枚举值（wallet / twitter / telegram / passkey）后端一律
 * 回 100107，它们是预留位。
 */
export type AuthMethod = 'AUTH_METHOD_EMAIL' | 'AUTH_METHOD_GOOGLE' | 'AUTH_METHOD_APPLE';

/** Privy `linkedAccounts` 里的 type ↔ 我们的 auth_method。判 100107 用它。 */
export const AUTH_METHOD_PRIVY_TYPE: Record<AuthMethod, string> = {
  AUTH_METHOD_EMAIL: 'email',
  AUTH_METHOD_GOOGLE: 'google_oauth',
  AUTH_METHOD_APPLE: 'apple_oauth',
};

/**
 * 用 Privy 的 identity token 换本站 JWT。**登录 = 注册**，可重复调。
 *
 * # auth_method 是参数，不是常量（2026-09-03 改）
 *
 * 它从前写死成 `AUTH_METHOD_EMAIL`，理由是 `main.tsx` 把 `loginMethods` 锁成
 * 了 `['email']`。现在页面同时提供邮箱验证码与 Google / Apple 两条路
 * （照 `../privy-login-demo`），写死的那个常量就成了一个**会静默说谎的值**：
 * 用 Google 登进来的人拿着一个只有 `google_oauth` 的 identity token，却声称
 * 自己是 email 登的 —— 契约要求 auth_method **必须与 identity token 里真实
 * 存在的绑定一致**，不一致回 100107。
 *
 * 所以调用方必须传它，而且要传**这次实际用的那种**。页面上那三个按钮各自
 * 对照 `linkedAccounts` 标出"未绑定"，就是为了让填错这件事在点之前就看得见。
 *
 * # 它没有 Authorization 头
 *
 * 见 call 里那段注释：带上一个过期 token 会让重新登录本身失败。
 */
export function login(authMethod: AuthMethod, identityToken: string): Promise<LoginReply> {
  return call<LoginReply>(null, '/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      auth_channel: 'AUTH_CHANNEL_PRIVY',
      auth_method: authMethod,
      identity_token: identityToken,
    }),
  });
}

/** `GET /v1/user/info` 的回包。 */
export type UserInfo = {
  identifier: string;
  nickname?: string;
  avatar_url?: string;
  language?: string;
  /**
   * Unix 秒。契约文档说是数字，但 protojson 有把 int64 编成字符串的先例，
   * 所以两种都要能吃 —— 显示时统一 `Number()`。
   */
  created_at?: number | string;
};

/**
 * `GET /v1/user/info` —— 需要本站 JWT。
 *
 * 这个页面用它做**登录的验收**：回包里的 `identifier` 必须与
 * `/v1/auth/login` 交出来的那个逐字符一致。三者（本站 JWT 的用户键、
 * Privy custom_auth 的 custom_user_id、business 的 subjectIdentifier）是同一个
 * 串，中间没有任何翻译 —— 对不上的症状是"钱包查不到"或"仓位是空的"，
 * 而没有一处会报错。所以这一步的产出物就是那个"一致 / 不一致"。
 */
export function getUserInfo(token: string): Promise<UserInfo> {
  return call<UserInfo>(token, '/v1/user/info');
}

/**
 * 探针：**不带任何凭据**打 `/v1/user/info`。
 *
 * 期望是**失败**（400000 / `SYS_UNAUTHENTICATED`）。拿到它就证明了三件事：
 * 代理通了、信封层活着、这个后端认得这条路由。所以调用方要把
 * `ApiError(business, 400000)` 当成**成功**来解读（见 `selfcheck.ts`）。
 */
export function probeUnauthenticated(): Promise<UserInfo> {
  return call<UserInfo>(null, '/v1/user/info');
}

/**
 * 探针：用一个必然无效的 identity_token 打登录端点。
 *
 * 期望 100108 或 400100（业务拒绝）。**若拿到 HTTP 404，说明这个后端是旧
 * 构建、根本没有 `/v1/auth/login` 路由** —— 这是区分新旧构建唯一的廉价办法。
 */
export function probeLoginRoute(): Promise<LoginReply> {
  return login('AUTH_METHOD_EMAIL', 'x');
}

// ─────────────────────────────────────────────────────────────────────
// 行情面：榜单
//
// 这是压测脚本选标的的**唯一**数据源，所以它跟下单那几条路一样住在这份契约里。
//
// # 后端给不了「按链拉 token 并带活跃度指标」
//
// 只有五个榜，每个至多 100 条，而且是**跨链混合的聚合榜、没有链变体** ——
// `chain` 查询参数已废弃，带任何值回 100303。也没有任何排序或过滤参数，
// 排序是每个榜写死的。所以「每链 100 个不同活跃度的币」这件事，只能靠
// 拉全五个榜、合并去重、自己按链切分和分档（见 `universe.ts`）。
// ─────────────────────────────────────────────────────────────────────

/** 五个榜。**没有第六个**，也没有按链的变体。 */
export const BOARDS = ['trending', 'bonding', 'graduated', 'crypto', 'most_held'] as const;
export type Board = (typeof BOARDS)[number];

/**
 * 榜单条目。榜单、单币行情、WS 推送**共用同一个形状**。
 *
 * 数值类型照实测来：金额与成交量是 number，供应量是字符串（会超 float64），
 * `created_at` 是**字符串**的 Unix 秒而 `updated_at` 是**数字**的毫秒 ——
 * 这两个不一致是后端那侧的现状，不是这里写错了。
 */
export type TokenMarket = {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logo?: string;
  price: number;
  market_cap: number;
  market_cap_diluted: number;
  /** 池子深度（USD）。选标的时的硬门槛读它 —— 流动性接近零的死盘下单只会回错误码。 */
  liquidity: number;
  total_supply: string;
  circulating_supply: string;
  volume_1h: number;
  /**
   * 24 小时成交额（USD）。活跃度分档的依据。
   *
   * **是未经清洗的原始值，不做刷量过滤**（契约里明写的）。也就是说高档里
   * 混着刷出来的量，这是这份名单的已知局限，要写进产物的说明里。
   */
  volume_24h: number;
  price_change_5min: number;
  price_change_1h: number;
  price_change_24h: number;
  trades_1h: number;
  trades_24h: number;
  buyers_24h: number;
  holders_count: number;
  bonded: boolean;
  bonding_percentage: number;
  /** **恒为 0，没有这项数据。** 契约明写不要展示，也不要拿来筛。 */
  security_score: number;
  /** Unix 秒，**字符串**。契约说它的格式不进契约，别照着它算时间差。 */
  created_at?: string;
  /** Unix 毫秒，数字。判数据新鲜度用它。 */
  updated_at: number;
  launchpad?: string;
  launchpad_name?: string;
  launchpad_logo?: string;
  /** 只有 most_held 榜有。 */
  held_by_accounts?: number;
  held_value_usd?: number;
};

/**
 * 拉一个榜。
 *
 * 鉴权**可选**（行情面与交易面不同），所以 token 允许为 null。但注意：
 * 给一个坏 token 不会降级成匿名，一律回 400000 —— 也就是说"带着过期 token
 * 去拉榜"会失败，而失败文案说的是"未认证"，看起来像登录出了问题。
 * 不确定手上的 token 还有没有效时，宁可传 null。
 */
export function listBoard(token: string | null, board: Board): Promise<TokenMarket[]> {
  return call<{items?: TokenMarket[]}>(token, `/v1/boards/${board}`).then(
    // 零值字段整个消失是这套信封的常态，空榜时 items 可能缺席。
    // 但**空榜与拉不到是两回事**，这里只负责不炸，判读在调用方。
    (d) => d.items ?? [],
  );
}

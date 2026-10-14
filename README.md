# FOMO Frontend PoC

Proof-of-concept Next.js frontend that reproduces FOMO's (https://fomo.family) token
discovery experience against the SmartX market API (see
`smartx-backend/docs/api/market.md`), integrated **directly from the frontend** —
HTTP for snapshots/detail tabs, WebSocket for real-time boards and token headers.
No BFF / own-backend proxy layer.

## Data strategy (per market.md §5)

- **Discover page** — WS only: `subscribe board:{trending|new|bonding|bonded}` returns a
  snapshot, then `update`/`remove` deltas are merged client-side (seq-gap → resubscribe).
  The HTTP `/v1/boards/{board}` endpoint is used only as SSR first-paint fallback.
- **Token detail page** — HTTP for market snapshot + OHLCV / trades / holders tabs
  (SWR polling; the server caches 5–15s), plus a `token:{chain}:{address}` WS
  subscription keeping the header and overview stats live.

## Structure

- `docs/` — earlier Mobula-era API research notes (historical)
- `app/` — Next.js App Router project
  - `src/lib/market.ts` — SmartX HTTP client (envelope/`code` handling, normalizers)
  - `src/lib/ws.ts` — shared WebSocket manager + `useBoardStream` / `useTokenLive` hooks
    (snapshot/update/remove merge, seq-gap resubscribe, stream-reset resubscribe,
    exponential-backoff reconnect)
  - `src/lib/types.ts` — API types (`TokenMarket`, trades, holders, WS frames)
  - `src/app/page.tsx` — token discovery boards (Trending / New / Bonding / Bonded)
  - `src/app/token/[chain]/[address]/page.tsx` — token detail page

### 账户域（user / invite / settings / onboarding / x-import，`src/api/*`）

对接 `smartx-backend/docs/contracts/` 的账户模块，全部走 `src/api/envelope.ts`
的统一信封客户端（恒 200、成败看 `body.code`、`trace_id` 报障）：

- `src/api/user.ts` + `auth.ts` — 登录（含邀请码/入场码带码重调）、注册前探针、
  username/nickname/language、用户名可用性预检、注销
- `src/api/invite.ts` — 准入状态机（`/v1/invite/status`）、默认邀请人、码校验、
  邀请页信息、被邀请人分页、兜底 bind
- `src/api/settings.ts` — 设置中心四页（Trading / Security / Notifications /
  Preferences）+ Profile 聚合、头像预设与历史、简介、从 X 导入
- `src/api/onboarding.ts` — 引导判定（服务端定顺序，取首个 `should_prompt`）
- `src/api/ximport.ts` — X 绑定双通道（官方 OAuth + Privy 通道）、关注导入进度

对应页面：`/login`（登录联调台，含 430115/430117 准入码门）、`/onboarding`（引导）、
`/invite`（邀请）、`/settings`（总页）与 `/settings/{profile,security,notifications,
trading,preferences}`。每个 API 模块带同目录 `*.test.ts`（vitest，mock 信封层）。

## Testing

```bash
cd app
npm test   # vitest：契约形状、请求体、本地校验规则（106 用例）
```

测试环境登录（`https://sm-test-api.smartx.io`，Privy appId 须与后端
`configs/business.yaml` 一致）：FE 专用测试用户 identifier
`15584a35ba7e4ac201963b9d7a81a3db`（部署机上 `INSERT`，勿删）；无 OTP 环境下
用部署机 `keys/jwt_rs256.pem` 按 `{"identifier":…}` claim 铸造 RS256 JWT 注入
localStorage（键 `smartx-login-fe.jwt` 等）即可测全部登录态页面。

## Running

```bash
cd app
npm install
cp .env.example .env.local   # adjust the backend address if it changed
npm run dev
```

`NEXT_PUBLIC_MARKET_API_BASE` / `NEXT_PUBLIC_MARKET_WS_URL` point at the SmartX test
environment by default. The test address changes over time — keep it in `.env.local`,
never hardcoded.

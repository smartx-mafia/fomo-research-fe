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

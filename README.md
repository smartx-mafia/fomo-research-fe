# FOMO Frontend PoC

Proof-of-concept Next.js frontend that reproduces FOMO's (https://fomo.family) token
discovery experience using the Mobula API (https://docs.mobula.io/data-introduction),
proxied through Next.js server routes to avoid browser CORS and keep API keys server-side.

## Structure

- `docs/` — API research notes and implementation plan
  - `fomo_token_list_research.md` — Mobula `/pulse` endpoint research (list/discovery)
  - `mobula_token_detail_api.md` — Mobula token-detail endpoints research
  - `fomo_fe_poc_plan.md` — PoC implementation plan
- `app/` — Next.js 15 App Router project
  - `src/lib/mobula.ts` — server-only Mobula fetch wrapper (base URL, key, caching)
  - `src/app/api/mobula/[...path]/route.ts` — BFF passthrough route (browser talks only to this)
  - `src/app/page.tsx` — token discovery list (Trending / New / Bonding / Bonded)
  - `src/app/token/[chain]/[address]/page.tsx` — token detail page

## Running

```bash
cd app
npm install
npm run dev
```

Uses Mobula's `demo-api.mobula.io` by default (no API key required, rate-limited).
Configure `app/.env.local` with `MOBULA_API_HOST`/`MOBULA_API_KEY` to point at production.

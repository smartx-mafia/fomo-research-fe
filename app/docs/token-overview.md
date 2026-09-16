# Token Overview frontend

Implemented on 2026-09-09 in the existing token detail page, updated on 2026-09-15 for the Codex risk and board-stream contract, and updated on 2026-09-16 with the Token Risk V2 frontend compatibility layer. Overview is the default detail section, above the unchanged Trade panel; Trades and Holders remain available on explicit selection. The existing live statistics card is titled “Market stats”.

## Data boundary

The new section uses only `GET /v1/tokens/{chain}/{address}/overview` on the configured market API host. The backend consumer contract is `smartx-backend/docs/contracts/market-overview.md`.

| UI | Field / meaning |
|---|---|
| Website, X / Twitter, Telegram | `profile.website`, `profile.twitter`, `profile.telegram`; HTTP(S)-only external links, hidden when unavailable |
| About | `profile.description`; bounded untrusted text rendered as text, never source HTML |
| Volume · 5m | `activity.volume_5m_usd`; total buy + sell USD volume, source-pair scope |
| Buyers / Sellers · 1h | `activity.buyers_1h`, `activity.sellers_1h`; distinct addresses, not trade counts |
| Holder intelligence | `holder_intelligence.dev_held_percent`, Sniper/Insider/Bundler/Suspicious counts and held percentages; Suspicious is Codex's deduplicated value, not a client-side sum |
| Top 10 holders | `holder_intelligence.top10_percent`; direct Codex `filterTokens` value, already 0–100 and not multiplied again. The legacy `holder_summary` value is not substituted or merged in this UI |
| Token risk | One normalized `TokenRisk`: nullable `resultIsScam` / `tokenIsScam`, bounded `potentialScamReasons`, derived or canonical `level`, and `quality`; explicit scam takes visual priority over potential-risk reasons |
| Contract status | Mint/Freeze authority plus validity, and nullable B20 current pause states. B20 values describe “Currently paused”, not pausable capability |
| Trading route | Explicit `display_only` label only; not a quote, execution route, or default Jupiter assertion |
| Contract | Current route token address, with copy action |

Unknown/invalid numbers remain null and render as `—`; reported zero renders as `0` or `$0`, and explicit false remains false. Source, version, quality and original observation time gate displayed data. Profile, activity, holder intelligence, risk and contract status older than 60 seconds are marked “Older snapshot”; all cached groups expire at 300 seconds, including during refresh failures. Missing v1 groups from an older backend normalize to unavailable instead of throwing.

Risk display is not a safety certification. `NO_FLAG_REPORTED` and explicit `false` with no reasons produce no “safe” badge, and null means unknown rather than false. Known Codex potential-risk identifiers receive bounded user-facing text; unknown identifiers use a generic fallback. Authority absence is described only when the corresponding validity field is true. A false or missing validity field never becomes a “no authority” claim.

No ATH/ATL, honeypot, tax, source-verification, community-verification, unsupported window selectors or placeholder facts are introduced. Those fields are not available in this version's existing data contract.

There is no fallback to holders, bars, market warmup, token lookup or trading endpoints inside Overview. The expanded fields arrive in the same `/overview` response and add no frontend request, Codex request, waterfall or changed SWR key. The existing page's market snapshot, live stream, chart and trading controls remain unchanged. Selecting the pre-existing Holders/Trades sections retains their existing behavior.

## Token Risk V2 compatibility and board-stream boundary

The frontend has one `TokenRisk` type and one `normalizeTokenRisk` boundary. Normalized consumers use camel-case fields and never read transitional flat fields directly. The migration priority is strict:

1. A canonical nested `risk` object wins when present. It is never merged with flat facts from the same row. Its quality is usable only when `source=codex.filterTokens`, `definitionVersion` is `overview-v1` or `token-risk-v2`, state is `AVAILABLE`/`PARTIAL`, freshness is `FRESH`/`STALE`, and `observedAtMs` is valid; any unknown or missing member downgrades quality to `UNAVAILABLE`.
2. If nested `risk` is absent on `TokenMarket` or `SearchTokenMarket`, adapt the rollout fields `result_is_scam`, `token_is_scam`, `potential_scam_reasons`, and `risk_observed`. The adapter uses `updated_at` as `quality.observedAtMs` and `codex.filterTokens` as `quality.source`.
3. If neither representation exists, return `level=UNKNOWN` with `quality.state=UNAVAILABLE`, nullable booleans, and an empty reason list. Missing risk is never interpreted as false or safe.

The normalized shape preserves literal `null`, `false`, and `true`. `SCAM` wins when either scam fact is true, a non-empty bounded reason list yields `POTENTIAL`, and an observed record with no flags yields `NO_FLAG_REPORTED`. A canonical `level=POTENTIAL` still renders fixed generic Potential-warning copy when every supplied reason is rejected by identifier safety validation. `NO_FLAG_REPORTED` means only that no supplied flag was reported; it is not SmartX verification or a safety certificate.

| Surface | Migration input | Frontend contract |
|---|---|---|
| `GET /v1/tokens/{chain}/{address}/overview` | Existing nested Overview risk, then future canonical nested risk | Normalize into the shared `TokenRisk`; Overview has no second risk model |
| `GET /v1/tokens/{chain}/{address}/market` and `GET /v1/boards/{board}` | Prefer `TokenMarket.risk`; otherwise use the four flat rollout fields | Every normalized `TokenMarket` carries `risk`, including `UNKNOWN + UNAVAILABLE` on old backends |
| WS `board:{trending\|bonding\|graduated\|crypto\|most_held}` and `token:*` | Same `TokenMarket` migration rule as HTTP | `snapshot` and `update` normalize and merge backend risk; `remove` remains chain/address only |
| `GET /v1/search?scope=SEARCH_SCOPE_TOKEN` | `SearchTokenResult.market` is the full `TokenMarket` mirror | Read only `row.market.risk` with the same flat fallback. There is deliberately no result-level `risk` copy, and normalized market identity always comes from outer `row.chain` / `row.address`, never conflicting or empty inner fields |
| `GET /v1/tokens/{chain}/{address}` | Canonical `risk` beside static `info` and existing `personal` | `getToken` returns `{info, personal, risk}` and accepts an optional bearer; omission stays anonymous. `personal.is_favorited` is boolean and `personal.position_amount` remains an exact smallest-unit string. The existing anonymous `getTokenInfo(chain, address, signal?)` signature still returns only static info |
| `POST /v1/tokens/metadata` | Canonical per-result `risk` beside `info` and `personal` | Every normalized result accepts risk and preserves the same personal fields; an older response maps risk to `UNKNOWN + UNAVAILABLE` without failing the batch |
| Watchlist | `FavoriteItem.market` when present | Normalize its `TokenMarket` risk and keep every item visible; a missing market remains an honest no-quote row |

The backend order is:

```text
Codex filterTokens
  -> includeScams=false + potentialScam=false for dynamic-board candidate queries
  -> local scam/potential-scam gate
  -> Redis board snapshot and diff
  -> HTTP board and WebSocket snapshot/update/remove
```

For `Trending`, the browser subscribes with:

```json
{"op":"subscribe","topic":"board:trending"}
```

The client does not run a second risk filter. `useBoardStream` replaces local membership on `snapshot`, merges the complete normalized `TokenMarket` (including `risk`) on `update` by normalized `chain + address`, and removes matching members on `remove`. It does not hide a row because its payload says `SCAM` or `POTENTIAL`; board membership remains the backend gate's responsibility. If a listed token later becomes ineligible, it disappears after the next successful backend board rebuild and the stream publishes the resulting `remove`; a WebSocket reconnect or sequence gap is recovered by requesting a new snapshot.

Risk qualification currently behaves as follows:

- either raw scam field explicitly `true` excludes the token from recommendation boards;
- a non-empty `potential_scam_reasons` list excludes the token;
- unobserved `null/null/[]` remains `UNKNOWN`, while `risk_observed=true` with the same raw values becomes `NO_FLAG_REPORTED`; neither state is a safety certification;
- the detail, exact search, watchlist and existing-holding paths remain visible even when the token is excluded from recommendation boards;
- recommendation removal does not by itself disable Buy or Sell. Trading policy is a separate backend decision.

Frontend implications:

- use only `normalizeTokenRisk`; do not reinterpret scam booleans, reasons or level in individual components;
- prefer nested `risk`, retain the documented flat fallback through gray rollout and rollback, and do not merge the two representations;
- fail canonical quality closed when source, version, state, freshness or observation time is not in the approved vocabulary;
- never copy Overview risk into a market or WS row; each response is normalized only from risk evidence carried by that response;
- do not hide exact search results, watchlist items or holdings merely because the recommendation stream omitted them;
- treat `risk.quality.state=AVAILABLE` and `NO_FLAG_REPORTED` as “the fields were observed”, not “the token is safe”; explicit `false` is also not a SmartX verification;
- keep unknown reason identifiers bounded and render the generic risk copy rather than exposing arbitrary supplier text.

## Request lifecycle

- SWR caches by normalized `chain + address` and does not reuse previous-token data.
- Only in-flight work is shared by a reference-counted request helper; the last consumer's departure cancels it. A same-turn StrictMode remount does not abort another consumer's request.
- Normal refresh is 27–33 seconds with jitter, only when Overview is mounted and the document is visible. Hiding, navigating away or changing token cancels outstanding work; late responses are ignored.
- Transient errors retry every 60–66 seconds while visible, returning to normal refresh on success. Authentication, unsupported API and invalid token-reference business errors are not automatically retried. There are no additional upstream queries behind this endpoint.
- A separate local 1-second clock expires displayed snapshots; it does not issue network requests or reset the refresh timer.

## Verification

- Initial implementation verification: 21 files / 144 tests passed, including 10 mounted React StrictMode + real SWR lifecycle cases. Both token-keyed remounts and same-instance token changes are covered. Publication is integrated onto `origin/main=90edb6a`; its existing `jsdom` test environment is reused, without adding another dependency or changing dependency locks.
- `pnpm build`, `pnpm exec tsc --noEmit`, and `git diff --check` passed. Build and standalone typecheck are run sequentially because Next generates `.next/types`.
- A deliberate temporary reintroduction of the unstable polling function made the 31-second lifecycle test fail (expected 2 requests, got 1); restored the correct code and reran the suite.
- Cancellation settles the shared Promise immediately even if its transport never ends. Removing this race made the direct cancellation test fail (`pending` instead of `AbortError`); restored the correct code. Independent review also reproduced and verified the token-keyed A → B → A case without a browser or external requests; Critical/Important issues are closed.
- Browser QA used the existing local dev server with the real test API: website/X and changing activity values rendered; missing Top10 and unconfigured route showed `—`. Desktop and 390px mobile layouts were checked. The new section does not trigger Holders or Trades on initial mount. No trade submission or wallet action was performed.
- Top10 with data, configured route text, zero/null, expiry, failures and cancellation are covered by controlled tests; the real browser sample did not have cached Top10 or a configured route.
- Non-blocking tooling notices: existing peer/deprecation and ignored external `yarn.lock` warnings; DOM visibility tests produce a Node `TimeoutNaNWarning` from SWR's global focus event timer binding (Event passed as delay), not an Overview retry delay. Tests pass without suppressing this notice.
- Historical V1 rollout verification used one risk sample end to end: the token remained available through unified exact search and `/overview`, while both HTTP Trending and a real `board:trending` WebSocket snapshot excluded it. At that time the WS shape did not expose risk. The 2026-09-16 compatibility layer supersedes only that payload-shape statement: current flat risk fields and future nested `risk` are normalized when the backend carries them, while board membership remains backend-owned. Supplier reasons are time-varying evidence, so fixtures—not a permanently labelled address—own deterministic regression coverage.
- Token Risk V2 compatibility verification on 2026-09-16 used Node 24.19.0 and pnpm 11.19.0 from the bundled runtime. Frozen install passed; after the independent-review fixes, 67 test files / 425 tests passed and the existing environment-dependent smoke file remained skipped; `next typegen` plus standalone `tsc --noEmit` passed; the production build generated 23/23 static pages. Existing non-blocking warnings remain: the SWR-related `TimeoutNaNWarning` in tests and the static-export rewrite warning in Next build.

Source publication was authorized separately after local verification. The current main branch's Cloudflare static export, token shell route, redirects and other features are preserved. Frontend deployment is a separate step and is not manually performed by this commit/push workflow.

## Publication integration (2026-09-09)

- Integrated the reviewed Overview application code onto `90edb6a` in an isolated worktree, preserving the five intervening upstream commits and the original local preview. Reused upstream's jsdom for the lifecycle tests; package manifests and both lockfiles are unchanged from main.
- `pnpm install --frozen-lockfile` and the full suite passed: 26 files / 176 tests, including the newer account-domain tests.
- Production static export passed for all 20 generated pages, including the `/token` shell. Exported `out/_redirects` matches the tracked file; route/config files are unchanged. This is build verification, not a claim that Cloudflare hosting was manually deployed or tested.
- The first isolated build without public Privy configuration failed in the upstream `OnboardingView` hook. Rebuilding with the existing local `NEXT_PUBLIC_PRIVY_APP_ID` and optional public client ID passed. No environment file or secret was copied or committed; hosting still needs its normal public Privy build configuration.
- Standalone TypeScript validation and whitespace checks passed. Independent integration review found no remaining Critical/Important/Minor issues. The documented SWR test-environment timer warning remains non-blocking.

# Token Overview frontend

Implemented on 2026-09-09 in the existing token detail page. Overview is the default detail section, above the unchanged Trade panel; Trades and Holders remain available on explicit selection. The existing live statistics card is titled “Market stats”.

## Data boundary

The new section uses only `GET /v1/tokens/{chain}/{address}/overview` on the configured market API host. The backend consumer contract is `smartx-backend/docs/contracts/market-overview.md`.

| UI | Field / meaning |
|---|---|
| Website, X / Twitter | `profile.website`, `profile.twitter`; safe external links, hidden when unavailable |
| Volume · 5m | `activity.volume_5m_usd`; total buy + sell USD volume, source-pair scope |
| Buyers / Sellers · 1h | `activity.buyers_1h`, `activity.sellers_1h`; distinct addresses, not trade counts |
| Top 10 holders | `holder_summary.top10_percent`; already 0–100, not multiplied again |
| Trading route | Explicit `display_only` label only; not a quote, execution route, or default Jupiter assertion |
| Contract | Current route token address, with copy action |

Unknown/invalid numbers remain null and render as `—`; reported zero renders as `0` or `$0`. Source, version, quality and original observation time gate displayed data. Profile/activity older than 60 seconds are marked “Older snapshot”; all cached metric groups expire at 300 seconds, including during refresh failures. Holder summaries remain usable for less than 300 seconds. No ATH/ATL, risk labels, taxes, unsupported window selectors or placeholder facts are introduced.

There is no fallback to holders, bars, market warmup, token lookup or trading endpoints inside Overview. The existing page's market snapshot, live stream and chart remain unchanged. Selecting the pre-existing Holders/Trades sections retains their existing behavior.

## Request lifecycle

- SWR caches by normalized `chain + address` and does not reuse previous-token data.
- Only in-flight work is shared by a reference-counted request helper; the last consumer's departure cancels it. A same-turn StrictMode remount does not abort another consumer's request.
- Normal refresh is 27–33 seconds with jitter, only when Overview is mounted and the document is visible. Hiding, navigating away or changing token cancels outstanding work; late responses are ignored.
- Transient errors retry every 60–66 seconds while visible, returning to normal refresh on success. Authentication, unsupported API and invalid token-reference business errors are not automatically retried. There are no additional upstream queries behind this endpoint.
- A separate local 1-second clock expires displayed snapshots; it does not issue network requests or reset the refresh timer.

## Verification

- Full Vitest suite: 21 files / 144 tests passed, including 10 mounted React StrictMode + real SWR lifecycle cases. Both token-keyed remounts and same-instance token changes are covered. `happy-dom` is a pinned test-only dependency.
- `pnpm build`, `pnpm exec tsc --noEmit`, and `git diff --check` passed. Build and standalone typecheck are run sequentially because Next generates `.next/types`.
- A deliberate temporary reintroduction of the unstable polling function made the 31-second lifecycle test fail (expected 2 requests, got 1); restored the correct code and reran the suite.
- Cancellation settles the shared Promise immediately even if its transport never ends. Removing this race made the direct cancellation test fail (`pending` instead of `AbortError`); restored the correct code. Independent review also reproduced and verified the token-keyed A → B → A case without a browser or external requests; Critical/Important issues are closed.
- Browser QA used the existing local dev server with the real test API: website/X and changing activity values rendered; missing Top10 and unconfigured route showed `—`. Desktop and 390px mobile layouts were checked. The new section does not trigger Holders or Trades on initial mount. No trade submission or wallet action was performed.
- Top10 with data, configured route text, zero/null, expiry, failures and cancellation are covered by controlled tests; the real browser sample did not have cached Top10 or a configured route.
- Non-blocking tooling notices: existing peer/deprecation and ignored external `yarn.lock` warnings; DOM visibility tests produce a Node `TimeoutNaNWarning` from SWR's global focus event timer binding (Event passed as delay), not an Overview retry delay. Tests pass without suppressing this notice.

Source publication was authorized separately after local verification. Frontend deployment is a separate step and is not performed by this commit/push workflow.

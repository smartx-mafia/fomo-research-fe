# Portfolio unified user API migration

2026-09-13: the Portfolio page uses `/v1/users/{user_identifier}/portfolio` with the signed-in platform identifier, never a wallet address or handle.

## Requests

- Overview supplies positions, cash routes, PnL and all four balance curves. Manual overview refresh sends `force_refresh=true` for cash; automatic revalidation keeps the normal cache policy.
- Closed history uses `/closed?limit=20&cursor=...`; cursors are opaque. Rows retain `cycle_key`, history epoch and completeness. Zero legacy entry IDs do not invalidate a cycle with a real key.
- Cycle detail uses `/position?chain=...&asset=...&cycle_key=...`. It returns the selected position and all successful trades, without frontend pagination. Mismatched identity, duplicate trades and oversized results fail visibly.
- Global trades use `/trades?before_id=...&limit=50`. Integer cursors remain strings without Number conversion. Execution prices and total fees are displayed from server values, never reconstructed from fees.
- Portfolio balances and PnL share the overview request. The removed `/v1/portfolio/balance/curve` is no longer called. Charts support independent PnL and absolute Total assets views; unavailable current values do not erase history.

## Identity and quality

SWR keys include user identity and authentication context. Closed pagination and selected cycles reset when the account or history epoch changes. A missing user identifier is shown as an identity error rather than issuing an ambiguous request. Optional-auth endpoints still reject invalid JWTs; a rejected active session is cleared.

`shares_raw` includes pending settlement. The table displays pending shares and `sellable_shares` separately; neither grants execution authorization. Missing precision is distinct from zero decimals. Incomplete quantities cannot be presented as a confirmed empty account. Cash read errors leave cash and total assets unavailable while independent holdings remain visible.

Market data refresh uses bounded concurrency every 30 seconds, not Portfolio polling. Only quotes newer than `price_as_of` revalue open positions, total holdings and assets. Exact decimal arithmetic preserves quantities/costs; PnL and Balance current values update while all historical curve points, cumulative buy/sell values and realized PnL stay unchanged. Failed quotes retain the last available valuation. Server-provided stablecoin fallback prices are preserved until a newer actual quote arrives.

## Existing execution consumers

Deposit still uses the existing authenticated `/v1/portfolio` helper for its cash discovery and recovery workflow. The old `/v1/portfolio/holding` capability has no unified replacement and is retained. Transfers, trades, withdrawals and sweep keep their existing authentication and execution checks.

## Verification

Coverage includes unified paths and user identity, opaque/integer cursors, cycles with zero legacy IDs, response identity checks, settlement shares, balance windows, precision, missing values, account changes, cycle navigation, and live revaluation without historical mutation.

# Portfolio unified user API migration

2026-09-13: the Portfolio page uses `/v1/users/{user_identifier}/portfolio` with the signed-in platform identifier, never a wallet address or handle.

## Requests

- Overview supplies positions, cash routes, PnL and all four balance curves. Manual overview refresh sends `force_refresh=true` for cash; automatic revalidation keeps the normal cache policy.
- Closed history uses `/closed?limit=20&cursor=...`; cursors are opaque. Rows retain `cycle_key`, history epoch and completeness. Zero legacy entry IDs do not invalidate a cycle with a real key.
- Cycle detail uses `/position?chain=...&asset=...&cycle_key=...`. It returns the selected position and all successful trades, without frontend pagination. Mismatched identity, duplicate trades and oversized results fail visibly.
- Global trades use `/trades?before_id=...&limit=50`. Integer cursors remain strings without Number conversion. Execution prices and total fees are displayed from server values, never reconstructed from fees.
- Portfolio balances and PnL share the overview request. The removed `/v1/portfolio/balance/curve` is no longer called. The chart draws only PnL; Total assets is displayed as a numeric field for the selected time, without a separate curve or metric switch. Unavailable current values do not erase PnL history.

## Identity and quality

SWR keys include user identity and authentication context. Closed pagination and selected cycles reset when the account or history epoch changes. A missing user identifier is shown as an identity error rather than issuing an ambiguous request. Optional-auth endpoints still reject invalid JWTs; a rejected active session is cleared.

`shares_raw` includes pending settlement. The table displays pending shares and `sellable_shares` separately; neither grants execution authorization. Missing precision is distinct from zero decimals. Incomplete quantities cannot be presented as a confirmed empty account. Cash read errors leave cash and total assets unavailable while independent holdings remain visible.

Market data refresh uses bounded concurrency every 30 seconds, not Portfolio polling. Only quotes newer than `price_as_of` revalue open positions, total holdings and assets. Exact decimal arithmetic preserves quantities/costs; PnL and Balance current values update while all historical curve points, cumulative buy/sell values and realized PnL stay unchanged. Failed quotes retain the last available valuation. Server-provided stablecoin fallback prices are preserved until a newer actual quote arrives.

## Existing execution consumers

Deposit still uses the existing authenticated `/v1/portfolio` helper for its cash discovery and recovery workflow. The old `/v1/portfolio/holding` capability has no unified replacement and is retained. Transfers, trades, withdrawals and sweep keep their existing authentication and execution checks.

## Verification

Coverage includes unified paths and user identity, opaque/integer cursors, cycles with zero legacy IDs, response identity checks, settlement shares, balance windows, precision, missing values, account changes, cycle navigation, and live revaluation without historical mutation.

## Profile images (2026-10-13)

The Portfolio profile header loads `/v1/profile` independently of holdings. Its image editor uses the backend `profile-media.md` contract: each purpose (`avatar` / `background`) has separate quota, upload operation, application and history requests. `upload_enabled` controls new uploads; available historical assets can still be applied when new uploads are disabled. Public user profiles display the same `background_url` at 3:1.

Selection decodes locally before cropping, without frontend file-size, format, signature, or minimum-pixel restrictions. Browser decode failures are still reported. The crop preview supports zoom and horizontal/vertical placement; a numeric zoom input has no fixed upper bound. Small source crops are upscaled. PNG exports remain 512×512 for avatars and 1500×500 for backgrounds, including a still frame when the browser decodes an animated source. The backend validates the uploaded result and performs moderation. A multipart upload contains only `file`, with a browser-generated boundary and a stable `Idempotency-Key`.

Uploading for review does not apply the picture. Save applies ready changes sequentially, records each completed purpose, updates shared user information, and shows one success notification only after all selected changes succeed. Failed changes remain editable. A timed-out application is checked against current user information before the same asset is retried. No background removal API is exposed. X import warns that a nonempty X avatar replaces the current custom avatar.

Upload timeouts recover by querying the original operation. Pending recovery makes at most eight status requests, spaced by 2.5 seconds after each completed query, with a 25-second timeout per request; users can explicitly check again. Technical failures require a new operation and at least 30 seconds before another attempt. Missing operations can replay the same in-memory file and key. Operation locators and observed failure times are stored per backend/user/purpose, without tokens or image bytes. Closing the dialog preserves drafts while the page remains mounted; after navigation or reload, the operation can be queried again, but original local files and unsent crop edits are not persisted.

Tests cover multipart encoding, small and large source selection, high-zoom crop upscaling, decode failures, pending/rejected/failed/noop handling, timeout recovery, same-key replay, partial saving, session lifecycle, shared profile updates, history with uploads disabled, and editor draft retention. Real supplier review, R2 publication, browser CORS and deployed quota behavior still need acceptance against an enabled backend with a test account.

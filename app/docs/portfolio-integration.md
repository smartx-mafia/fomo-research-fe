# Portfolio progressive user API integration

2026-10-26: `PortfolioView` and `UserProfileView.PositionsTab` share `ProgressivePortfolio` and `useProgressivePortfolio`. Both use the target platform identifier, never a wallet address or handle.

## Requests and lifecycle

- Four optional-auth GET endpoints under `/v1/users/{identifier}/portfolio`: `history-curves`, `cash`, `positions`, `current`. All start independently with one UUID `read_id` and frozen `force_refresh` setting. Later requests carry the server snapshot ID. Responses from obsolete sessions, rounds or periods are discarded even when cancellation loses a race.
- The selected period defaults to `1d`; changing it requests only history/current while the round is valid. Expired rounds and filter changes start a fresh round. Historical window context is reused only inside its matching period and snapshot.
- Manual refresh forces the cash cache; focus after expiry and `smartx:portfolio-refresh` start ordinary new rounds. There is no background account polling. Any future timer must create a new read ID, not reread a frozen current snapshot.
- Open positions explicitly request 20 rows. Cursor requests retain the original round, snapshot and filters, even after the 30-second read expiry. Page expiry is independent. Only one next-page request runs at once; cursor application and row identities are checked. Snapshot/cursor errors restart once, then show an actionable error rather than loop.
- Missing pagination metadata or a response exceeding the requested page size fails visibly. The frontend does not silently fall back to the full overview endpoint.
- Retry is explicit; parameter/auth/target errors are not automatically retried. Invalid bearer tokens show sign-in recovery and never trigger anonymous fallback. Errors retain code, action and trace ID.

## Display and financial semantics

- Profile, cash, history, positions and current amounts render independently. Old summary/history blocks may remain explicitly marked stale during a refresh; pagination always resets. No client-side sum of loaded holdings is used for account totals.
- Current total assets, positions value, cash, PnL and ROI come from `current`. Cash may display first from `cash`; once current succeeds its cash field is authoritative, including an unknown value. Amounts stay decimal strings. Empty values are unknown, not zero.
- Summary cards and the chart show the selected period, rather than fetching all four periods up front. The chart supports PnL and total assets and renders actual sample times. Historical and current data are combined only for matching read/snapshot/window/context/rules. Equal-time current points replace history only in the derived view; history is never mutated. Missing ROI is not reconstructed.
- The legacy `useLivePortfolio` revaluation path is no longer used on these pages. It must not recompute account totals from a paginated or filtered list. Position sort order and membership remain server-owned.
- Wallet cash-route details are not part of these four endpoints. Cash here is canonical Solana USDC.

## Preserved consumers

Closed history, cycle activity, trades, Opinion, profile and social APIs keep their existing flows. Deposit still uses authenticated `/v1/portfolio` for cash discovery/recovery. Square position details also retain their existing read helper. The legacy API functions and chart components remain available to other callers; these two overview pages do not call the old overview.

## Verification and deployment

Tests cover independent arrival, session isolation, period changes, opaque cursors, read/page expiry, bounded snapshot recovery, exact numeric parsing, missing values, immutable curve merging and cycle navigation. TypeScript validation is also required.

Before deploying, verify the backend pagination extension with a real account containing more than 20 positions: pages must be 20/20/5 for 45 positions with stable snapshot identity, correct total count, usable cursor and page expiry. A 200 envelope alone does not establish support. Gateway read-ID affinity and actual deployed data quality still require environment acceptance.

## Profile images (2026-10-13)

The Portfolio profile header loads `/v1/profile` independently of holdings. Its image editor uses the backend `profile-media.md` contract: each purpose (`avatar` / `background`) has separate quota, upload operation, application and history requests. `upload_enabled` controls new uploads; available historical assets can still be applied when new uploads are disabled. Public user profiles display the same `background_url` at 3:1.

Selection decodes locally before cropping, without frontend file-size, format, signature, or minimum-pixel restrictions. Browser decode failures are still reported. The crop preview supports zoom and horizontal/vertical placement; a numeric zoom input has no fixed upper bound. Small source crops are upscaled. PNG exports remain 512×512 for avatars and 1500×500 for backgrounds, including a still frame when the browser decodes an animated source. The backend validates the uploaded result and performs moderation. A multipart upload contains only `file`, with a browser-generated boundary and a stable `Idempotency-Key`.

Uploading for review does not apply the picture. Save applies ready changes sequentially, records each completed purpose, updates shared user information, and shows one success notification only after all selected changes succeed. Failed changes remain editable. A timed-out application is checked against current user information before the same asset is retried. No background removal API is exposed. X import warns that a nonempty X avatar replaces the current custom avatar.

Upload timeouts recover by querying the original operation. Pending recovery makes at most eight status requests, spaced by 2.5 seconds after each completed query, with a 25-second timeout per request; users can explicitly check again. Technical failures require a new operation and at least 30 seconds before another attempt. Missing operations can replay the same in-memory file and key. Operation locators and observed failure times are stored per backend/user/purpose, without tokens or image bytes. Closing the dialog preserves drafts while the page remains mounted; after navigation or reload, the operation can be queried again, but original local files and unsent crop edits are not persisted.

Tests cover multipart encoding, small and large source selection, high-zoom crop upscaling, decode failures, pending/rejected/failed/noop handling, timeout recovery, same-key replay, partial saving, session lifecycle, shared profile updates, history with uploads disabled, and editor draft retention. Real supplier review, R2 publication, browser CORS and deployed quota behavior still need acceptance against an enabled backend with a test account.

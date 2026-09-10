# Portfolio contract migration

The deployed backend at `930d3d3a` removed `amount_raw`, `trade_basis`, `sweep` and `current_cycle` from `/v1/portfolio`. The old frontend rejected successful responses because it required `amount_raw`, then hid the parser exception behind “Could not load portfolio”.

## Current consumption

- Positions use `shares_raw` (Trade ledger shares) and flat cycle/cost/valuation fields. These quantities are not on-chain spendable balances. Initial valuation and PnL are displayed from the server response without reconstructing them using old lifetime-basis semantics.
- `total_value_usd` is positions only; `cash_balance_usd` is canonical Solana USDC cash; `total_assets_usd` is the server's complete combined value. Missing values remain unknown. Cash and holdings observation times are shown separately.
- Money remains exact decimal text. `opened_entry_id` and `chain_id` are preserved before JSON number rounding; Opinion targets use the exact cycle ID. Pending/unavailable cycles retain shares and remaining cost but hide cycle gains and disable Opinion publishing.
- The SWR key is versioned to prevent old normalized shapes being reused. Account changes hide old holdings and dismiss the old Opinion dialog. The Portfolio GET has a 15-second timeout. Parser failures retain the backend trace and are shown both on initial failure and failed refresh.

## Coupled deposit consumers

- USDC arrival monitoring reads only explicit `cash_balance_usd` with a valid cash observation timestamp, and only when the allowed route is exclusively canonical Solana USDC. It never observes Trade shares. Missing cash, cash errors, unknown/global relevant errors or other accepted mints fail closed.
- Cash snapshots are compared as exact canonical decimal strings. A change remains a balance-change observation, not confirmation of a particular transaction. Existing bounded polling/cancellation limits remain in effect.
- Portfolio no longer supplies EVM sweep discovery. Its ledger positions are not passed as sweep candidates; discovery is explicitly shown unavailable. The existing known-order recovery component stays mounted independently of Portfolio loading/errors. No new sweep is created, prepared, signed or submitted by this migration.

## Holding cycle history

- The open table is intentionally compact: token name/logo, current shares, market price, current position value, ROI, cumulative buy value, average buy price per share, and actions. The closed table shows token name/logo, realized PnL, ROI, cumulative buy/sell values, average buy/sell prices per share, and the cycle-trades action. Unknown logos use a symbol placeholder; invalid and failed image URLs do not leave broken images.

- Current position rows expose `Cycle trades` only when their cycle identity is ready. The separate `Closed positions` section reads `/v1/portfolio/history?status=closed&limit=20`, preserving its opaque cursor and each asset + opened-entry identity. Multiple completed cycles of one token remain separate rows.
- Both lists open the same cycle panel, which always sends `chain`, `asset`, and the exact `opened_entry_id` together to `/v1/portfolio/position/trades`. It paginates with `before_id`, preserves server order, and rejects a response belonging to another asset/cycle. Global Activity remains independent.
- Closed PnL and averages are historical server values; missing amounts/precision remain unavailable. A return of `0.25` displays as `25%`. Trades retain raw amounts because the endpoint supplies no display precision or USD valuation.
- Panels and pagination are keyed by account and cycle. Changing accounts immediately hides the old selection; late responses cannot appear under another account. Failures show retry/reset controls rather than empty holdings.

## PnL chart

- `PnL performance` consumes the existing `pnl.d1/d7/d30/all` curves from the same Portfolio response as the summary. Refresh revalidates the Portfolio snapshot; `all_usd` is a headline fallback only and never generates a curve.
- Hover and keyboard selection display both PnL and total assets. The matching `/v1/portfolio/balance/curve?window=1d|7d|30d|all` is fetched once per account/window/snapshot, never per mouse movement. Historical balances match the actual PnL sample timestamp exactly (including a prior observation used for a displayed boundary). Missing samples show —; no current balance, nearest-neighbor balance, or zero is substituted. NOW uses `now_usd` and labels its separate `as_of`. Failed balance reads keep PnL usable and show a retry hint. Account/window changes do not retain the previous balance dataset.
- All chart times use fixed UTC+08:00 and retain the backend storage tiers: 24H contains 24 hourly boundaries plus NOW (25 nodes), 7D contains 42 four-hour boundaries plus NOW (43 nodes), and 30D contains 30 daily boundaries plus NOW (31 nodes). The clock updates every 30 seconds; monetary values remain the last backend snapshot, whose observation time is shown. At an exact boundary, the historical nodes end at the preceding boundary so NOW is not duplicated. Historical values select an exact boundary observation or the latest prior one within that tier interval, never a later value; actual sample times are retained and displayed when different. Missing observations remain unavailable, future samples are excluded, and All retains all valid daily historical nodes plus NOW. All nodes fit the chart from oldest to newest without scrolling, with continuous connections between available values.

- Pointer inspection, a keyboard-accessible sample slider and a raw-value table expose timestamps and exact USD strings. Chart coordinates use exact integer scaling before conversion to pixels. Account changes reset both the selected period and sample.

## Verification coverage

## Executed trade presentation

- Global Activity trades and holding-cycle trades share one row presentation backed by `/v1/portfolio/position/trades`. It displays the server-provided current token `name/symbol/logo`, exact `token_amount`, `trade_value_usd`, `execution_price_usd`, `created_at` and optional `confirmed_at` in both endpoint modes.
- The frontend does not recompute settlement price from raw legs. Empty enrichment fields on legacy/incomplete trades render as `—`; they do not remove the underlying trade. Raw settlement amounts, status, fee and transaction identity remain parsed for diagnostics.

Asset lookup is independent of whether the selected tick has PnL. A missing PnL baseline must not hide an available asset snapshot at that exact time. The hover panel distinguishes request failures (message/code/trace), missing current value, an empty history, and a missing timestamp match.

Tests cover the deployed flat response, the original missing-shares failure, exact large IDs, cash and partial-data semantics, unready cycles, parser traces on initial load and refresh, cross-account responses and Opinion cleanup, and recovery-component lifetime during Portfolio failure.

On 2026-09-09, a new Portfolio tab in the user's already authenticated Chrome profile successfully displayed real positions, cash, total assets and activity. The original tab was left on its separate workflow. No credentials were copied, and no financial action was performed during verification.

Backend source contract: `smartx-backend/docs/contracts/portfolio.md` at `930d3d3a`.

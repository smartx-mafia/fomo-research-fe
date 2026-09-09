# Portfolio contract migration

2026-09-09: Portfolio includes five-chain `cash_balances[]`, now the sole Deposit discovery source. Retired address endpoints are no longer called. User-initiated refresh sends `force_refresh=true`; automatic checks retain the cache window. Missing wallets or failed balances remain partial data and do not hide other chains or ledger positions. See [current funds contract](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/funds-integration.md).

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

- Current position rows expose `Cycle trades` only when their cycle identity is ready. The separate `Closed positions` section reads `/v1/portfolio/history?status=closed&limit=20`, preserving its opaque cursor and each asset + opened-entry identity. Multiple completed cycles of one token remain separate rows.
- Both lists open the same cycle panel, which always sends `chain`, `asset`, and the exact `opened_entry_id` together to `/v1/portfolio/position/trades`. It paginates with `before_id`, preserves server order, and rejects a response belonging to another asset/cycle. Global Activity remains independent.
- Closed PnL and averages are historical server values; missing amounts/precision remain unavailable. A return of `0.25` displays as `25%`. Trades retain raw amounts because the endpoint supplies no display precision or USD valuation.
- Panels and pagination are keyed by account and cycle. Changing accounts immediately hides the old selection; late responses cannot appear under another account. Failures show retry/reset controls rather than empty holdings.

## Verification coverage

Tests cover the deployed flat response, the original missing-shares failure, exact large IDs, cash and partial-data semantics, unready cycles, parser traces on initial load and refresh, cross-account responses and Opinion cleanup, and recovery-component lifetime during Portfolio failure.

On 2026-09-09, a new Portfolio tab in the user's already authenticated Chrome profile successfully displayed real positions, cash, total assets and activity. The original tab was left on its separate workflow. No credentials were copied, and no financial action was performed during verification.

Backend source contract: `smartx-backend/docs/contracts/portfolio.md` at `930d3d3a`.

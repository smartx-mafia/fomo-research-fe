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

## Verification

Tests cover the deployed flat response, the original missing-shares failure, exact large IDs, cash and partial-data semantics, unready cycles, parser traces on initial load and refresh, cross-account responses and Opinion cleanup, and recovery-component lifetime during Portfolio failure.

On 2026-09-09, a new Portfolio tab in the user's already authenticated Chrome profile successfully displayed real positions, cash, total assets and activity. The original tab was left on its separate workflow. No credentials were copied, and no financial action was performed during verification.

Backend source contract: `smartx-backend/docs/contracts/portfolio.md` at `930d3d3a`.

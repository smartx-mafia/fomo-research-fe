# Frontend risk UI and ordinary Trade handoff

Implementation and acceptance snapshot: **2026-09-17**. Implemented in the isolated frontend worktree on `codex/goplus-enforcement`, based on `f07140611f38709bf42aa9742616f4ee8d4a9034`. No backend or original frontend edits. Commit, push, deployment and live verification are tracked separately in [release status](./goplus-release-status.md); the verification below is not evidence of production deployment. See also the [GoPlus delivery overview](./goplus-update-delivery.md).

## UI locations

- Token detail page (`/token?chain=...&address=...`, also the existing development path rewrite): `TokenLive.tsx` inserts `TokenRiskBanner` immediately below the price/header and above the chart.
- `TokenRisk.tsx`: gray incomplete state; no complete R1 banner; yellow R2/R3; orange R4; red R5. One item uses its fixed dictionary title, multiple items use the deduplicated count. Details group GoPlus before Codex only for multiple sources, otherwise show a Source footer. No risk timestamps or provider free-text HTML are rendered.
- `TradePanel.tsx`: R4 explicit risk dialog before creating a trade. R5 Buy is visually/ARIA disabled for trading but remains clickable to explain why. Sell does not consume the buy gate or perform an extra trade-time risk RPC.
- Multi-item summaries use `Token notice · N` (R2), `Risk warning · N` (R3), `High risk · N` (R4), and enforced R5 `High risk · Buying unavailable · N`. Dialog titles follow the same grade semantics. Unknown is exactly `Risk data unavailable`, with no empty risk list/source placeholder and no promise of trade execution.
- Dialogs are mobile bottom sheets and centered desktop dialogs, capped at 85vh. Only the body scrolls; the header and action footer remain visible. Opening R5 details from either the banner or Buy never shows a Continue button.
- Copy distinguishes unavailable verified source from proven closed source, a proxy from guaranteed upgradeability, network-dependent shutdown behavior from guaranteed destruction, ordinary address privileges from B20 whitelist-only trading, and tested-route buy/sell restrictions from universal restrictions. Transfer-hook copy uses the backend item's grade: program detected (R2), modifiable (R4), malicious (R5).

## Protocol and execution

- Canonical `risk.assessment` is normalized without inferring grade from legacy flags or provider evidence. Only `mode=enforce` enables buy gates. Unknown/unavailable provider checks alone never disable buying.
- An enforced known R5 stays blocked if the decision store returns `buy_action=unavailable`; a retained enforced R4 still needs confirmation. Grade 0 remains allowed by the risk UI, and Sell remains independent. Server-side checks are still authoritative.
- `api/token-risk.ts` exposes anonymous-capable GET and authenticated POST confirm, validates chain/address on both replies, and returns the validated fresh response.
- R4 sequence: explicit risk acceptance → Create with `prepare:false` → POST confirm `{flow_id: "meme:" + trade_id, confirmation_version}` → existing Prepare → sign → existing Submit.
- Create supports an optional fourth argument `{prepare?: boolean}` while preserving existing callers. Prepare/Submit receive no new fields. There is no boolean acknowledgement or receipt transport.
- The entire confirmation version is opaque, including `semanticHash:monotonicEpoch`. It is compared and transmitted verbatim. A new epoch invalidates local reuse even if the semantic hash returns to an earlier value.
- The mounted panel retains a pending flow and its confirmed version for the same session/token/intent; unrelated observation timestamps and decision-version refreshes do not repeat confirmation. The backend owns durable user/token/flow/version confirmation storage. The frontend adds no persisted acknowledgement or new order persistence.
- Tax `params.rate` is already a decimal-percent string. `3.88` displays as `3.88%`; evidence ratio `0.0388` is preserved and never used to calculate the title or grade.
- Display parameters are allowlisted by item code and validated both during normalization and at the rendering boundary. Tax `rate` accepts only exact ordinary decimal strings in 0..100 (inclusive), using string comparison with no floating-point conversion. Creator-honeypot `count` accepts only bounded decimal-digit strings and preserves integer precision. Invalid values, unknown parameter names and parameters on unrelated codes are omitted; labels are fixed application copy. Evidence remains raw data and never determines a grade.
- Risk refresh failures retain the last successful token-specific SWR snapshot. Manual refresh returns its RPC result instead of a previous render's assessment.
- Optional `assessment.valid_until_ms` is normalized as nullable `validUntilMs`. The UI uses that backend deadline, not raw-provider fields, for local display freshness. R1 remains banner-free after a failed refresh only until its deadline; expiry reveals the gray `Risk data unavailable` banner. Known R2–R5 retain their original grade/items/confirmation version and show a check-state card when checks expire. Missing-deadline legacy snapshots become conservatively incomplete after a refresh failure. No timestamps are displayed.
- The local expiry hook schedules only UI updates at the deadline (and checks again on focus/visibility), with no extra risk/provider calls. The backend `checksComplete` fact is not rewritten. Manual refresh errors are published alongside the retained shared snapshot because SWR mutations do not otherwise expose them as query errors; successful responses clear this marker.
- Single/batch metadata, market, Overview, Search and board WS normalization preserve the complete assessment, evidence, params, versions, availability and permission fields. `FavoritesProvider.metadataMap` now also saves risk beside info and retains it on a later batch failure. Metadata-cache risk is not substituted for the fresh trade-time GET decision.
- Manual risk refresh explicitly binds cache publication to the captured chain/address; a response from before navigation cannot contaminate the next token. Registering the request promise with SWR also prevents out-of-order refreshes from replacing newer cache data.
- If an open R4 review receives an enforced R5 live assessment, including R5 with `buy_action=unavailable`, the modal immediately shows the R5 risks and removes Continue. An additional check before Create prevents execution if risk upgraded while awaiting other reads.
- `430310`/`430312` stop progression, refresh risk, and require a new user review. No error handler automatically acknowledges risks. `430311` and `500310` use fixed explanatory messages.
- Submit recovery checks the existing trade. Already signed/submitted/included/confirmed orders continue normal recovery. Unknown results never automatically re-sign/resubmit. Explicit retry remains available for the same trade after status lookup; risk rejections only reopen the review path when recovered state is known to be pre-submit.

## Reusable integration points

`lib/risk-assessment.ts`, `api/token-risk.ts`, `hooks/useTokenRisk.ts`, `hooks/useRiskReview.ts`, and `components/TokenRisk.tsx` can be consumed by another trading surface. Action side effects stay in event handlers and synchronous refs prevent duplicate execution, following the relevant Vercel React guidance.

FastSwap is absent from this `origin/main` baseline. No FastSwap files or other untracked work were imported from the dirty original frontend. FastSwap integration remains outside this delivered ordinary Trade implementation.

## Verification (2026-09-17)

- Node `/Users/a11111/.nvm/versions/node/v24.19.0/bin/node`, pnpm 11.17.0 through Corepack; dependencies installed with `--frozen-lockfile`. Package and lockfiles are unchanged; no npm lockfile was created.
- Final full Vitest suite: **493 passed, 1 skipped**, 74 passing files. The pre-existing skipped test is `src/api/user-portfolio.smoke.test.ts`.
- 68 added tests across `risk-assessment.test.ts`, `risk-metadata-retention.test.ts`, `token-risk.test.ts`, `useTokenRisk.test.tsx`, `TokenRisk.test.tsx`, `TokenRisk.freshness.test.tsx`, `TradePanel.risk.test.tsx`, and the existing `FavoritesProvider.test.tsx`.
- Fake-clock tests cover a cached R1 surviving an offline RPC before its deadline and becoming gray exactly on expiry without another RPC; R4 expiry preserves confirmation and items; legacy-error fallback, known R2/R3/R5 check-state cards, and shared manual-error recovery are also covered. The ordinary Trade test reuses the same flow confirmation even after its check deadline expires.
- Coverage includes unknown normalization, mode guard, retained risk, grade 0 versus R5, response identity, fresh RPC object identity, opaque epoch changes, exact tax display, no automatic confirmation, Sell independence, duplicate clicks, stale confirmation replies, risk-store failure, session changes, and submitted-order recovery.
- `next typegen`, `tsc --noEmit`, production `pnpm build` (23 generated pages), and `git diff --check` passed. Existing static-export rewrite warnings and a test timer NaN warning remain.
- Browser component QA: desktop and mobile 390×844 long-list R4 dialogs, mobile R5 banner-to-dialog, exact unknown banner copy, tax banner, and R1 absence checked. The 49-item mobile fixture had a 514px scrolling body; the footer stayed at y=754..843 before and after scrolling to the bottom. Mounted TradePanel tests verify live R4→R5 replacement and no Create/Confirm/sign calls. This is fixture/mounted-component verification, not a live wallet or backend integration test.

Run commands from `app` with Node 24 first in PATH:

```sh
corepack pnpm test
corepack pnpm exec tsc --noEmit
corepack pnpm build
node qa/serve-risk-ui.mjs
```

The optional component fixture can be restarted at `http://127.0.0.1:3197/qa/risk-ui.html`. It reuses the production risk components, has no wallet connections or order creation, and is not a shipped Next route. It uses the Vite dependency already installed with Vitest. The final mobile fixture screenshots are `/private/tmp/smartx-risk-final-qa.Eq79X9/mobile-r4-long-list.jpg` and `/private/tmp/smartx-risk-final-qa.Eq79X9/mobile-r5-state.jpg` (354×767 JPEGs from the available Chrome viewport). The earlier 390×844 screenshots are also retained in the original temporary directory. No screenshot artifacts were added to the repository.

Final cleanup: verified PID **47290** was `node qa/serve-risk-ui.mjs` in this isolated frontend's `app` directory, then stopped it with SIGTERM as requested. Confirmed the process no longer exists and port **3197** has no listener. The temporary QA browser tab was closed and its viewport override reset. Final `tsc --noEmit`, the full test suite and the production build all exited successfully before cleanup. No QA server or verification command from this task remains running.

Live API deployment, authenticated backend confirmation persistence, wallet signing and real funds movement were not exercised. Production enablement remains controlled by the backend's optional `goplus.enforce` setting and emitted `mode`.

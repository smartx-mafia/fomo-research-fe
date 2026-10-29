# Fiat deposit backend self-test

This harness reuses `src/features/harness/api.ts` and its transport. It changes no application components and no React Native code. The backend opt-in test starts real Business HTTP, JWT verification, PostgreSQL storage, Crossmint webhook verification and gRPC transport. External provider, Privy and Notify responses are controlled test fixtures.

From a SmartX backend checkout containing `fiat_fomo_harness_test.go`, run:

```sh
FOMO_FIAT_HARNESS_DIR=/absolute/path/to/fomo-research-fe/app \
FOMO_FIAT_TEST_DSN='postgres://postgres@127.0.0.1:55439/fiat_test?sslmode=disable' \
go test ./app/business/internal/server -run '法币Fomo' -count=1 -v
```

Use an isolated PostgreSQL database: backend startup applies its schemas. The runner generates temporary user/service signing keys and a Solana wallet, launches this script via `npx --package=tsx tsx`, and closes its fixture servers afterward. JWTs, private keys and checkout secrets are never printed by the script. Test controls accept only a loopback URL and do not exist in production code.

Checks: create, idempotent replay, payload conflict, anonymous/foreign-user rejection, original-message wallet proof and bad signature rejection, checkout recovery, delivery_processing to completed refresh, actual net USDC raw amount and mint, Notify failure/retry, unsigned webhook rejection, signed webhook replay, unified history deduplication, and durable order/notification acknowledgment in PostgreSQL.

This proves backend contracts and recovery, not real card payment, KYC, mobile push delivery or mainnet settlement. Those require the matching live provider environment and account.

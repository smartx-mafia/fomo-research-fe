# Token chart integration

The token detail chart now uses REST OHLCV for candles and volume, and a separate timestamped WS quote line. The former trade-list folding mixed cross-pool events and raw token units into already-counted history; it has been removed.

## Display and interaction

- Dynamic price precision keeps small-token prices legible. Candle and volume panes share the time axis; crosshair inspection shows UTC time and OHLC/volume.
- Initial views use a readable recent range; historical prepends retain the left-edge candle and zoom. Refresh preserves older loaded pages; only an initial view, explicit reset or feed revision resets the view.
- Log scale, expansion and back-to-latest controls work without additional requests. Loading/error states preserve existing useful candles.
- A current or unsettled server candle is provisional. Its volume is shown as pending; a later REST response must confirm it before it is described as closed. An unconfirmed quote-only bucket absent from later history is removed.

## Transport and cost

- `/ohlcv` latest requests omit `from/to`; refresh respects `min(period, 15 minutes)`. No candle-specific `/trades` polling exists.
- Historical requests are explicit, aligned, closed 300-period windows; the upper bound respects the backend's 60-second settlement window. Empty windows advance the cursor but do not declare all older history empty. Empty first windows can load older history.
- At most one request per active chart view; token/period changes, hidden documents and unmounts abort it and reject late writes. Six views are cached, each bounded to 6000 candles.
- After an offline gap beyond the latest window, reset to the new window with a message instead of connecting unrequested history. Older data is available through user-driven pages, never an automatic long-history loop.
- Confirmed overlapping OHLC changes or bars disappearing from a definitely requested interval invalidate old segments. This is conservative: the API does not expose a pool/revision ID, so undetectable source migrations cannot be fully resolved in the frontend.
- The WS quote must match identity, be monotonic, be connected and be less than 60 seconds old (up to 2 seconds of local/server clock skew). Quotes do not alter OHLC or volume. The existing feed does not support exact trade-level live candles.

## Verification

Regression tests exercise malformed responses, time units, precision, duplicate volume, refresh/history overlap, empty and sparse pages, retention and settlement boundaries, cancellation, TTL/backoff, offline gaps, feed revisions and provisional-tail confirmation.

Browser verification against the existing test API: 5m initially 301 candles; one manual history page gives 601; 1m then 5m restores 601. Only bounded UI interactions are used. No trade or wallet action is performed.

Integration references: backend `docs/contracts/market-kline.md`; [TradingView series data APIs](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi), [price-format contract](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceFormatBuiltIn), and [Codex primary-pair bars](https://docs.codex.io/api-reference/queries/getbars).

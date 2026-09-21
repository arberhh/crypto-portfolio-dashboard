# Failure Modes and E2E Scenarios

Every scenario below is exercised by `e2e/run.js` against a real server process, real fake CMC
and fake DexScreener HTTP servers, and asserts on exact numbers derived from fixed fake data.
Scenario ids match the `name` field written into `e2e/artifacts/report.json`.

## 1. CoinMarketCap upstream failures

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 1.1 | CMC returns 401 (bad key) | `cmc-401` | Refresh fails; if no prior cache, portfolio serves fallback/manual prices with a warning; if prior cache exists, last good prices are served, marked stale, with a warning surfaced. |
| 1.2 | CMC returns 429 | `cmc-429` | Same as 401: treated as a failed refresh, does not crash the process, warning surfaced. |
| 1.3 | CMC returns 500 | `cmc-500` | Same as above. |
| 1.4 | CMC request times out | `cmc-timeout` | Refresh aborts after a bounded timeout, treated as a failed refresh, stale/manual data served instead of hanging the request. |
| 1.5 | CMC returns malformed JSON | `cmc-malformed-json` | JSON parse error is caught, treated as a failed refresh. |
| 1.6 | CMC returns an empty `data` object | `cmc-empty-data` | Every id treated as missing; each holding falls back down its chain (Dex, then fallbackPriceUsd, marked manual). |

## 2. CMC response shape edge cases

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 2.1 | A requested id is missing from `data` | `cmc-missing-id` | That holding falls back to Dex/manual; other holdings unaffected. |
| 2.2 | `quote.USD.price` is `null` for an id | `cmc-null-price` | Treated like a missing id: falls back down the chain. |
| 2.3 | Returned `symbol`/`name` doesn't match `holdings.json` | `cmc-symbol-mismatch` | A warning is logged/surfaced at startup map-resolution time; the price is still used (id is authoritative) but the mismatch is flagged. |
| 2.4 | `data[id]` is an object (single quote) vs an array (CMC sometimes wraps in a list) | `cmc-data-shape-object` / `cmc-data-shape-array` | Both shapes parse identically to the same price. |

## 3. DexScreener edge cases

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 3.1 | Dex returns no pairs for a mint | `dex-no-pairs` | Falls back to `fallbackPriceUsd`, marked manual. |
| 3.2 | Dex returns only pairs below the minimum liquidity threshold | `dex-low-liquidity` | Those pairs ignored; falls back to `fallbackPriceUsd`, marked manual. |
| 3.3 | Dex returns multiple pairs for one mint | `dex-multi-pair` | The pair with the highest `liquidity.usd` wins, and its price is used exactly. |

## 4. Staleness / upstream recovery

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 4.1 | Upstream fails on the refresh *after* a previously successful fetch | `stale-after-good-fetch` | Last good prices are served unchanged, `priceStatus: "stale"` is set, and a warning string is present in the response. |

## 5. No API key / demo mode

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 5.1 | `CMC_API_KEY` unset | `demo-mode-no-key` | Server never calls CMC; every holding prices from `fallbackPriceUsd` (or Dex if it has a mint that resolves), `priceSource: "manual"` where applicable, and the response/UI signals demo mode. |

## 6. holdings.json edge cases

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 6.1 | `holdings.json` is invalid JSON | `holdings-invalid-json` | `/api/portfolio` returns a clear error/warning instead of crashing the process; previously cached prices (if any) still served where possible. |
| 6.2 | `holdings.json` is edited between two requests | `holdings-hot-reload` | The second request reflects the new holdings without restarting the server (re-read on every request). |

## 7. Concurrency

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 7.1 | 20 concurrent requests hit `/api/portfolio` on a cold cache | `concurrent-cold-cache` | Exactly one upstream CMC call (and one Dex call) is made; all 20 responses are consistent with each other. |

## 8. Cost / P&L math

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 8.1 | A holding has `cost: null` | `cost-null` | Excluded from cost/P&L totals, included in value totals, flagged in the row (`costEstimated: false`, `cost: null`, `pnl: null`). |
| 8.2 | A holding has an estimated cost (`solSpent`/`solPriceUsd`) | `cost-estimated` | `costEstimated: true`; cost computed as `solSpent * solPriceUsd`; included in cost/P&L totals. |
| 8.3 | Mixed rows (known cost, estimated cost, null cost) in one portfolio | `cost-mixed-totals` | Totals: `cost` and `pnl` sum only known+estimated-cost rows; `value` sums all rows; `coverage` = value of rows with known cost / total value, exact fraction. |

## 9. history.json edge cases

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 9.1 | `history.json` missing | `history-missing` | Treated as empty history; first successful refresh creates the file. |
| 9.2 | `history.json` corrupt (invalid JSON) | `history-corrupt` | Treated as empty history rather than crashing; gets overwritten on next successful append. |
| 9.3 | `history.json` at the 5000-point cap | `history-cap` | Oldest point(s) dropped so the file never exceeds 5000 points; write is atomic (temp file + rename). |

## 10. Secret hygiene

| # | Failure | Scenario id | Expected behavior |
|---|---------|-------------|--------------------|
| 10.1 | API key must never leak | `no-key-leak` | `CMC_API_KEY` value never appears in any `/api/*` response body or header, and never in `/`. |

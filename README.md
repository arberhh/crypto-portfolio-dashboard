# Crypto Portfolio Dashboard

A local, single-process crypto portfolio dashboard. One Node.js file (`server.js`, Node 18+
built-ins only, no framework, no build step, no runtime dependencies) serves a static page and a
small JSON API. The frontend (`public/index.html`) is a single file with inline CSS and vanilla JS.

## Setup

```sh
npm start
```

That's it — no install step, no dependencies to fetch. The server binds to `127.0.0.1` only.

By default there's no `.env` file, so the server starts in **demo mode**: every price comes from
`fallbackPriceUsd` in `holdings.json`, and the UI shows a demo banner. To get live prices:

```sh
cp .env.example .env
# then edit .env and set CMC_API_KEY
```

## Getting a CoinMarketCap API key

1. Sign up at https://coinmarketcap.com/api/ (the free "Basic" tier is enough for this project).
2. Create an API key from your CMC developer dashboard.
3. Put it in `.env` as `CMC_API_KEY=...`. It is read server-side only and never sent to the
   browser, echoed in an API response, or logged.

## Credit math for the default refresh interval

The server does a **lazy** refresh: it only calls CoinMarketCap when a client requests
`/api/portfolio` *and* the cached prices are older than `REFRESH_SECONDS` (default 300s / 5
minutes). All holdings with a `cmcId` are fetched in a single batched call to
`/v2/cryptocurrency/quotes/latest`, which costs **~1 credit per call** regardless of how many ids
are requested (up to CMC's per-call id limit).

So, with the dashboard open and polling every 15s, and the default 5-minute cache TTL:

- Upstream calls per hour: `60 / 5 = 12` calls/hour.
- Credits per day: `12 * 24 = 288` credits/day.
- CMC's free Basic plan includes 10,000 credits/month, i.e. roughly `10000 / 30 ≈ 333`
  credits/day of headroom — the default 5-minute refresh comfortably fits with room to spare.

If nobody has the dashboard open, there are **zero** upstream calls — the lazy refresh only runs
when a request actually arrives. Lower `REFRESH_SECONDS` for fresher prices at the cost of more
credits; raise it to spend fewer credits.

## Editing your holdings

See [`docs/HOLDINGS.md`](docs/HOLDINGS.md) for a plain-language guide to `holdings.json` — no
coding knowledge required, includes a copy-paste AI prompt for generating new entries.

## Filling in the TODOs

`holdings.json` ships with a few Solana holdings that have `"mint": null` and a `_mintTodo` note:
`DUPE`, `STARTUP`, `DNA`, `CENTS`, `BULLY`. These are memecoins not indexed by CoinMarketCap, so
they're priced via DexScreener by mint address instead. To wire them up:

1. Find the real SPL mint address for the token (e.g. from Phantom's token detail view, or
   Solscan/Solana Explorer — verify it against the token you actually hold, since a wrong address
   will silently price a different token).
2. Set the `mint` field in `holdings.json` to that address. Leave it `null` if you're not sure —
   the app will keep using `fallbackPriceUsd` (marked "manual") until it's filled in. Never guess
   or invent an address.

`DUPE` and `STARTUP` also carry an **estimated** cost basis (`cost.estimated: true`), computed as
`solSpent * solPriceUsd` using a placeholder `solPriceUsd: 170`. Replace that with the actual SOL/USD
price at the time of each buy (check your wallet's transaction history or a block explorer for the
transaction timestamp and the SOL price then), and set `estimated: false` once verified.

## Testability hooks (env vars)

| Var | Purpose |
|---|---|
| `CMC_BASE_URL` | Override CoinMarketCap's base URL (defaults to the real host). |
| `DEXSCREENER_BASE_URL` | Override DexScreener's base URL (defaults to the real host). |
| `FIXED_NOW` | ISO timestamp; replaces `Date.now()` everywhere for deterministic tests. |
| `DATA_DIR` | Override where `history.json` is read/written (defaults to `./data`). |
| `UPSTREAM_TIMEOUT_MS` | Per-request timeout for upstream calls (default 8000). |
| `MIN_LIQUIDITY_USD` | Override the minimum DexScreener pair liquidity (defaults to `holdings.json`'s `minLiquidityUsd`, or 1000). |

## Testing

There are no unit tests (see `AGENTS.md`). All testing is end-to-end, against the real server
process and fake CoinMarketCap/DexScreener HTTP servers:

```sh
npm run e2e
```

This runs the full scenario suite (see `failure-modes.md` for the list) twice back to back,
writes `e2e/artifacts/report.json` with a SHA-256 of the normalized results, and fails if the two
runs don't hash identically or if the hash doesn't match the committed `e2e/golden.sha256`.

## Deliverables

- `AGENTS.md` — essentials for future agents working on this repo, linking to `agents/` for details.
- `agents/` — testing, code-style, and architecture conventions.
- `failure-modes.md` — every failure mode this system can hit, written before the code.
- `server.js` — the whole backend.
- `holdings.json` — seed portfolio data.
- `docs/HOLDINGS.md` — plain-language guide to editing `holdings.json`.
- `public/index.html` — the whole frontend.
- `e2e/` — the E2E harness, fakes, scenarios, and artifacts.
- `.env.example`, `.gitignore` — config templates.

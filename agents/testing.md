# Testing conventions

- **No unit tests, ever** — not written before code, not after, not for isolated pieces. E2E is
  the only testing mechanism in this repo.
- All tests live under `e2e/` and run via `npm run e2e`. They spawn the real server process
  against fake CoinMarketCap/DexScreener HTTP servers and assert on exact numbers. No mocking
  inside the app itself.
- Before implementing a feature, enumerate every way it could fail in `failure-modes.md` first,
  then write the code. Every failure mode listed there must have a corresponding e2e scenario
  before that feature counts as done.
- The e2e run must be deterministic and produce a verifiable artifact:
  - Writes `e2e/artifacts/report.json`.
  - Running the suite twice back to back must produce an identical normalized SHA-256 hash.
  - That hash is checked against the committed `e2e/golden.sha256`.
- Deterministic also means across Node versions, not just across runs on one machine. Never let a
  caught error's own `.message` reach a response or warning — the engine's exact wording for
  built-in errors (`JSON.parse` SyntaxErrors, `fetch`/undici network failures) changes between Node
  versions, which changes the golden hash depending on which Node ran the process even though
  nothing about the app's behavior changed. `loadHoldingsRaw`'s `catch { throw new Error('malformed
  JSON') }` is the reference: throw a fixed string of your own instead of forwarding `e.message`.

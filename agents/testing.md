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

- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.

## Project rules

This project is a local crypto portfolio dashboard: a single Node.js process (built-ins only,
no framework, no build step, no runtime dependencies) serving a static page and a JSON API.

- Backend: `server.js`, using only the `http`, `fs`, `path`, `crypto`, `https` built-in modules.
- Frontend: `public/index.html`, a single file with inline CSS and vanilla JS. No build step.
- Config comes from `.env` (tiny hand-rolled loader, no `dotenv` package) plus env var overrides
  documented in the README (`CMC_BASE_URL`, `DEXSCREENER_BASE_URL`, `FIXED_NOW`, `DATA_DIR`).
- All tests live under `e2e/` and run via `npm run e2e`. They spawn the real server against fake
  upstream HTTP servers and assert on exact numbers. No mocking inside the app, no unit tests.
- Every failure mode enumerated in `failure-modes.md` must have a corresponding E2E scenario
  before its related feature is considered done.
- The E2E run must produce `e2e/artifacts/report.json` and be repeatable: running the suite twice
  back to back must produce an identical SHA-256 hash of the normalized output, checked against
  `e2e/golden.sha256`.

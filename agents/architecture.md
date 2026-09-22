# Architecture constraints

- Backend: `server.js` — Node.js built-ins only (`http`, `fs`, `path`, `crypto`), plus the global
  `fetch` for upstream calls. No framework, no npm dependencies.
- Frontend: markup, styles and behaviour live in three separate files — `public/index.html`,
  `public/app.css`, `public/app.js`. Still no build step, no bundler, no dependencies: the files
  are served as-is.
  - _Not applied yet: `index.html` is still a single inline file. Delete this note as part of the
    split._
- Serve static assets with exact-match routes (`url.pathname === '/app.css'`) pointing at
  hardcoded paths — never a generic handler that joins the request path onto a directory. Keeping
  user input out of `path.join` is what removes the path-traversal surface, which matters now that
  the app is publicly deployed.
- Config: `.env`, loaded by a tiny hand-rolled parser (no `dotenv` package). See README.md's env
  var table for the full list of supported overrides.

# Code style

- Prefer `const`; use `let` only when a binding is genuinely reassigned (loop counters,
  accumulators). Never use `var`.
- Write linear, top-to-bottom code. Prefer early returns over nested conditionals — `resolvePrice`
  and the request handler in `server.js` are the reference examples.
- One job per function. If you can't say what a function does without using "and", split it.
- Extract a helper on the third repeat, not the second. Two similar blocks that would need a
  4-plus parameter helper to merge should stay as they are.
- When those last two rules conflict, favour whichever a less experienced engineer could follow.
  Duplication is easier to read than the wrong abstraction.
- No clever one-liners: no nested ternaries inside template literals, no dense multi-clause
  boolean filters. Break them into named intermediate values instead.
- One concern per file, for the same reason as one job per function. A file holding markup plus
  styles plus behaviour should be split along those seams rather than navigated by scrolling.
- Keep the handle from every `setInterval`, and from every `setTimeout` that can outlive whatever
  scheduled it, then clear it on the path that ends its purpose — `finally`, teardown, or page
  unload. `fetchJson` in `server.js` is the reference: handle in a `const`, `clearTimeout` in
  `finally`, so an early throw can't leave it pending.
- The exception is a one-shot timer that always fires and whose callback finishes the work, like
  the `delayMs` timers in the e2e fakes. Those need no handle; requiring one everywhere would be
  noise.

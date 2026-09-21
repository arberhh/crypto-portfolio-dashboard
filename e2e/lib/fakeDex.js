'use strict';
const http = require('http');

// Fake DexScreener server. pairsByMint: { [mint]: [{ liquidityUsd, priceUsd }, ...] }
function createFakeDex(initialState) {
  const state = { status: 200, mode: 'normal', pairsByMint: {}, ...initialState };
  const log = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    log.push({ target: 'dex', method: req.method, path: url.pathname });
    const match = url.pathname.match(/^\/latest\/dex\/tokens\/(.+)$/);
    const mints = match ? match[1].split(',') : [];

    const respond = () => {
      if (res.writableEnded) return;
      if (state.status && state.status !== 200) {
        res.writeHead(state.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'fake upstream error' }));
        return;
      }
      if (state.mode === 'malformed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{not valid json,,,');
        return;
      }
      if (state.mode === 'empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pairs: [] }));
        return;
      }
      const pairs = [];
      for (const mint of mints) {
        const list = state.pairsByMint[mint] || [];
        for (const p of list) {
          pairs.push({
            baseToken: { address: mint, symbol: 'TOK', name: 'Token' },
            quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana' },
            priceUsd: String(p.priceUsd),
            liquidity: { usd: p.liquidityUsd },
          });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pairs }));
    };
    if (state.delayMs) setTimeout(respond, state.delayMs);
    else respond();
  });

  return {
    server,
    log,
    setState(patch) {
      Object.assign(state, patch);
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createFakeDex };

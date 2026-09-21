'use strict';
const http = require('http');

// Fake CoinMarketCap server. `state` is mutable and can be changed between
// requests via setState() to simulate upstream recovering/degrading mid-test.
function createFakeCmc(initialState) {
  const state = { quotes: { status: 200, mode: 'normal', entries: {} }, map: { status: 200, entries: [] }, ...initialState };
  const log = [];

  function handleQuotes(url, res) {
    const cfg = state.quotes;
    const ids = (url.searchParams.get('id') || '').split(',').filter(Boolean);
    const respond = () => {
      if (res.writableEnded) return;
      if (cfg.status && cfg.status !== 200) {
        res.writeHead(cfg.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: { error_code: cfg.status, error_message: 'fake upstream error' } }));
        return;
      }
      if (cfg.mode === 'malformed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{not valid json,,,');
        return;
      }
      if (cfg.mode === 'empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: {} }));
        return;
      }
      const data = {};
      for (const id of ids) {
        if (cfg.missingIds && cfg.missingIds.includes(id)) continue;
        const entry = cfg.entries[id];
        if (!entry) continue;
        const price = cfg.nullPriceIds && cfg.nullPriceIds.includes(id) ? null : entry.price;
        const quote = {
          id: Number(id),
          symbol: entry.symbol,
          name: entry.name,
          quote: { USD: { price, percent_change_24h: entry.change24h != null ? entry.change24h : 0 } },
        };
        data[id] = cfg.arrayWrapIds && cfg.arrayWrapIds.includes(id) ? [quote] : quote;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    };
    if (cfg.delayMs) setTimeout(respond, cfg.delayMs);
    else respond();
  }

  function handleMap(url, res) {
    const cfg = state.map;
    const respond = () => {
      if (res.writableEnded) return;
      if (cfg.status && cfg.status !== 200) {
        res.writeHead(cfg.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: { error_code: cfg.status } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: cfg.entries }));
    };
    if (cfg.delayMs) setTimeout(respond, cfg.delayMs);
    else respond();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    log.push({ target: 'cmc', method: req.method, path: url.pathname });
    if (url.pathname === '/v2/cryptocurrency/quotes/latest') return handleQuotes(url, res);
    if (url.pathname === '/v1/cryptocurrency/map') return handleMap(url, res);
    res.writeHead(404);
    res.end('{}');
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

module.exports = { createFakeCmc };

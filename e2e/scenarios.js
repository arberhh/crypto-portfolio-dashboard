'use strict';
const path = require('path');
const fs = require('fs');
const { createFakeCmc } = require('./lib/fakeCmc');
const { createFakeDex } = require('./lib/fakeDex');
const { makeWorkspace, writeHoldings, writeHoldingsRaw, httpJson, spawnServer, cleanupWorkspace } = require('./lib/harness');

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const SECRET_KEY = 'SECRET-TEST-KEY-abc123';

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function close(actual, expected, msg, eps = 1e-9) {
  if (actual == null || expected == null) {
    eq(actual, expected, msg);
    return;
  }
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual}`);
  }
}
function truthy(cond, msg) {
  if (!cond) throw new Error(msg);
}

function twoAssetHoldings() {
  return {
    minLiquidityUsd: 1000,
    holdings: [
      { symbol: 'AAA', name: 'Aaa Coin', platform: 'TestEx', amount: 10, cmcId: 111, mint: null, fallbackPriceUsd: 1, cost: { usd: 50 } },
      { symbol: 'BBB', name: 'Bbb Coin', platform: 'TestEx', amount: 4, cmcId: 222, mint: null, fallbackPriceUsd: 2, cost: null },
    ],
  };
}
function twoAssetCmcEntries() {
  return {
    '111': { price: 2, change24h: 5, symbol: 'AAA', name: 'Aaa Coin' },
    '222': { price: 3, change24h: -2, symbol: 'BBB', name: 'Bbb Coin' },
  };
}

// A harness around: workspace + fake cmc + fake dex + real server, with guaranteed cleanup.
async function withRig(opts, body) {
  const { name, cmcState, dexState, holdings, envOverrides } = opts;
  const workspaceDir = makeWorkspace(name);
  const fakeCmc = createFakeCmc(cmcState || {});
  const fakeDex = createFakeDex(dexState || {});
  let server;
  try {
    const cmcUrl = await fakeCmc.listen();
    const dexUrl = await fakeDex.listen();
    if (holdings !== undefined) {
      if (typeof holdings === 'string') writeHoldingsRaw(workspaceDir, holdings);
      else writeHoldings(workspaceDir, holdings);
    }
    server = await spawnServer(workspaceDir, {
      FIXED_NOW,
      CMC_BASE_URL: cmcUrl,
      DEXSCREENER_BASE_URL: dexUrl,
      REFRESH_SECONDS: '300',
      ...envOverrides,
    });
    return await body({ workspaceDir, fakeCmc, fakeDex, server });
  } finally {
    if (server) await server.stop();
    await fakeCmc.close();
    await fakeDex.close();
    cleanupWorkspace(workspaceDir);
  }
}

function allRequests(fakeCmc, fakeDex) {
  return [...fakeCmc.log, ...fakeDex.log];
}

const scenarios = [];
function scenario(name, run) {
  scenarios.push({ name, run });
}

// ---------------------------------------------------------------------------
scenario('happy-path-live', async () => {
  return withRig(
    { name: 'happy', cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries() }, map: { status: 200, entries: [] } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      eq(res.status, 200, 'status');
      eq(res.json.mode, 'live', 'mode');
      close(res.json.totals.value, 32, 'total value');
      close(res.json.totals.cost, 50, 'total cost');
      close(res.json.totals.pnl, -30, 'total pnl');
      close(res.json.totals.coverage, 20 / 32, 'coverage');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-401', async () => {
  return withRig(
    { name: 'cmc401', cmcState: { quotes: { status: 401 } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /CoinMarketCap refresh failed/.test(w)), 'warning present');
      eq(res.json.rows.find((r) => r.symbol === 'AAA').priceSource, 'manual', 'AAA falls back to manual');
      close(res.json.rows.find((r) => r.symbol === 'AAA').price, 1, 'AAA fallback price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-429', async () => {
  return withRig(
    { name: 'cmc429', cmcState: { quotes: { status: 429 } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /CoinMarketCap refresh failed/.test(w)), 'warning present');
      eq(res.json.rows.find((r) => r.symbol === 'BBB').priceSource, 'manual', 'BBB falls back to manual');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-500', async () => {
  return withRig(
    { name: 'cmc500', cmcState: { quotes: { status: 500 } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /CoinMarketCap refresh failed/.test(w)), 'warning present');
      eq(res.json.mode, 'live', 'no prior good data means not marked stale');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-timeout', async () => {
  return withRig(
    {
      name: 'cmctimeout',
      cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries(), delayMs: 600 } },
      holdings: twoAssetHoldings(),
      envOverrides: { CMC_API_KEY: 'k', UPSTREAM_TIMEOUT_MS: '150' },
    },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /timed out/.test(w)), 'timeout warning present');
      eq(res.json.rows.find((r) => r.symbol === 'AAA').priceSource, 'manual', 'AAA falls back to manual on timeout');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-malformed-json', async () => {
  return withRig(
    { name: 'cmcmalformed', cmcState: { quotes: { status: 200, mode: 'malformed' } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /malformed JSON/.test(w)), 'malformed JSON warning present');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-empty-data', async () => {
  return withRig(
    { name: 'cmcempty', cmcState: { quotes: { status: 200, mode: 'empty' } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      eq(res.json.rows.find((r) => r.symbol === 'AAA').priceSource, 'manual', 'AAA manual');
      eq(res.json.rows.find((r) => r.symbol === 'BBB').priceSource, 'manual', 'BBB manual');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-missing-id', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    { name: 'cmcmissingid', cmcState: { quotes: { status: 200, mode: 'normal', entries, missingIds: ['222'] } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const bbb = res.json.rows.find((r) => r.symbol === 'BBB');
      eq(bbb.priceSource, 'manual', 'BBB falls back when id missing from response');
      close(bbb.price, 2, 'BBB fallback price');
      const aaa = res.json.rows.find((r) => r.symbol === 'AAA');
      eq(aaa.priceSource, 'cmc', 'AAA unaffected');
      close(aaa.price, 2, 'AAA cmc price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-null-price', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    { name: 'cmcnullprice', cmcState: { quotes: { status: 200, mode: 'normal', entries, nullPriceIds: ['222'] } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const bbb = res.json.rows.find((r) => r.symbol === 'BBB');
      eq(bbb.priceSource, 'manual', 'BBB falls back when price null');
      close(bbb.price, 2, 'BBB fallback price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-symbol-mismatch', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    {
      name: 'cmcmismatch',
      cmcState: {
        quotes: { status: 200, mode: 'normal', entries },
        map: { status: 200, entries: [{ id: 111, symbol: 'XXX', name: 'Wrong Coin' }, { id: 222, symbol: 'BBB', name: 'Bbb Coin' }] },
      },
      holdings: twoAssetHoldings(),
      envOverrides: { CMC_API_KEY: 'k' },
    },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      truthy(res.json.warnings.some((w) => /resolves to XXX\/Wrong Coin/.test(w)), 'mismatch warning present');
      const aaa = res.json.rows.find((r) => r.symbol === 'AAA');
      eq(aaa.priceSource, 'cmc', 'price still used despite mismatch warning');
      close(aaa.price, 2, 'AAA price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-data-shape-object', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    { name: 'cmcshapeobj', cmcState: { quotes: { status: 200, mode: 'normal', entries } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      close(res.json.rows.find((r) => r.symbol === 'AAA').price, 2, 'object-shaped quote parses');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cmc-data-shape-array', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    { name: 'cmcshapearr', cmcState: { quotes: { status: 200, mode: 'normal', entries, arrayWrapIds: ['111', '222'] } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      close(res.json.rows.find((r) => r.symbol === 'AAA').price, 2, 'array-shaped quote parses');
      close(res.json.rows.find((r) => r.symbol === 'BBB').price, 3, 'array-shaped quote parses (2)');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

function dexHoldings(mint) {
  return {
    minLiquidityUsd: 1000,
    holdings: [{ symbol: 'CCC', name: 'Ccc Coin', platform: 'Phantom', amount: 100, cmcId: null, mint, fallbackPriceUsd: 0.5, cost: null }],
  };
}
const MINT = 'Mint1111111111111111111111111111111111111';

scenario('dex-no-pairs', async () => {
  return withRig(
    { name: 'dexnopairs', cmcState: {}, dexState: { pairsByMint: {} }, holdings: dexHoldings(MINT), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const ccc = res.json.rows.find((r) => r.symbol === 'CCC');
      eq(ccc.priceSource, 'manual', 'falls back to manual when no pairs');
      close(ccc.price, 0.5, 'fallback price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('dex-low-liquidity', async () => {
  return withRig(
    {
      name: 'dexlowliq',
      cmcState: {},
      dexState: { pairsByMint: { [MINT]: [{ liquidityUsd: 500, priceUsd: 10 }] } },
      holdings: dexHoldings(MINT),
      envOverrides: { CMC_API_KEY: 'k' },
    },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const ccc = res.json.rows.find((r) => r.symbol === 'CCC');
      eq(ccc.priceSource, 'manual', 'sub-threshold liquidity ignored');
      close(ccc.price, 0.5, 'fallback price used instead');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('dex-multi-pair', async () => {
  return withRig(
    {
      name: 'dexmulti',
      cmcState: {},
      dexState: {
        pairsByMint: {
          [MINT]: [
            { liquidityUsd: 5000, priceUsd: 1.23 },
            { liquidityUsd: 20000, priceUsd: 1.5 },
            { liquidityUsd: 100, priceUsd: 99 },
          ],
        },
      },
      holdings: dexHoldings(MINT),
      envOverrides: { CMC_API_KEY: 'k' },
    },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const ccc = res.json.rows.find((r) => r.symbol === 'CCC');
      eq(ccc.priceSource, 'dex', 'dex price wins');
      close(ccc.price, 1.5, 'highest liquidity pair wins');
      close(ccc.value, 150, 'value uses winning pair price');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('stale-after-good-fetch', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    {
      name: 'staleafter',
      cmcState: { quotes: { status: 200, mode: 'normal', entries } },
      holdings: twoAssetHoldings(),
      envOverrides: { CMC_API_KEY: 'k', REFRESH_SECONDS: '0' },
    },
    async ({ server, fakeCmc, fakeDex }) => {
      const first = await httpJson(server.baseUrl, '/api/portfolio');
      eq(first.json.mode, 'live', 'first fetch is live');
      close(first.json.rows.find((r) => r.symbol === 'AAA').price, 2, 'first fetch price');

      fakeCmc.setState({ quotes: { status: 500 } });
      const second = await httpJson(server.baseUrl, '/api/portfolio');
      eq(second.json.mode, 'stale', 'second fetch marked stale after upstream failure');
      const aaa = second.json.rows.find((r) => r.symbol === 'AAA');
      eq(aaa.priceStatus, 'stale', 'row flagged stale');
      close(aaa.price, 2, 'last known price still served');
      truthy(second.json.warnings.some((w) => /CoinMarketCap refresh failed/.test(w)), 'warning present on second fetch');
      return { requests: allRequests(fakeCmc, fakeDex), response: second.json };
    }
  );
});

scenario('demo-mode-no-key', async () => {
  return withRig(
    { name: 'demomode', cmcState: {}, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: '' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      eq(res.json.mode, 'demo', 'demo mode reported');
      eq(res.json.demoMode, true, 'demoMode flag set');
      eq(fakeCmc.log.length, 0, 'CMC never called in demo mode');
      close(res.json.totals.value, 18, 'demo totals from fallback prices');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('holdings-invalid-json', async () => {
  return withRig(
    { name: 'holdingsbad', cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries() } }, holdings: '{ this is not json', envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      eq(res.json.mode, 'error', 'error mode reported');
      eq(res.json.rows.length, 0, 'no rows when holdings invalid');
      truthy(res.json.warnings.some((w) => /holdings\.json is invalid/.test(w)), 'warning mentions invalid holdings');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('holdings-hot-reload', async () => {
  const holdingsA = {
    minLiquidityUsd: 1000,
    holdings: [{ symbol: 'ONE', name: 'One Coin', platform: 'TestEx', amount: 1, cmcId: 111, mint: null, fallbackPriceUsd: 1, cost: null }],
  };
  return withRig(
    { name: 'hotreload', cmcState: { quotes: { status: 200, mode: 'normal', entries: { '111': { price: 5, symbol: 'ONE', name: 'One Coin' } } } }, holdings: holdingsA, envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex, workspaceDir }) => {
      const first = await httpJson(server.baseUrl, '/api/portfolio');
      eq(first.json.rows.length, 1, 'one row initially');
      eq(first.json.rows[0].symbol, 'ONE', 'initial symbol');
      close(first.json.rows[0].price, 5, 'initial cmc price');

      const holdingsB = {
        minLiquidityUsd: 1000,
        holdings: [{ symbol: 'TWO', name: 'Two Coin', platform: 'TestEx', amount: 2, cmcId: 222, mint: null, fallbackPriceUsd: 7, cost: null }],
      };
      fs.writeFileSync(path.join(workspaceDir, 'holdings.json'), JSON.stringify(holdingsB, null, 2));

      const second = await httpJson(server.baseUrl, '/api/portfolio');
      eq(second.json.rows.length, 1, 'one row after edit');
      eq(second.json.rows[0].symbol, 'TWO', 'row reflects edited holdings without restart');
      eq(second.json.rows[0].priceSource, 'manual', 'new id not covered by still-warm cache, falls back to manual');
      close(second.json.rows[0].price, 7, 'manual fallback price for new holding');
      return { requests: allRequests(fakeCmc, fakeDex), response: { first: first.json, second: second.json } };
    }
  );
});

scenario('concurrent-cold-cache', async () => {
  const entries = twoAssetCmcEntries();
  return withRig(
    { name: 'concurrent', cmcState: { quotes: { status: 200, mode: 'normal', entries } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const results = await Promise.all(Array.from({ length: 20 }, () => httpJson(server.baseUrl, '/api/portfolio')));
      const quotesCalls = fakeCmc.log.filter((l) => l.path === '/v2/cryptocurrency/quotes/latest');
      eq(quotesCalls.length, 1, 'exactly one upstream CMC quotes call for 20 concurrent requests');
      const first = JSON.stringify(results[0].json.totals);
      truthy(results.every((r) => JSON.stringify(r.json.totals) === first), 'all 20 responses agree on totals');
      return { requests: allRequests(fakeCmc, fakeDex), response: { totals: results[0].json.totals, callCount: quotesCalls.length } };
    }
  );
});

function mixedCostHoldings() {
  return {
    minLiquidityUsd: 1000,
    holdings: [
      { symbol: 'X', name: 'X Coin', platform: 'TestEx', amount: 10, cmcId: 111, mint: null, fallbackPriceUsd: null, cost: null },
      { symbol: 'Y', name: 'Y Coin', platform: 'TestEx', amount: 5, cmcId: 222, mint: null, fallbackPriceUsd: null, cost: { solSpent: 2, solPriceUsd: 10, estimated: true, date: '2025-01-01' } },
      { symbol: 'Z', name: 'Z Coin', platform: 'TestEx', amount: 5, cmcId: 333, mint: null, fallbackPriceUsd: null, cost: { usd: 10 } },
    ],
  };
}
function mixedCostCmcEntries() {
  return {
    '111': { price: 2, symbol: 'X', name: 'X Coin' },
    '222': { price: 3, symbol: 'Y', name: 'Y Coin' },
    '333': { price: 4, symbol: 'Z', name: 'Z Coin' },
  };
}

scenario('cost-null', async () => {
  return withRig(
    { name: 'costnull', cmcState: { quotes: { status: 200, mode: 'normal', entries: mixedCostCmcEntries() } }, holdings: mixedCostHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const x = res.json.rows.find((r) => r.symbol === 'X');
      eq(x.cost, null, 'null cost stays null');
      eq(x.costEstimated, false, 'not estimated');
      eq(x.pnl, null, 'pnl null when cost unknown');
      close(x.value, 20, 'value still computed for null-cost row');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cost-estimated', async () => {
  return withRig(
    { name: 'costest', cmcState: { quotes: { status: 200, mode: 'normal', entries: mixedCostCmcEntries() } }, holdings: mixedCostHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const y = res.json.rows.find((r) => r.symbol === 'Y');
      eq(y.costEstimated, true, 'flagged estimated');
      close(y.cost, 20, 'cost = solSpent * solPriceUsd');
      close(y.value, 15, 'value at cmc price');
      close(y.pnl, -5, 'pnl computed from estimated cost');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('cost-mixed-totals', async () => {
  return withRig(
    { name: 'costmixed', cmcState: { quotes: { status: 200, mode: 'normal', entries: mixedCostCmcEntries() } }, holdings: mixedCostHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex }) => {
      const res = await httpJson(server.baseUrl, '/api/portfolio');
      const t = res.json.totals;
      close(t.value, 55, 'total value sums all rows');
      close(t.cost, 30, 'total cost sums only known-cost rows (Y+Z)');
      close(t.pnl, 5, 'total pnl sums only known-cost rows');
      close(t.pnlPct, (5 / 30) * 100, 'pnl pct derived from cost/pnl of known rows');
      close(t.valueWithoutCost, 20, 'value of rows with unknown cost');
      close(t.coverage, 35 / 55, 'coverage = known-cost value / total value');
      return { requests: allRequests(fakeCmc, fakeDex), response: res.json };
    }
  );
});

scenario('history-missing', async () => {
  return withRig(
    { name: 'histmissing', cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries() } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex, workspaceDir }) => {
      fs.rmSync(path.join(workspaceDir, 'data', 'history.json'), { force: true });
      await httpJson(server.baseUrl, '/api/portfolio');
      const hist = await httpJson(server.baseUrl, '/api/history');
      eq(hist.json.points.length, 1, 'one history point after first refresh with missing file');
      close(hist.json.points[0].value, 32, 'history point value matches portfolio value');
      return { requests: allRequests(fakeCmc, fakeDex), response: hist.json };
    }
  );
});

scenario('history-corrupt', async () => {
  return withRig(
    { name: 'histcorrupt', cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries() } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex, workspaceDir }) => {
      fs.writeFileSync(path.join(workspaceDir, 'data', 'history.json'), '{not valid json,,,');
      await httpJson(server.baseUrl, '/api/portfolio');
      const hist = await httpJson(server.baseUrl, '/api/history');
      eq(hist.json.points.length, 1, 'corrupt history treated as empty, then written fresh');
      return { requests: allRequests(fakeCmc, fakeDex), response: hist.json };
    }
  );
});

scenario('history-cap', async () => {
  return withRig(
    { name: 'histcap', cmcState: { quotes: { status: 200, mode: 'normal', entries: twoAssetCmcEntries() } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: 'k' } },
    async ({ server, fakeCmc, fakeDex, workspaceDir }) => {
      const seed = Array.from({ length: 5000 }, (_, i) => ({ t: i, value: i, cost: 0, pnl: i }));
      fs.writeFileSync(path.join(workspaceDir, 'data', 'history.json'), JSON.stringify(seed));
      await httpJson(server.baseUrl, '/api/portfolio');
      const hist = await httpJson(server.baseUrl, '/api/history');
      eq(hist.json.points.length, 5000, 'history capped at 5000 points');
      eq(hist.json.points[0].t, 1, 'oldest point dropped');
      close(hist.json.points[4999].value, 32, 'newest point is the fresh refresh');
      return { requests: allRequests(fakeCmc, fakeDex), response: { length: hist.json.points.length, first: hist.json.points[0], last: hist.json.points[4999] } };
    }
  );
});

scenario('no-key-leak', async () => {
  return withRig(
    { name: 'nokeyleak', cmcState: { quotes: { status: 500 } }, holdings: twoAssetHoldings(), envOverrides: { CMC_API_KEY: SECRET_KEY } },
    async ({ server, fakeCmc, fakeDex }) => {
      const portfolio = await httpJson(server.baseUrl, '/api/portfolio');
      const history = await httpJson(server.baseUrl, '/api/history');
      const index = await httpJson(server.baseUrl, '/');
      for (const res of [portfolio, history, index]) {
        truthy(!res.body.includes(SECRET_KEY), 'response body does not contain API key');
        truthy(!JSON.stringify(res.headers).includes(SECRET_KEY), 'response headers do not contain API key');
      }
      return { requests: allRequests(fakeCmc, fakeDex), response: { checked: 3, leaked: false } };
    }
  );
});

module.exports = { scenarios };

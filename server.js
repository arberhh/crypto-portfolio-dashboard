'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Tiny .env loader (no dependency). Existing process.env values win.
// ---------------------------------------------------------------------------
function loadEnvFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '.env'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CMC_API_KEY = process.env.CMC_API_KEY || '';
const PORT = parseInt(process.env.PORT || '3000', 10);
const REFRESH_SECONDS = parseInt(process.env.REFRESH_SECONDS || '300', 10);
const CMC_BASE_URL = (process.env.CMC_BASE_URL || 'https://pro-api.coinmarketcap.com').replace(/\/+$/, '');
const DEXSCREENER_BASE_URL = (process.env.DEXSCREENER_BASE_URL || 'https://api.dexscreener.com').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const FIXED_NOW = process.env.FIXED_NOW || null;
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || '8000', 10);
const MIN_LIQUIDITY_USD_ENV = process.env.MIN_LIQUIDITY_USD ? Number(process.env.MIN_LIQUIDITY_USD) : undefined;
const HISTORY_CAP = 5000;

const HOLDINGS_PATH = path.join(__dirname, 'holdings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function now() {
  return FIXED_NOW ? Date.parse(FIXED_NOW) : Date.now();
}

function redact(message) {
  if (!CMC_API_KEY) return message;
  return String(message).split(CMC_API_KEY).join('[REDACTED]');
}

// ---------------------------------------------------------------------------
// holdings.json (re-read on every request)
// ---------------------------------------------------------------------------
function loadHoldingsRaw() {
  const raw = fs.readFileSync(HOLDINGS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.holdings)) {
    throw new Error('holdings.json must contain a "holdings" array');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
const cache = {
  demoMode: false,
  cmc: {}, // id (string) -> { price, change24h, symbol, name }
  cmcLastGoodAt: null,
  cmcStale: false,
  dex: {}, // mint -> { price }
  dexLastGoodAt: null,
  dexStale: false,
  lastAttemptAt: null,
  warnings: [],
  inFlight: null,
};

const startupWarnings = [];

function uniq(arr) {
  return [...new Set(arr)];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (Node 18+ global fetch) with timeout + JSON parsing
// ---------------------------------------------------------------------------
async function fetchJson(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('request timed out');
      throw new Error(`network error: ${e.message}`);
    }
    const text = await res.text();
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('malformed JSON response');
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// CoinMarketCap
// ---------------------------------------------------------------------------
async function fetchCmcQuotes(ids) {
  const url = `${CMC_BASE_URL}/v2/cryptocurrency/quotes/latest?convert=USD&id=${ids.join(',')}`;
  const json = await fetchJson(url, { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, UPSTREAM_TIMEOUT_MS);
  const raw = json && json.data;
  if (!raw || typeof raw !== 'object') return {};
  const result = {};
  for (const idStr of Object.keys(raw)) {
    const entry = raw[idStr];
    const q = Array.isArray(entry) ? entry[0] : entry;
    if (!q || !q.quote || !q.quote.USD) continue;
    const price = q.quote.USD.price;
    if (price == null) continue;
    result[idStr] = {
      price,
      change24h: q.quote.USD.percent_change_24h ?? null,
      symbol: q.symbol,
      name: q.name,
    };
  }
  return result;
}

async function fetchCmcMap(ids) {
  const url = `${CMC_BASE_URL}/v1/cryptocurrency/map?id=${ids.join(',')}`;
  const json = await fetchJson(url, { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, UPSTREAM_TIMEOUT_MS);
  return Array.isArray(json && json.data) ? json.data : [];
}

async function verifyIdsAtStartup(holdingsList) {
  if (!CMC_API_KEY) return;
  const withIds = holdingsList.filter((h) => h.cmcId != null);
  if (!withIds.length) return;
  const ids = uniq(withIds.map((h) => h.cmcId));
  let mapEntries;
  try {
    mapEntries = await fetchCmcMap(ids);
  } catch (e) {
    console.warn(`[startup] could not verify CMC ids via /v1/cryptocurrency/map: ${redact(e.message)}`);
    return;
  }
  const byId = new Map(mapEntries.map((e) => [String(e.id), e]));
  for (const h of withIds) {
    const entry = byId.get(String(h.cmcId));
    if (!entry) {
      const msg = `CMC id ${h.cmcId} for ${h.symbol} was not found via /v1/cryptocurrency/map`;
      console.warn(`[startup] ${msg}`);
      startupWarnings.push(msg);
      continue;
    }
    if (entry.symbol !== h.symbol || entry.name !== h.name) {
      const msg = `CMC id ${h.cmcId} resolves to ${entry.symbol}/${entry.name}, but holdings.json expects ${h.symbol}/${h.name}`;
      console.warn(`[startup] ${msg}`);
      startupWarnings.push(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// DexScreener
// ---------------------------------------------------------------------------
async function fetchDexPairs(mints) {
  const chunks = chunk(mints, 30);
  const allPairs = [];
  for (const c of chunks) {
    const url = `${DEXSCREENER_BASE_URL}/latest/dex/tokens/${c.join(',')}`;
    const json = await fetchJson(url, {}, UPSTREAM_TIMEOUT_MS);
    if (json && Array.isArray(json.pairs)) allPairs.push(...json.pairs);
  }
  return allPairs;
}

async function fetchDex(mints, minLiquidityUsd) {
  const pairs = await fetchDexPairs(mints);
  const result = {};
  for (const mint of mints) {
    const candidates = pairs.filter(
      (p) => p.baseToken && typeof p.baseToken.address === 'string' && p.baseToken.address.toLowerCase() === mint.toLowerCase()
    );
    const qualifying = candidates.filter(
      (p) => p.liquidity && typeof p.liquidity.usd === 'number' && p.liquidity.usd >= minLiquidityUsd
    );
    if (!qualifying.length) continue;
    qualifying.sort((a, b) => b.liquidity.usd - a.liquidity.usd);
    const price = parseFloat(qualifying[0].priceUsd);
    if (Number.isFinite(price)) result[mint] = { price };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Refresh (lazy, TTL-gated, coalesced)
// ---------------------------------------------------------------------------
async function doRefresh() {
  cache.lastAttemptAt = now();
  const warnings = [];

  let parsed;
  try {
    parsed = loadHoldingsRaw();
  } catch (e) {
    cache.warnings = [`holdings.json is invalid: ${e.message}`];
    return;
  }
  const holdingsList = parsed.holdings;
  const minLiquidityUsd = MIN_LIQUIDITY_USD_ENV ?? parsed.minLiquidityUsd ?? 1000;

  if (!CMC_API_KEY) {
    cache.demoMode = true;
    cache.warnings = ['Demo mode: no CMC_API_KEY configured. All prices are manual fallbacks.'];
    return;
  }
  cache.demoMode = false;

  const cmcIds = uniq(holdingsList.filter((h) => h.cmcId != null).map((h) => h.cmcId));
  if (cmcIds.length) {
    try {
      const data = await fetchCmcQuotes(cmcIds);
      cache.cmc = data;
      cache.cmcLastGoodAt = now();
      cache.cmcStale = false;
    } catch (e) {
      cache.cmcStale = cache.cmcLastGoodAt != null;
      warnings.push(
        `CoinMarketCap refresh failed (${redact(e.message)}); ${
          cache.cmcLastGoodAt
            ? 'serving last known CMC prices, marked stale.'
            : 'no cached CMC prices available yet, falling back to manual/Dex prices.'
        }`
      );
    }
  }

  const mints = uniq(
    holdingsList
      .filter((h) => h.mint && !(h.cmcId != null && cache.cmc[String(h.cmcId)] && cache.cmc[String(h.cmcId)].price != null))
      .map((h) => h.mint)
  );
  if (mints.length) {
    try {
      const data = await fetchDex(mints, minLiquidityUsd);
      cache.dex = { ...cache.dex, ...data };
      cache.dexLastGoodAt = now();
      cache.dexStale = false;
    } catch (e) {
      cache.dexStale = cache.dexLastGoodAt != null;
      warnings.push(
        `DexScreener refresh failed (${redact(e.message)}); ${
          cache.dexLastGoodAt ? 'serving last known Dex prices, marked stale.' : 'no cached Dex prices available yet, falling back to manual prices.'
        }`
      );
    }
  }

  cache.warnings = warnings;

  // Append a history point using the freshly refreshed cache.
  try {
    const portfolio = buildPortfolio(holdingsList);
    appendHistory({
      t: now(),
      value: portfolio.totals.value,
      cost: portfolio.totals.cost,
      pnl: portfolio.totals.pnl,
    });
  } catch (e) {
    console.warn(`[history] failed to append history point: ${redact(e.message)}`);
  }
}

function ensureFresh() {
  if (cache.inFlight) return cache.inFlight;
  const nowMs = now();
  if (cache.lastAttemptAt !== null && nowMs - cache.lastAttemptAt < REFRESH_SECONDS * 1000) {
    return Promise.resolve();
  }
  const p = doRefresh();
  cache.inFlight = p.finally(() => {
    cache.inFlight = null;
  });
  return cache.inFlight;
}

// ---------------------------------------------------------------------------
// Portfolio construction
// ---------------------------------------------------------------------------
function computeCost(h) {
  if (h.cost == null) return { cost: null, costEstimated: false };
  if (typeof h.cost.usd === 'number') return { cost: h.cost.usd, costEstimated: false };
  if (typeof h.cost.solSpent === 'number' && typeof h.cost.solPriceUsd === 'number') {
    return { cost: h.cost.solSpent * h.cost.solPriceUsd, costEstimated: !!h.cost.estimated };
  }
  return { cost: null, costEstimated: false };
}

function resolvePrice(h) {
  if (cache.demoMode) {
    return {
      price: h.fallbackPriceUsd != null ? h.fallbackPriceUsd : null,
      source: h.fallbackPriceUsd != null ? 'manual' : null,
      status: h.fallbackPriceUsd != null ? 'manual' : null,
      change24h: null,
    };
  }
  if (h.cmcId != null) {
    const d = cache.cmc[String(h.cmcId)];
    if (d && d.price != null) {
      return { price: d.price, source: 'cmc', status: cache.cmcStale ? 'stale' : 'live', change24h: d.change24h };
    }
  }
  if (h.mint) {
    const d = cache.dex[h.mint];
    if (d && d.price != null) {
      return { price: d.price, source: 'dex', status: cache.dexStale ? 'stale' : 'live', change24h: null };
    }
  }
  if (h.fallbackPriceUsd != null) {
    return { price: h.fallbackPriceUsd, source: 'manual', status: 'manual', change24h: null };
  }
  return { price: null, source: null, status: null, change24h: null };
}

function buildRow(h) {
  const { price, source, status, change24h } = resolvePrice(h);
  const value = price != null ? price * h.amount : null;
  const { cost, costEstimated } = computeCost(h);
  const pnl = cost != null && value != null ? value - cost : null;
  const pnlPct = pnl != null && cost !== 0 ? (pnl / cost) * 100 : null;
  return {
    symbol: h.symbol,
    name: h.name,
    platform: h.platform,
    amount: h.amount,
    price,
    priceSource: source,
    priceStatus: status,
    change24h,
    value,
    cost,
    costEstimated,
    pnl,
    pnlPct,
    weight: 0,
  };
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function overallMode() {
  if (cache.demoMode) return 'demo';
  if (cache.cmcStale || cache.dexStale) return 'stale';
  return 'live';
}

function buildPortfolio(holdingsList) {
  const rows = holdingsList.map(buildRow);
  const totalValue = sum(rows.map((r) => r.value ?? 0));
  for (const r of rows) {
    r.weight = totalValue > 0 && r.value != null ? r.value / totalValue : 0;
  }
  const knownCostRows = rows.filter((r) => r.cost != null);
  const totalCost = sum(knownCostRows.map((r) => r.cost));
  const totalPnl = sum(knownCostRows.map((r) => r.pnl));
  const totalPnlPct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : null;
  const knownCostValue = sum(knownCostRows.map((r) => r.value ?? 0));
  const valueWithoutCost = totalValue - knownCostValue;
  const coverage = totalValue > 0 ? knownCostValue / totalValue : 0;

  return {
    generatedAt: now(),
    mode: overallMode(),
    demoMode: cache.demoMode,
    lastUpdated: cache.lastAttemptAt,
    warnings: [...startupWarnings, ...cache.warnings],
    rows,
    totals: {
      value: totalValue,
      cost: totalCost,
      pnl: totalPnl,
      pnlPct: totalPnlPct,
      valueWithoutCost,
      coverage,
    },
  };
}

// ---------------------------------------------------------------------------
// history.json (append-only, capped, atomic writes)
// ---------------------------------------------------------------------------
function historyPath() {
  return path.join(DATA_DIR, 'history.json');
}

function loadHistory() {
  let raw;
  try {
    raw = fs.readFileSync(historyPath(), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendHistory(point) {
  const hist = loadHistory();
  hist.push(point);
  const capped = hist.length > HISTORY_CAP ? hist.slice(hist.length - HISTORY_CAP) : hist;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.history.json.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, JSON.stringify(capped));
  fs.renameSync(tmp, historyPath());
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/portfolio') {
    ensureFresh()
      .then(() => {
        let parsed;
        try {
          parsed = loadHoldingsRaw();
        } catch (e) {
          sendJson(res, 200, {
            generatedAt: now(),
            mode: 'error',
            demoMode: cache.demoMode,
            lastUpdated: cache.lastAttemptAt,
            warnings: [...startupWarnings, `holdings.json is invalid: ${e.message}`],
            rows: [],
            totals: { value: 0, cost: 0, pnl: 0, pnlPct: null, valueWithoutCost: 0, coverage: 0 },
          });
          return;
        }
        const portfolio = buildPortfolio(parsed.holdings);
        sendJson(res, 200, portfolio);
      })
      .catch((e) => {
        sendJson(res, 500, { error: redact(e.message) });
      });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    sendJson(res, 200, { points: loadHistory() });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

async function start() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const parsed = loadHoldingsRaw();
    await verifyIdsAtStartup(parsed.holdings);
  } catch (e) {
    console.warn(`[startup] ${e.message}`);
  }
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`crypto-portfolio-dashboard listening on http://127.0.0.1:${PORT} (demo=${!CMC_API_KEY})`);
  });
}

start();

module.exports = { server };

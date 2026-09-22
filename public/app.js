(function () {
  'use strict';

  var state = {
    rows: [],
    totals: null,
    sortKey: 'value',
    sortDir: 'desc',
    platform: '',
    history: [],
  };

  function fmtUsd(n, opts) {
    if (n == null || !isFinite(n)) return '—';
    opts = opts || {};
    var abs = Math.abs(n);
    var digits = opts.digits;
    if (digits == null) {
      digits = abs !== 0 && abs < 1 ? 6 : 2;
    }
    return (n < 0 ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtPct(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAmount(n) {
    if (n == null) return '—';
    var abs = Math.abs(n);
    var digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }

  function pnlClass(n) {
    if (n == null) return 'flat';
    return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  }

  function setStatusPill(mode) {
    var pill = document.getElementById('statusPill');
    var text = document.getElementById('statusText');
    pill.className = 'pill ' + (mode || 'live');
    var labels = { live: 'Live', stale: 'Stale', demo: 'Demo', error: 'Error' };
    text.textContent = labels[mode] || mode;
  }

  function renderSummary(totals, mode) {
    document.getElementById('statValue').textContent = fmtUsd(totals.value);
    document.getElementById('statCost').textContent = fmtUsd(totals.cost);
    var pnlEl = document.getElementById('statPnl');
    pnlEl.textContent = fmtUsd(totals.pnl);
    pnlEl.className = 'value ' + pnlClass(totals.pnl);
    document.getElementById('statPnlPct').textContent = totals.pnlPct != null ? fmtPct(totals.pnlPct) : 'no known-cost rows';
    document.getElementById('statCoverage').textContent = (totals.coverage * 100).toFixed(1) + '%';
  }

  function renderWarnings(warnings) {
    var el = document.getElementById('warnings');
    el.innerHTML = '';
    (warnings || []).forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'warning-item';
      d.textContent = w;
      el.appendChild(d);
    });
  }

  function populatePlatformFilter(rows) {
    var sel = document.getElementById('platformFilter');
    var existing = new Set(Array.from(sel.options).map(function (o) { return o.value; }));
    var platforms = Array.from(new Set(rows.map(function (r) { return r.platform; }))).sort();
    platforms.forEach(function (p) {
      if (!existing.has(p)) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
      }
    });
  }

  function sortRows(rows) {
    var key = state.sortKey, dir = state.sortDir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderTable() {
    var tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    var rows = state.rows.filter(function (r) { return !state.platform || r.platform === state.platform; });
    rows = sortRows(rows);
    rows.forEach(function (r) {
      var tr = document.createElement('tr');

      var priceBadges = '';
      if (r.priceStatus === 'manual') priceBadges += '<span class="badge manual">manual</span>';
      if (r.priceStatus === 'stale') priceBadges += '<span class="badge stale">stale</span>';
      var costBadge = r.costEstimated ? '<span class="badge est">est</span>' : (r.cost == null ? '<span class="badge manual">no cost</span>' : '');

      tr.innerHTML =
        '<td><span class="sym">' + esc(r.symbol) + '</span><div style="color:var(--text-dim);font-size:10.5px;">' + esc(r.name) + '</div></td>' +
        '<td><span class="platform-tag">' + esc(r.platform) + '</span></td>' +
        '<td>' + esc(r.priceSource || '—') + priceBadges + '</td>' +
        '<td class="num">' + fmtUsd(r.price) + '</td>' +
        '<td class="num ' + pnlClass(r.change24h) + '">' + fmtPct(r.change24h) + '</td>' +
        '<td class="num">' + fmtAmount(r.amount) + '</td>' +
        '<td class="num">' + fmtUsd(r.value) + '</td>' +
        '<td class="num">' + fmtUsd(r.cost) + costBadge + '</td>' +
        '<td class="num ' + pnlClass(r.pnl) + '">' + fmtUsd(r.pnl) + '</td>' +
        '<td class="num ' + pnlClass(r.pnlPct) + '">' + fmtPct(r.pnlPct) + '</td>' +
        '<td class="num">' + (r.weight != null ? (r.weight * 100).toFixed(1) + '%' : '—') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.querySelectorAll('#holdingsTable thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-key');
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'desc';
      }
      document.querySelectorAll('#holdingsTable thead .arrow').forEach(function (a) { a.textContent = ''; });
      th.querySelector('.arrow').textContent = state.sortDir === 'asc' ? '▲' : '▼';
      renderTable();
    });
  });

  document.getElementById('platformFilter').addEventListener('change', function (e) {
    state.platform = e.target.value;
    renderTable();
  });

  function renderChart() {
    var wrap = document.getElementById('chartWrap');
    var points = state.history;
    if (!points || points.length < 2) {
      wrap.innerHTML = '<div class="chart-empty">Not enough history yet.</div>';
      return;
    }
    var w = 1000, h = 220, padX = 10, padY = 16;
    var pnls = points.map(function (p) { return p.pnl == null ? 0 : p.pnl; });
    var min = Math.min.apply(null, pnls), max = Math.max.apply(null, pnls);
    if (min === max) { min -= 1; max += 1; }
    var ts = points.map(function (p) { return p.t; });
    var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
    if (tMin === tMax) tMax = tMin + 1;

    function xFor(t) { return padX + ((t - tMin) / (tMax - tMin)) * (w - padX * 2); }
    function yFor(v) { return h - padY - ((v - min) / (max - min)) * (h - padY * 2); }

    var d = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xFor(p.t).toFixed(2) + ',' + yFor(p.pnl == null ? 0 : p.pnl).toFixed(2);
    }).join(' ');

    var zeroY = yFor(0).toFixed(2);
    var lineColor = pnls[pnls.length - 1] >= 0 ? 'var(--green)' : 'var(--red)';

    var svg = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Accumulated profit and loss over time">' +
      '<line x1="0" y1="' + zeroY + '" x2="' + w + '" y2="' + zeroY + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 4" />' +
      '<path d="' + d + '" fill="none" stroke="' + lineColor + '" stroke-width="2" />' +
      '</svg>';
    wrap.innerHTML = svg;

    var svgEl = wrap.querySelector('svg');
    var tooltip = null;

    svgEl.addEventListener('mousemove', function (evt) {
      var rect = svgEl.getBoundingClientRect();
      var relX = (evt.clientX - rect.left) / rect.width * w;
      var closest = points[0], closestDist = Infinity;
      points.forEach(function (p) {
        var dist = Math.abs(xFor(p.t) - relX);
        if (dist < closestDist) { closestDist = dist; closest = p; }
      });
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        wrap.appendChild(tooltip);
      }
      tooltip.style.left = ((xFor(closest.t) / w) * rect.width) + 'px';
      tooltip.style.top = ((yFor(closest.pnl == null ? 0 : closest.pnl) / h) * rect.height) + 'px';
      tooltip.textContent = new Date(closest.t).toLocaleString() + '  P/L ' + fmtUsd(closest.pnl);
    });
    svgEl.addEventListener('mouseleave', function () {
      if (tooltip) { tooltip.remove(); tooltip = null; }
    });
  }

  async function loadPortfolio() {
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      state.rows = data.rows || [];
      state.totals = data.totals;
      populatePlatformFilter(state.rows);
      renderSummary(data.totals, data.mode);
      renderWarnings(data.warnings);
      setStatusPill(data.mode);
      const lu = document.getElementById('lastUpdated');
      lu.textContent = data.lastUpdated ? 'updated ' + new Date(data.lastUpdated).toLocaleTimeString() : '';
      renderTable();
    } catch (e) {
      setStatusPill('error');
      renderWarnings(['Failed to load portfolio: ' + e.message]);
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      state.history = data.points || [];
      renderChart();
    } catch {
      // The chart is secondary to the table, so a history failure leaves the
      // last drawn chart in place rather than surfacing a warning.
    }
  }

  function poll() {
    loadPortfolio();
    loadHistory();
  }

  let pollTimer = null;

  function startPolling() {
    if (pollTimer !== null) return;
    pollTimer = setInterval(poll, 15000);
  }

  function stopPolling() {
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
      return;
    }
    poll();
    startPolling();
  });

  poll();
  startPolling();
})();

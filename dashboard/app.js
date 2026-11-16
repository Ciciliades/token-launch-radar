// Token Launch Radar dashboard. It reads window.TOKEN_RADAR (written beside dashboard/ by
// main.ts) and renders the ranked candidates, the live-token comparables, the set-aside
// products, a per-protocol detail drawer, and a model sandbox that re-ranks the board live.
// No network: every byte it shows comes from the snapshot data beside it.
(function () {
  'use strict';

  var DATA = window.TOKEN_RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) {
    if (app) app.textContent = 'No snapshot data found beside this dashboard.';
    return;
  }

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchOnly: false,
    tab: 'candidates',
    sort: 'rank',
    dir: 1,
    selected: null,
    sandbox: null,
    sandboxActive: false
  };

  function calibratedParams() {
    var m = DATA.model;
    return {
      multiple: DATA.calibration.multiple,
      growth_weight: m.growth_weight,
      growth_floor: m.growth_floor,
      growth_cap: m.growth_cap,
      maturity_floor: m.maturity_floor,
      maturity_range: m.maturity_range,
      maturity_days: m.maturity_days,
      unknown_age_days: m.unknown_age_days,
      breadth_weight: m.breadth_weight,
      breadth_cap_chains: m.breadth_cap_chains
    };
  }

  // The model in one function, mirroring lib/model.ts exactly: the page recomputes a row
  // from the snapshot figures, so the page and the board visibly run the same arithmetic.
  function multipliersOf(row, p) {
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(p.growth_cap, Math.max(p.growth_floor, raw));
    var growthMult = 1 + (growth / 100) * p.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? p.unknown_age_days : row.age_days;
    var maturity = p.maturity_floor + (Math.min(Math.max(age, 0), p.maturity_days) / p.maturity_days) * p.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), p.breadth_cap_chains - 1);
    var breadth = 1 + extra * p.breadth_weight;
    return { growthMult: growthMult, maturity: maturity, breadth: breadth, growthPct: growth, age: age };
  }
  function impliedOf(row, p) {
    var m = multipliersOf(row, p);
    return Math.max(1, Math.round(row.tvl_usd * p.multiple * m.growthMult * m.maturity * m.breadth));
  }
  function effectiveParams() {
    return state.sandboxActive && state.sandbox ? state.sandbox : calibratedParams();
  }

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtRatio(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'candidates') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function haystack(r) {
    return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
  }
  function filtered(list, applyWatch) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (applyWatch && state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && haystack(r).indexOf(q) < 0) return false;
      return true;
    });
  }
  function cmpNum(a, b, dir) {
    var an = a === null || a === undefined;
    var bn = b === null || b === undefined;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (a < b) return -dir;
    if (a > b) return dir;
    return 0;
  }
  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var c = 0;
      if (key === 'name') {
        var an = a.name.toLowerCase();
        var bn = b.name.toLowerCase();
        c = an < bn ? -dir : an > bn ? dir : 0;
      } else if (key === 'tvl') c = cmpNum(a.tvl_usd, b.tvl_usd, dir);
      else if (key === 'growth') c = cmpNum(a.change_7d, b.change_7d, dir);
      else if (key === 'age') c = cmpNum(a.age_days, b.age_days, dir);
      else if (key === 'implied') c = cmpNum(a.effectiveImplied, b.effectiveImplied, dir);
      else c = cmpNum(a.effectiveRank, b.effectiveRank, dir);
      if (c !== 0) return c;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  // Candidates with effective values: the sandbox recomputes implied value and rank live.
  // Ranks are computed over the whole board first, so a filtered view keeps each row's
  // global rank instead of re-numbering the filtered list.
  function candidateRows() {
    var p = effectiveParams();
    var ranked = DATA.rows.map(function (r) {
      return { row: r, implied: state.sandboxActive ? impliedOf(r, p) : r.implied_value_usd };
    });
    ranked.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
    var bySlug = {};
    ranked.forEach(function (item, i) { bySlug[item.row.slug] = { implied: item.implied, rank: i + 1 }; });
    var list = filtered(DATA.rows, true).map(function (r) {
      var eff = bySlug[r.slug];
      return {
        rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
        tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days,
        implied_value_usd: r.implied_value_usd, effectiveImplied: eff.implied,
        effectiveRank: eff.rank, watchlist: r.watchlist, farm_steps: r.farm_steps,
        growth_multiplier: r.growth_multiplier, maturity_multiplier: r.maturity_multiplier,
        breadth_multiplier: r.breadth_multiplier
      };
    });
    return sortRows(list);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'TOKEN LAUNCH RADAR' }), ' ', el('span', { text: 'pre-token protocols, ranked' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var totalTvl = DATA.rows.reduce(function (n, r) { return n + r.tvl_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds ' + DATA.early_size + ' more launch candidates below and above that floor, and sets aside wrapped, bridged and exchange products that will never launch a token of their own. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Candidates ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Candidate TVL tracked' }), el('b', { text: fmtUsd(totalTvl) })),
        el('div', { class: 'fact' }, el('span', { text: 'Calibrated multiple' }), el('b', { text: DATA.calibration.multiple.toFixed(3) + ' (n=' + DATA.calibration.protocols + ')' })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside / live token' }), el('b', { text: DATA.set_aside_size + ' / ' + DATA.live_size }))
      )
    );
  }

  var countLabel = null;
  var tabButtons = {};
  var sandboxValueLabels = {};
  var formulaNode = null;

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); update(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c }); })
    );
    catSelect.value = state.category;
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); update(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c }); })
    );
    chainSelect.value = state.chain;
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); update(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); update(); });
    function tabBtn(key, label) {
      var b = el('button', { type: 'button', text: label, onclick: function () { state.tab = key; writeHash(); update(); } });
      tabButtons[key] = b;
      return b;
    }
    countLabel = el('span', { class: 'count', text: '' });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'View' }),
        el('div', { class: 'tabs' }, tabBtn('candidates', 'Candidates'), tabBtn('live', 'Live token'), tabBtn('setaside', 'Set aside'))),
      countLabel
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = (key === 'rank' || key === 'name') ? 1 : -1; }
        update();
      } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function protocolCell(r, pill) {
    var chains = (r.chains && r.chains.length) ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain';
    return el('td', null, el('div', { class: 'name' },
      el('div', { class: 'rowline' }, el('b', { text: r.name }), pill),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains })
    ));
  }
  function growthCell(r) {
    var cls = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return el('td', { class: 'num ' + cls, text: fmtPct(r.change_7d) });
  }

  function boardTable() {
    var list = candidateRows();
    if (list.length === 0) return emptyPanel('No candidate matches that filter', 'Clear the search or pick another category or chain to see the board again.');
    var max = list.reduce(function (n, r) { return Math.max(n, r.effectiveImplied); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var pill = r.watchlist
        ? el('span', { class: 'pill pill-watch', text: 'WATCHLIST' })
        : el('span', { class: 'pill pill-early', text: 'EARLY' });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.effectiveRank) }),
        protocolCell(r, pill),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.effectiveImplied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.effectiveImplied) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: state.sandboxActive ? 'Sandbox values: the board re-ranked with your model settings. Select a row for its model and farm plan.' : 'Launch candidates, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = filtered(DATA.live, false);
    if (list.length === 0) return emptyPanel('No live-token protocol matches that filter', 'Clear the search or pick another category or chain.');
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', { style: 'cursor:default' },
        protocolCell(r, el('span', { class: 'pill pill-live', text: 'TRADES' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtRatio(r.mcap_tvl_ratio) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Already trading, ordered by market cap: the market cap is a fact, not a model. The median of these ratios calibrates the board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function setAsideTable() {
    var list = filtered(DATA.set_aside, false);
    if (list.length === 0) return emptyPanel('No set-aside product matches that filter', 'Clear the search or pick another category or chain.');
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', { style: 'cursor:default' },
        protocolCell(r, el('span', { class: 'pill pill-aside', text: 'SET ASIDE' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'reason', text: r.reason }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token but not launch candidates, largest TVL first: wrapped, bridged, staked and exchange products, with the rule that set each one aside.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: 'Why it is set aside' })
          )),
          tbody
        )
      )
    );
  }

  function emptyPanel(title, body) {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: title }),
      el('p', { text: body }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false;
        var q = document.getElementById('q'); if (q) q.value = '';
        var c = document.getElementById('category'); if (c) c.value = 'all';
        var ch = document.getElementById('chain'); if (ch) ch.value = 'all';
        var w = document.getElementById('watch'); if (w) w.checked = false;
        writeHash(); update();
      } })
    ));
  }

  function formulaText(p) {
    return 'implied = round( tvl_usd x ' + p.multiple.toFixed(3) +
      ' x (1 + clamp(change_7d, ' + p.growth_floor + ', ' + p.growth_cap + ') / 100 x ' + p.growth_weight.toFixed(2) +
      ') x (' + p.maturity_floor.toFixed(2) + ' + min(age_days, ' + p.maturity_days + ') / ' + p.maturity_days + ' x ' + p.maturity_range.toFixed(2) +
      ') x (1 + min(chains - 1, ' + (p.breadth_cap_chains - 1) + ') x ' + p.breadth_weight.toFixed(3) + ') )';
  }

  function modelPanel() {
    var cal = DATA.calibration;
    formulaNode = el('div', { class: 'formula', text: formulaText(calibratedParams()) });
    function slider(key, label, min, max, step, decimals) {
      var valueLabel = el('b', { text: '' });
      sandboxValueLabels[key] = valueLabel;
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
      input.value = String(calibratedParams()[key]);
      input.addEventListener('input', function () {
        if (!state.sandbox) state.sandbox = calibratedParams();
        state.sandbox[key] = parseFloat(input.value);
        state.sandboxActive = true;
        writeHash(); update();
      });
      return el('div', { class: 'slider' }, el('label', null, el('span', { text: label }), valueLabel), input);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the calibrated model', onclick: function () {
      state.sandbox = null; state.sandboxActive = false;
      var sliders = document.querySelectorAll('.slider input[type="range"]');
      var base = calibratedParams();
      var keys = ['multiple', 'growth_weight', 'maturity_range', 'breadth_weight'];
      sliders.forEach(function (s, i) { s.value = String(base[keys[i]]); });
      writeHash(); update();
    } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every candidate is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The base multiple is not a guess: it is the median market-cap-to-TVL ratio of ' + cal.protocols + ' live-token protocols in this same snapshot (25th percentile ' + cal.p25.toFixed(3) + ', 75th percentile ' + cal.p75.toFixed(3) + '). Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + DATA.model.unknown_age_days + ' days.' }),
      formulaNode,
      el('h3', { text: 'Model sandbox' }),
      el('p', { class: 'sandbox-note', text: 'Move a slider to re-rank the board with your own settings. Sandbox changes stay on this page: the ranked board file always uses the calibrated model.' }),
      el('div', { class: 'sandbox' },
        slider('multiple', 'Base multiple', 0.05, 0.5, 0.005, 3),
        slider('growth_weight', 'Growth weight', 0, 1, 0.05, 2),
        slider('maturity_range', 'Maturity range', 0, 0.6, 0.05, 2),
        slider('breadth_weight', 'Breadth weight', 0, 0.08, 0.005, 3)
      ),
      el('div', { class: 'sandbox-actions' }, reset, el('span', { class: 'sandbox-note', text: 'Sandbox values are shown in the table while they differ from the calibrated model.' }))
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' from the DefiLlama protocol index. Model ' + DATA.model_version + ': calibrated multiple ' + DATA.calibration.multiple.toFixed(3) + ' from ' + DATA.calibration.protocols + ' live-token protocols.' }),
      el('span', { text: 'Implied value is an estimate from public figures, not a price, a promise or financial advice. No network: this page reads only the snapshot data beside it.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); update(); });

  function multRow(label, value, max) {
    var pct = Math.max(3, Math.min(100, Math.round((value / max) * 100)));
    return el('div', { class: 'mult-row' },
      el('span', { text: label }),
      el('div', { class: 'mult-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
      el('b', { text: value.toFixed(3) })
    );
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var p = effectiveParams();
    var m = multipliersOf(row, p);
    var eff = impliedOf(row, p);
    var check = impliedOf(row, calibratedParams());
    dialog.textContent = '';
    var chainsText = (row.chains && row.chains.length) ? row.chains.join(', ') : 'an unnamed chain';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '  ·  Early') + (state.sandboxActive ? '  ·  Sandbox' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainsText })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'metrics' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Listed' }), el('b', { text: row.listed_at || 'unknown' })),
        el('div', null, el('span', { text: state.sandboxActive ? 'Implied value (sandbox)' : 'Implied value' }), el('b', { text: fmtUsd(eff) }))
      ),
      el('div', { class: 'mult' },
        multRow('Base multiple', p.multiple, 0.5),
        multRow('Growth', m.growthMult, 1.5),
        multRow('Maturity', m.maturity, 1.05),
        multRow('Breadth', m.breadth, 1.15)
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every candidate. The page recomputes this row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same number the ranked board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    update();
  }

  var tableHost = null;
  var modelHost = null;

  function countText(n) {
    if (state.tab === 'candidates') return n + ' candidates shown' + (state.sandboxActive ? ' (sandbox)' : '');
    if (state.tab === 'live') return n + ' live-token protocols';
    return n + ' set-aside products';
  }

  function update() {
    Object.keys(tabButtons).forEach(function (k) {
      tabButtons[k].setAttribute('aria-pressed', state.tab === k ? 'true' : 'false');
    });
    var p = effectiveParams();
    if (formulaNode) formulaNode.textContent = formulaText(p);
    var base = calibratedParams();
    var decimals = { multiple: 3, growth_weight: 2, maturity_range: 2, breadth_weight: 3 };
    Object.keys(sandboxValueLabels).forEach(function (k) {
      sandboxValueLabels[k].textContent = p[k].toFixed(decimals[k]) + (state.sandboxActive && p[k] !== base[k] ? ' *' : '');
    });
    var table;
    var n;
    if (state.tab === 'candidates') {
      table = boardTable();
      n = candidateRows().length;
    } else if (state.tab === 'live') {
      table = liveTable();
      n = filtered(DATA.live, false).length;
    } else {
      table = setAsideTable();
      n = filtered(DATA.set_aside, false).length;
    }
    tableHost.textContent = '';
    tableHost.appendChild(table);
    if (countLabel) countLabel.textContent = countText(n);
    if (modelHost) modelHost.style.display = state.tab === 'candidates' ? '' : 'none';
    var selectedRow = state.selected;
    if (selectedRow && dialog.open) {
      var stillThere = false;
      DATA.rows.forEach(function (r) { if (r.slug === selectedRow) stillThere = true; });
      if (!stillThere) dialog.close();
    }
  }

  readHash();
  if (['candidates', 'live', 'setaside'].indexOf(state.tab) < 0) state.tab = 'candidates';
  var shell = el('div', { class: 'shell' });
  shell.appendChild(header());
  shell.appendChild(lede());
  shell.appendChild(controls());
  tableHost = el('div', null);
  shell.appendChild(tableHost);
  modelHost = modelPanel();
  shell.appendChild(modelHost);
  shell.appendChild(footer());
  app.appendChild(shell);
  app.appendChild(dialog);
  app.setAttribute('aria-busy', 'false');
  update();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

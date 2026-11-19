'use strict';
/* Token Radar dashboard: renders window.RADAR, no network, no fetch. */
const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v);
const fmtFull = (v) => '$' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtPct = (v) => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const fmtAge = (a) => a === null ? '—' : a >= 365 ? (a / 365).toFixed(1) + ' yrs' : a + 'd';
const fmtRatio3 = (r) => r.toFixed(3) + '×';
const logPos = (v, lo, hi) => {
  if (hi <= lo) return 100;
  return Math.max(6, ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100);
};
const rowBySlug = new Map(D.rows.map((r) => [r.slug, r]));
const multByCat = new Map(D.multiples.by_category.map((m) => [m.category, m]));
const multOf = (r) => multByCat.get(r.category ?? 'Uncategorized');

const state = { tab: 'board', sortKey: 'implied', sortDir: -1, search: '', cat: '', chain: '', watchOnly: false, pins: new Set(), compare: new Set(), drawerSlug: null, dtab: 'model' };
const boardMin = Math.min(...D.rows.map((r) => r.implied_value_usd));
const boardMax = Math.max(...D.rows.map((r) => r.implied_value_usd));

/* ---------- header, stats, strip ---------- */
$('pill-model').textContent = 'Model ' + D.model_version;
$('pill-asof').textContent = 'Snapshot ' + D.as_of;
$('pill-source').textContent = D.source.replace(/^DefiLlama\s*/, '');
$('stats').innerHTML = [
  ['<b>' + D.watchlist_size + '/' + D.watchlist_size + '</b>', 'watchlist protocols covered'],
  ['<b>' + D.board_size + '</b>', 'rows on the board (' + D.watchlist_size + ' watchlist + ' + D.early_size + ' early)'],
  ['<b>' + D.live_size + '</b>', 'live-token comparables'],
  ['<b>' + D.multiples.global_median.toFixed(3) + '×</b>', 'global median mcap / TVL'],
].map((s) => '<div class="stat">' + s[0] + '<span>' + s[1] + '</span></div>').join('');

(function strip() {
  const totals = new Map();
  for (const r of D.rows) totals.set(r.category ?? 'Uncategorized', (totals.get(r.category ?? 'Uncategorized') || 0) + r.implied_value_usd);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const lo = Math.min(...top.map((t) => t[1])), hi = Math.max(...top.map((t) => t[1]));
  $('strip').innerHTML = top.map((t) => {
    const m = multByCat.get(t[0]);
    return '<div class="strip-item"><b>' + esc(t[0]) + '</b><span class="tot">' + fmtMoney(t[1]) + '</span><br><span class="mult">multiple ' + (m ? m.multiple.toFixed(4) + '×' : '—') + '</span><div class="bar"><i style="width:' + logPos(t[1], lo, hi).toFixed(1) + '%"></i></div></div>';
  }).join('');
})();

/* ---------- filters ---------- */
(function fillFilters() {
  const cats = [...new Set(D.rows.map((r) => r.category ?? 'Uncategorized'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  $('filter-cat').innerHTML += cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  $('filter-chain').innerHTML += chains.map((c) => '<option>' + esc(c) + '</option>').join('');
})();

function sortValue(r) {
  if (state.sortKey === 'tvl') return r.tvl_usd;
  if (state.sortKey === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
  if (state.sortKey === 'age') return r.age_days === null ? -1 : r.age_days;
  if (state.sortKey === 'name') return r.name.toLowerCase();
  return r.implied_value_usd;
}
function sortRows(list) {
  const dir = state.sortDir;
  return [...list].sort((a, b) => {
    const va = sortValue(a), vb = sortValue(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c !== 0 ? c * dir : a.rank - b.rank;
  });
}
function filtered() {
  const q = state.search.trim().toLowerCase();
  return D.rows.filter((r) => {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.cat && (r.category ?? 'Uncategorized') !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || r.chains.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });
}
/** The current view: filtered, sorted, pins kept on top. */
function currentView() {
  const sorted = sortRows(filtered());
  return [...sorted.filter((r) => state.pins.has(r.slug)), ...sorted.filter((r) => !state.pins.has(r.slug))];
}

/* ---------- board table ---------- */
function renderBoard() {
  const view = currentView();
  const pinned = view.filter((r) => state.pins.has(r.slug));
  let html = '';
  const rowHtml = (r) => {
    const pinnedCls = state.pins.has(r.slug) ? ' class="pinned-row"' : '';
    const changeCls = r.change_7d === null ? '' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '';
    const tags = (r.watchlist ? '<span class="tag watch">Watchlist</span>' : '') + (state.pins.has(r.slug) ? '<span class="tag pin">Pinned</span>' : '');
    return '<tr data-slug="' + esc(r.slug) + '"' + pinnedCls + '><td>' + r.rank + '</td>' +
      '<td><button type="button" class="pin-btn' + (state.pins.has(r.slug) ? ' on' : '') + '" title="Pin this row">' + (state.pins.has(r.slug) ? '★' : '☆') + '</button></td>' +
      '<td><input type="checkbox" class="cmp" ' + (state.compare.has(r.slug) ? 'checked' : '') + ' aria-label="Compare ' + esc(r.name) + '"></td>' +
      '<td><b>' + esc(r.name) + '</b>' + tags + '<br><span class="sub">' + esc(r.category ?? 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || '—') + '</span></td>' +
      '<td>' + fmtMoney(r.tvl_usd) + '</td>' +
      '<td class="' + changeCls + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td>' + fmtAge(r.age_days) + '</td>' +
      '<td><b>' + fmtMoney(r.implied_value_usd) + '</b><div class="mini-bar"><i style="width:' + logPos(r.implied_value_usd, boardMin, boardMax).toFixed(1) + '%"></i></div></td>' +
      '<td>' + esc(r.token_status) + '</td></tr>';
  };
  if (pinned.length > 0) {
    html += '<tr><td colspan="9"><b>Pinned — kept on top</b> (' + pinned.length + ')</td></tr>';
    html += pinned.map(rowHtml).join('');
    if (view.length > pinned.length) html += '<tr><td colspan="9"><b>All rows</b></td></tr>';
  }
  html += view.filter((r) => !state.pins.has(r.slug)).map(rowHtml).join('');
  $('rows').innerHTML = html || '<tr><td colspan="9">No rows match the filters.</td></tr>';
  $('count').textContent = 'Showing ' + view.length + ' of ' + D.board_size + ' rows' + (state.pins.size ? ' · ' + state.pins.size + ' pinned' : '');
  $('pin-count').textContent = state.pins.size ? state.pins.size + ' pinned' : '';
  $('compare-btn').disabled = state.compare.size < 2;
  $('compare-btn').textContent = 'Compare' + (state.compare.size ? ' (' + state.compare.size + ')' : '');
}

$('rows').addEventListener('click', (e) => {
  const pinBtn = e.target.closest('.pin-btn');
  const tr = e.target.closest('tr[data-slug]');
  if (!tr) return;
  if (pinBtn) {
    const slug = tr.dataset.slug;
    if (state.pins.has(slug)) state.pins.delete(slug); else state.pins.add(slug);
    renderBoard();
    return;
  }
  if (e.target.closest('.cmp')) return;
  openDrawer(tr.dataset.slug);
});
$('rows').addEventListener('change', (e) => {
  const box = e.target.closest('.cmp');
  if (!box) return;
  const slug = box.closest('tr').dataset.slug;
  if (box.checked) {
    if (state.compare.size >= 3) { box.checked = false; $('compare-btn').textContent = 'Compare (max 3)'; return; }
    state.compare.add(slug);
  } else state.compare.delete(slug);
  renderBoard();
});

document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.sort === 'rank' ? 'implied' : th.dataset.sort;
  if (state.sortKey === key) state.sortDir *= -1;
  else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
  $('sort').value = state.sortKey;
  renderBoard();
}));
$('sort').addEventListener('change', (e) => { state.sortKey = e.target.value; state.sortDir = state.sortKey === 'name' ? 1 : -1; renderBoard(); });
$('search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
$('filter-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('filter-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('filter-watch').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderBoard(); });

/* ---------- CSV export ---------- */
const csvCell = (v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function exportCsv() {
  const lines = ['rank,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,watchlist,pinned'];
  for (const r of currentView()) lines.push([r.rank, csvCell(r.name), csvCell(r.category ?? ''), csvCell(r.chains.join(';')), r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.implied_value_usd, r.watchlist ? 'yes' : 'no', state.pins.has(r.slug) ? 'yes' : 'no'].join(','));
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'token-radar-board.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
$('export-btn').addEventListener('click', exportCsv);

/* ---------- live tab ---------- */
$('live-rows').innerHTML = D.live.map((p, i) => '<tr><td>' + (i + 1) + '</td><td><b>' + esc(p.name) + '</b><br><span class="sub">' + esc(p.category ?? 'Uncategorized') + ' · ' + esc(p.chains.join(', ') || '—') + '</span></td><td>' + fmtMoney(p.tvl_usd) + '</td><td>' + fmtFull(p.mcap_usd) + '</td><td>' + fmtRatio3(p.ratio) + '</td></tr>').join('');

/* ---------- methodology ---------- */
(function method() {
  const m = D.model;
  $('method-body').innerHTML =
    '<p><b>Implied value = TVL × category multiple × growth multiplier × maturity multiplier × chain multiplier.</b> ' +
    'Every row is scored by the same formula; no protocol name is ever special-cased.</p>' +
    '<p><b>Category multiple.</b> For each category, the median market-cap/TVL ratio of its live tokens, shrunk toward the global median of ' + D.multiples.global_median.toFixed(4) + '× with a prior of ' + m.shrink_prior + ': (n × median + ' + m.shrink_prior + ' × global) / (n + ' + m.shrink_prior + '), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. A category needs at least ' + m.min_live_for_category + ' live tokens to earn its own multiple; with fewer, it borrows the global median.</p>' +
    '<p><b>Growth.</b> The 7-day TVL change, clamped to [' + m.growth_floor + ', ' + m.growth_cap + ']%, feeds 1 + (growth / 100) × ' + m.growth_weight + '.</p>' +
    '<p><b>Maturity.</b> ' + m.maturity_floor + ' + min(age in days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '. A protocol with no listing date is treated as ' + m.unknown_age_days + ' days old.</p>' +
    '<p><b>Chains.</b> 1 + min(chains − 1, ' + (m.chain_max_counted - 1) + ') × ' + m.chain_step + ' (at most 1.08). The implied value is rounded to the nearest dollar, at least ' + fmtFull(m.implied_min) + ' and at most ' + fmtFull(m.implied_max) + '.</p>' +
    '<p><b>Coverage.</b> The board ranks the whole watchlist (' + D.watchlist_size + ' protocols at or above the ' + fmtFull(D.floor_usd) + ' floor with no token on record) plus every other pre-token protocol that survives the exclusions — ' + D.early_size + ' more, whatever its TVL. The floor defines the watchlist; it never limits discovery. Liquid-staking and liquid-restaking protocols are ranked; bridges, wrapped or staked products, exchange-branded names and versioned pools are excluded.</p>';
  const rows = D.multiples.by_category.map((c) => '<tr><td>' + esc(c.category) + '</td><td>' + c.live_n + '</td><td>' + (c.live_median === null ? '—' : c.live_median.toFixed(4) + '×') + '</td><td><b>' + c.multiple.toFixed(4) + '×</b></td></tr>').join('');
  $('mult-rows').innerHTML = '<tr><td><b>Global median</b></td><td>' + D.multiples.live_count + '</td><td>' + D.multiples.global_median.toFixed(4) + '×</td><td><b>' + D.multiples.global_median.toFixed(4) + '×</b></td></tr>' + rows;
  $('source-line').textContent = 'Source: ' + D.source + ' · Floor: ' + fmtFull(D.floor_usd) + ' · Model: ' + D.model_version;
})();

/* ---------- tabs ---------- */
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('main .tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ---------- drawer ---------- */
function evidenceText(r) {
  const m = multOf(r);
  const g = D.multiples.global_median;
  if (!m || m.live_n === 0) return 'No token in ' + (r.category ?? 'Uncategorized') + ' trades yet, so there is no category median to shrink from. The multiple is the global median of ' + g.toFixed(4) + '×, borrowed from all ' + D.multiples.live_count + ' live tokens. See the Live tokens tab for the full set.';
  if (m.live_n < D.model.min_live_for_category) return 'Only ' + m.live_n + ' live token' + (m.live_n === 1 ? '' : 's') + ' in ' + m.category + ' (median ' + m.live_median.toFixed(4) + '×) — fewer than the ' + D.model.min_live_for_category + ' needed for a category of its own, so the global median of ' + g.toFixed(4) + '× is used as the multiple instead.';
  return m.live_n + ' live tokens in ' + m.category + ' with a median ratio of ' + m.live_median.toFixed(4) + '×. The multiple of ' + m.multiple.toFixed(4) + '× is that median shrunk toward the global median of ' + g.toFixed(4) + '× with a prior of ' + D.model.shrink_prior + '.';
}
function drawerBody(r) {
  const b = r.breakdown;
  if (state.dtab === 'model') {
    return '<div class="eq">' + fmtFull(r.tvl_usd) + ' × ' + b.category_multiple.toFixed(4) + ' × ' + b.growth_multiplier.toFixed(4) + ' × ' + b.maturity_multiplier.toFixed(4) + ' × ' + b.chain_multiplier.toFixed(4) + ' = <b>' + fmtFull(r.implied_value_usd) + '</b></div>' +
      '<p>TVL × the ' + esc(r.category ?? 'Uncategorized') + ' multiple × growth × maturity × chains. ' + esc(evidenceText(r)) + '</p>' +
      '<p>Growth: ' + fmtPct(r.change_7d) + ' over 7 days (clamped to −50%…100%) gives a multiplier of ' + b.growth_multiplier.toFixed(4) + '. Maturity: ' + (b.age_days === null ? 'no listing date, treated as 365 days' : b.age_days + ' days old') + ' gives ' + b.maturity_multiplier.toFixed(4) + '. Chains: ' + r.chains.length + ' recorded, multiplier ' + b.chain_multiplier.toFixed(4) + '.</p>';
  }
  if (state.dtab === 'farm') {
    const steps = r.farm_steps.map((s) => {
      const parts = s.split(' Cost: ');
      const head = parts[0];
      const rest = (parts[1] || '').split(' Time: ');
      return '<li>' + esc(head) + ' <b>Cost: ' + esc(rest[0] || '') + '.</b> <b>Time: ' + esc(rest[1] || '') + '</b></li>';
    }).join('');
    return '<ol class="farm-list">' + steps + '</ol><p class="sub">Token status: ' + esc(r.token_status) + ' · Slug: ' + esc(r.slug) + '</p>';
  }
  const m = multOf(r);
  const table = m && m.top.length
    ? '<table class="evidence-table"><thead><tr><th>Comparable</th><th>mcap / TVL</th></tr></thead><tbody>' + m.top.map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + t.ratio.toFixed(4) + '×</td></tr>').join('') + '</tbody></table>'
    : '<p>No live comparables in this category — the Live tokens tab shows the ' + D.multiples.live_count + ' tokens the global median comes from.</p>';
  return '<p>' + esc(evidenceText(r)) + '</p>' + table;
}
function openDrawer(slug) {
  const r = rowBySlug.get(slug);
  if (!r) return;
  state.drawerSlug = slug;
  state.dtab = 'model';
  document.querySelectorAll('.drawer-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.dtab === 'model'));
  $('drawer-title').textContent = '#' + r.rank + ' ' + r.name;
  $('drawer-sub').textContent = (r.category ?? 'Uncategorized') + ' · ' + (r.chains.join(', ') || '—') + ' · TVL ' + fmtMoney(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) + ' · listed ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')' + (r.watchlist ? ' · Watchlist' : '');
  $('drawer-body').innerHTML = drawerBody(r);
  $('drawer').hidden = false;
  $('backdrop').hidden = false;
}
function closeDrawer() { state.drawerSlug = null; $('drawer').hidden = true; if ($('compare-modal').hidden) $('backdrop').hidden = true; }
$('drawer-close').addEventListener('click', closeDrawer);
$('backdrop').addEventListener('click', () => { closeDrawer(); closeCompare(); });
document.querySelectorAll('.drawer-tabs button').forEach((b) => b.addEventListener('click', () => {
  state.dtab = b.dataset.dtab;
  document.querySelectorAll('.drawer-tabs button').forEach((x) => x.classList.toggle('active', x === b));
  const r = rowBySlug.get(state.drawerSlug);
  if (r) $('drawer-body').innerHTML = drawerBody(r);
}));

/* ---------- compare ---------- */
function openCompare() {
  const rows = [...state.compare].map((s) => rowBySlug.get(s)).filter(Boolean).sort((a, b) => a.rank - b.rank);
  if (rows.length < 2) return;
  const cell = (f) => rows.map((r) => '<td>' + f(r) + '</td>').join('');
  $('compare-body').innerHTML = '<table><thead><tr><th></th>' + rows.map((r) => '<th>#' + r.rank + ' ' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +
    '<tr><td>Implied value</td>' + cell((r) => '<b>' + fmtMoney(r.implied_value_usd) + '</b>') + '</tr>' +
    '<tr><td>TVL</td>' + cell((r) => fmtMoney(r.tvl_usd)) + '</tr>' +
    '<tr><td>Category multiple</td>' + cell((r) => r.breakdown.category_multiple.toFixed(4) + '×') + '</tr>' +
    '<tr><td>7-day growth</td>' + cell((r) => fmtPct(r.change_7d)) + '</tr>' +
    '<tr><td>Maturity</td>' + cell((r) => r.breakdown.maturity_multiplier.toFixed(4) + '×') + '</tr>' +
    '<tr><td>Chains</td>' + cell((r) => esc(r.chains.join(', '))) + '</tr>' +
    '<tr><td>Farm plan</td>' + cell((r) => esc(r.farm_steps[0]) + '<br>' + esc(r.farm_steps[1]) + '<br><i>+' + (r.farm_steps.length - 2) + ' more steps in the drawer</i>') + '</tr>' +
    '</tbody></table>';
  $('compare-modal').hidden = false;
  $('backdrop').hidden = false;
}
function closeCompare() { $('compare-modal').hidden = true; if (!state.drawerSlug) $('backdrop').hidden = true; }
$('compare-btn').addEventListener('click', openCompare);
$('compare-close').addEventListener('click', closeCompare);

/* ---------- sandbox ---------- */
(function sandbox() {
  $('sb-proto').innerHTML = D.rows.map((r) => '<option value="' + esc(r.slug) + '">#' + r.rank + ' ' + esc(r.name) + '</option>').join('');
  const calc = () => {
    const r = rowBySlug.get($('sb-proto').value);
    if (!r) return;
    const mult = Math.min(1, Math.max(0.02, parseFloat($('sb-mult').value) || 0.02));
    const growth = Math.min(100, Math.max(-50, parseFloat($('sb-growth').value) || 0));
    const age = parseInt($('sb-age').value, 10);
    const chains = parseInt($('sb-chains').value, 10);
    const gm = 1 + (growth / 100) * D.model.growth_weight;
    const mm = D.model.maturity_floor + (Math.min(age, D.model.maturity_days) / D.model.maturity_days) * D.model.maturity_range;
    const cm = 1 + Math.min(chains - 1, D.model.chain_max_counted - 1) * D.model.chain_step;
    const whatIf = Math.min(D.model.implied_max, Math.max(D.model.implied_min, Math.round(r.tvl_usd * mult * gm * mm * cm)));
    const diff = ((whatIf - r.implied_value_usd) / r.implied_value_usd) * 100;
    $('sb-age-out').textContent = age + ' days';
    $('sb-chains-out').textContent = chains + (chains === 1 ? ' chain' : ' chains');
    $('sb-result').innerHTML = '<p>TVL ' + fmtFull(r.tvl_usd) + ' · official value ' + fmtFull(r.implied_value_usd) + '</p>' +
      '<p class="big">' + fmtFull(whatIf) + '</p>' +
      '<p class="diff">' + (diff >= 0 ? '+' : '') + diff.toFixed(2) + '% vs official</p>' +
      '<p class="sub">' + fmtFull(r.tvl_usd) + ' × ' + mult.toFixed(4) + ' × ' + gm.toFixed(4) + ' × ' + mm.toFixed(4) + ' × ' + cm.toFixed(4) + ' = ' + fmtFull(whatIf) + '</p>';
  };
  const loadProto = () => {
    const r = rowBySlug.get($('sb-proto').value);
    if (!r) return;
    $('sb-mult').value = r.breakdown.category_multiple;
    $('sb-growth').value = r.change_7d === null ? 0 : Math.min(100, Math.max(-50, r.change_7d));
    $('sb-age').value = r.age_days === null ? D.model.unknown_age_days : r.age_days;
    $('sb-chains').value = Math.min(r.chains.length, 5);
    calc();
  };
  $('sb-proto').addEventListener('change', loadProto);
  ['sb-mult', 'sb-growth', 'sb-age', 'sb-chains'].forEach((id) => $(id).addEventListener('input', calc));
  loadProto();
})();

/* ---------- command palette ---------- */
const palette = { items: [], sel: 0 };
function paletteActions() {
  const a = [
    { label: 'Toggle watchlist only', run: () => { state.watchOnly = !state.watchOnly; $('filter-watch').checked = state.watchOnly; renderBoard(); } },
    { label: 'Sort: implied value', run: () => { state.sortKey = 'implied'; state.sortDir = -1; $('sort').value = 'implied'; renderBoard(); } },
    { label: 'Sort: TVL', run: () => { state.sortKey = 'tvl'; state.sortDir = -1; $('sort').value = 'tvl'; renderBoard(); } },
    { label: 'Sort: 7-day change', run: () => { state.sortKey = 'change'; state.sortDir = -1; $('sort').value = 'change'; renderBoard(); } },
    { label: 'Sort: age', run: () => { state.sortKey = 'age'; state.sortDir = -1; $('sort').value = 'age'; renderBoard(); } },
    { label: 'Sort: name', run: () => { state.sortKey = 'name'; state.sortDir = 1; $('sort').value = 'name'; renderBoard(); } },
    { label: 'Export board as CSV', run: exportCsv },
    { label: 'Open model sandbox', run: () => switchTab('sandbox') },
  ];
  if (state.compare.size >= 2) a.push({ label: 'Compare selected (' + state.compare.size + ')', run: openCompare });
  if (state.pins.size > 0) a.push({ label: 'Clear pins (' + state.pins.size + ')', run: () => { state.pins.clear(); renderBoard(); } });
  return a;
}
function renderPalette() {
  const q = $('palette-input').value.trim().toLowerCase();
  const protos = D.rows.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q)).slice(0, 8)
    .map((r) => ({ label: '#' + r.rank + ' ' + r.name + ' — ' + fmtMoney(r.implied_value_usd), run: () => { switchTab('board'); openDrawer(r.slug); } }));
  const acts = paletteActions().filter((a) => !q || a.label.toLowerCase().includes(q)).map((a) => ({ label: a.label, run: a.run, action: true }));
  palette.items = [...protos, ...acts];
  palette.sel = 0;
  $('palette-list').innerHTML = palette.items.map((it, i) => '<div class="pal-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' + (it.action ? '<span class="act">Action — </span>' : '') + esc(it.label) + '</div>').join('') || '<div class="pal-item">No matches.</div>';
}
function openPalette() { $('palette').hidden = false; $('palette-input').value = ''; renderPalette(); $('palette-input').focus(); }
function closePalette() { $('palette').hidden = true; }
$('palette-btn').addEventListener('click', openPalette);
$('palette-input').addEventListener('input', renderPalette);
$('palette-list').addEventListener('click', (e) => {
  const item = e.target.closest('.pal-item');
  if (!item || !item.dataset.i) return;
  const it = palette.items[+item.dataset.i];
  closePalette();
  if (it) it.run();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') {
    if (!$('palette').hidden) closePalette();
    else if (!$('compare-modal').hidden) closeCompare();
    else if (state.drawerSlug) closeDrawer();
    return;
  }
  if ($('palette').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    palette.sel = (palette.sel + (e.key === 'ArrowDown' ? 1 : -1) + palette.items.length) % Math.max(palette.items.length, 1);
    document.querySelectorAll('.pal-item').forEach((el, i) => el.classList.toggle('sel', i === palette.sel));
  } else if (e.key === 'Enter') {
    const it = palette.items[palette.sel];
    closePalette();
    if (it) it.run();
  }
});

/* ---------- deep links (for screenshots): #tab=…&search=…&drawer=<slug> ---------- */
function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('tab')) switchTab(params.get('tab'));
  if (params.get('search')) { state.search = params.get('search'); $('search').value = state.search; }
  renderBoard();
  if (params.get('drawer')) openDrawer(params.get('drawer'));
}
applyHash();
window.addEventListener('hashchange', applyHash);
renderBoard();

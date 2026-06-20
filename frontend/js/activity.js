'use strict';

/* ════════════════════════════════════════════════════════
   Log Aktivitas (admin only)
   ════════════════════════════════════════════════════════ */

const API = 'http://localhost:8000';
const PAGE_SIZE = 25;

/* ── Utilities ── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Parse timestamp dari server. Backend memakai datetime.utcnow() (naive UTC)
 * tanpa penanda zona, sehingga harus diperlakukan sebagai UTC — jika tidak,
 * browser menafsirkannya sebagai waktu lokal dan muncul selisih beberapa jam.
 */
function parseServerDate(isoStr) {
  if (!isoStr) return new Date(NaN);
  let s = String(isoStr);
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';   // tambahkan 'Z' bila belum ada zona
  return new Date(s);
}

function formatRelativeDate(isoStr) {
  try {
    const diff = Date.now() - parseServerDate(isoStr).getTime();
    if (diff < 0) return 'Baru saja';
    const m = Math.floor(diff / 60000);
    if (m < 2)  return 'Baru saja';
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    const d = Math.floor(h / 24);
    if (d === 1) return '1 hari lalu';
    if (d < 30) return `${d} hari lalu`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} bulan lalu`;
    return `${Math.floor(mo / 12)} tahun lalu`;
  } catch (_) { return isoStr; }
}

function formatAbsolute(isoStr) {
  try {
    return parseServerDate(isoStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return isoStr; }
}

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

/* ── Vocab maps (selaras core/activity.py) ── */
const ACTION_LABEL = {
  login: 'Login', logout: 'Logout', create: 'Tambah', update: 'Ubah',
  delete: 'Hapus', predict: 'Prediksi', preprocess: 'Preprocess',
  scrape: 'Scraping', approve: 'Setujui', reject: 'Tolak',
  correct: 'Koreksi', export: 'Ekspor',
};
const ENTITY_LABEL = {
  auth: 'Autentikasi', user: 'Pengguna', review: 'Ulasan',
  source: 'Sumber Data', prediction: 'Prediksi', batch: 'Batch',
};
const ACTION_ICON = {
  login:   '<path d="M9 13l3-3-3-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 10H3" stroke-linecap="round"/><path d="M7 4.5V4a1.5 1.5 0 0 1 1.5-1.5H15A1.5 1.5 0 0 1 16.5 4v12A1.5 1.5 0 0 1 15 17.5H8.5A1.5 1.5 0 0 1 7 16v-.5"/>',
  create:  '<path d="M10 4v12M4 10h12" stroke-linecap="round"/>',
  update:  '<path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L6 17H3v-3L13.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>',
  delete:  '<path d="M4 6h12M8 6V4h4v2m-1 0v9m-2-9v9M6 6l.5 11h7L14 6" stroke-linecap="round" stroke-linejoin="round"/>',
  predict: '<path d="M10 3.5l1.9 3.85 4.25.62-3.07 3 .72 4.23L10 13.1l-3.8 2 .72-4.23-3.07-3 4.25-.62z" stroke-linecap="round" stroke-linejoin="round"/>',
  preprocess: '<path d="M4 5h12M4 10h8M4 15h10" stroke-linecap="round"/>',
  scrape:  '<ellipse cx="10" cy="6" rx="7" ry="2.75"/><path d="M3 6v8c0 1.52 3.134 2.75 7 2.75S17 15.52 17 14V6"/>',
  approve: '<path d="M4 10.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/>',
  reject:  '<path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/>',
  correct: '<path d="M4 14l3 3 9-9" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 7l3-3 3 3" stroke-linecap="round" stroke-linejoin="round"/>',
};

function actionChip(action) {
  const label = ACTION_LABEL[action] || action;
  const cls = ACTION_ICON[action] ? `act-${action}` : 'act-default';
  const icon = ACTION_ICON[action]
    ? `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">${ACTION_ICON[action]}</svg>`
    : `<span class="act-dot"></span>`;
  return `<span class="act-chip ${cls}">${icon}${esc(label)}</span>`;
}

/* ════════════════════════════════════════════════════════
   AUTH GUARD (admin only)
   ════════════════════════════════════════════════════════ */
(function authGuard() {
  const token = localStorage.getItem('token');
  if (!token) { window.location.href = 'login.html'; return; }
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if ((user.role || '').toLowerCase() !== 'admin') {
      window.location.href = 'dashboard.html';
    }
  } catch (_) { window.location.href = 'login.html'; }
})();

/* ── Sidebar user info ── */
(function userInfo() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const name = user.full_name || user.username || 'Admin';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('user-name', name);
    set('user-role', user.role || 'admin');
    const av = document.getElementById('user-avatar');
    if (av) av.textContent = name.charAt(0).toUpperCase();
  } catch (_) {}
})();

/* ── Date display ── */
(function dateDisplay() {
  const el = document.getElementById('date-display');
  if (el) el.textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
})();

/* ── Logout modal ── */
(function logoutModal() {
  const btn = document.getElementById('logout-btn');
  const modal = document.getElementById('logout-modal');
  const cancel = document.getElementById('modal-cancel');
  const confirm = document.getElementById('modal-confirm');
  if (!btn || !modal) return;
  btn.addEventListener('click', () => modal.classList.remove('hidden'));
  if (cancel) cancel.addEventListener('click', () => modal.classList.add('hidden'));
  if (confirm) confirm.addEventListener('click', () => { localStorage.clear(); window.location.href = 'login.html'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
})();

/* ════════════════════════════════════════════════════════
   API
   ════════════════════════════════════════════════════════ */
function authHeaders() {
  return { Authorization: 'Bearer ' + localStorage.getItem('token') };
}

async function apiGet(path) {
  const res = await fetch(API + path, { headers: authHeaders() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════ */
let state = 'loading';          // 'loading' | 'ok' | 'empty' | 'error'
let currentPage = 0;            // 0-based
let totalRows = 0;

function getFilters() {
  return {
    search:  document.getElementById('search-input').value.trim(),
    user_id: document.getElementById('filter-user').value,
    action:  document.getElementById('filter-action').value,
    entity:  document.getElementById('filter-entity').value,
    status:  document.getElementById('filter-status').value,
    from:    document.getElementById('filter-from').value,
    to:      document.getElementById('filter-to').value,
  };
}

function buildQuery() {
  const f = getFilters();
  const p = new URLSearchParams();
  if (f.search)  p.set('search', f.search);
  if (f.user_id) p.set('user_id', f.user_id);
  if (f.action)  p.set('action', f.action);
  if (f.entity)  p.set('entity', f.entity);
  if (f.status)  p.set('status', f.status);
  if (f.from)    p.set('date_from', f.from);
  if (f.to)      p.set('date_to', f.to);
  p.set('skip', String(currentPage * PAGE_SIZE));
  p.set('limit', String(PAGE_SIZE));
  return p.toString();
}

/* ════════════════════════════════════════════════════════
   LOAD
   ════════════════════════════════════════════════════════ */
async function loadStats() {
  try {
    const s = await apiGet('/api/activity/stats');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = Number(v).toLocaleString('id-ID'); };
    set('kpi-total', s.total);
    set('kpi-today', s.today);
    set('kpi-users', s.active_users);
    set('kpi-failed', s.failed);
  } catch (_) {/* abaikan KPI bila gagal */}
}

async function loadFilters() {
  try {
    const f = await apiGet('/api/activity/filters');
    const userSel = document.getElementById('filter-user');
    f.users.forEach(u => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = '@' + u.username;
      userSel.appendChild(o);
    });
    const actSel = document.getElementById('filter-action');
    f.actions.forEach(a => {
      const o = document.createElement('option');
      o.value = a; o.textContent = ACTION_LABEL[a] || a;
      actSel.appendChild(o);
    });
    const entSel = document.getElementById('filter-entity');
    f.entities.forEach(e => {
      const o = document.createElement('option');
      o.value = e; o.textContent = ENTITY_LABEL[e] || e;
      entSel.appendChild(o);
    });
  } catch (_) {/* dropdown tetap minimal */}
}

async function loadLogs() {
  state = 'loading';
  renderLoading();
  try {
    const data = await apiGet('/api/activity/?' + buildQuery());
    totalRows = data.total;
    const items = data.items || [];
    state = items.length ? 'ok' : 'empty';
    renderTable(items);
    renderPagination();
  } catch (_) {
    state = 'error';
    totalRows = 0;
    renderTable([]);
    renderPagination();
  }
}

/* ════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════ */
function renderLoading() {
  const tbody = document.getElementById('activity-table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty-state">Memuat aktivitas…</div></td></tr>`;
}

function renderTable(items) {
  const tbody = document.getElementById('activity-table-body');
  const subtitle = document.getElementById('table-subtitle');
  if (!tbody) return;

  if (!items.length) {
    let msg;
    if (state === 'error')      msg = 'Tidak dapat terhubung ke server backend (http://localhost:8000).';
    else if (totalRows === 0)   msg = 'Belum ada aktivitas yang tercatat.';
    else                        msg = 'Tidak ada aktivitas yang sesuai filter.';
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="table-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
          ${msg}
        </div>
      </td></tr>`;
    if (subtitle) subtitle.textContent = `${totalRows.toLocaleString('id-ID')} aktivitas`;
    return;
  }

  if (subtitle) subtitle.textContent = `${totalRows.toLocaleString('id-ID')} aktivitas tercatat`;

  tbody.innerHTML = items.map(it => {
    const uname = it.username || (it.user_id ? `user#${it.user_id}` : 'Sistem');
    const avatarCls = 'analyst';
    const statusCls = it.status === 'failed' ? 'status-failed' : 'status-success';
    const statusTxt = it.status === 'failed' ? 'Gagal' : 'Berhasil';
    const entity = it.entity ? `<span class="entity-tag">${esc(ENTITY_LABEL[it.entity] || it.entity)}</span>` : '<span class="text-c3">—</span>';

    return `<tr>
      <td>
        <div class="act-time-rel">${esc(formatRelativeDate(it.created_at))}</div>
        <div class="act-time-abs">${esc(formatAbsolute(it.created_at))}</div>
      </td>
      <td>
        <div class="user-avatar-cell">
          <div class="user-avatar-sm ${avatarCls}">${esc(initials(uname))}</div>
          <div class="user-fullname">@${esc(uname)}</div>
        </div>
      </td>
      <td>${actionChip(it.action)}</td>
      <td>${entity}</td>
      <td><div class="act-desc">${esc(it.description || '—')}</div></td>
      <td><span class="status-badge ${statusCls}"><span class="st-dot"></span>${statusTxt}</span></td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const info = document.getElementById('pagination-info');
  const indicator = document.getElementById('page-indicator');
  const prev = document.getElementById('page-prev');
  const next = document.getElementById('page-next');

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (currentPage >= totalPages) currentPage = totalPages - 1;

  const start = totalRows === 0 ? 0 : currentPage * PAGE_SIZE + 1;
  const end = Math.min(totalRows, (currentPage + 1) * PAGE_SIZE);

  if (info) info.textContent = totalRows === 0
    ? 'Tidak ada data'
    : `Menampilkan ${start.toLocaleString('id-ID')}–${end.toLocaleString('id-ID')} dari ${totalRows.toLocaleString('id-ID')}`;
  if (indicator) indicator.textContent = `${currentPage + 1} / ${totalPages}`;
  if (prev) prev.disabled = currentPage <= 0;
  if (next) next.disabled = currentPage >= totalPages - 1;
}

/* ════════════════════════════════════════════════════════
   EVENTS
   ════════════════════════════════════════════════════════ */
function reloadFromFirstPage() { currentPage = 0; loadLogs(); }

(function wireEvents() {
  let searchTimer;
  const search = document.getElementById('search-input');
  if (search) search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadFromFirstPage, 350);
  });

  ['filter-user', 'filter-action', 'filter-entity', 'filter-status', 'filter-from', 'filter-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', reloadFromFirstPage);
  });

  const reset = document.getElementById('btn-reset-filter');
  if (reset) reset.addEventListener('click', () => {
    ['search-input', 'filter-user', 'filter-action', 'filter-entity', 'filter-status', 'filter-from', 'filter-to']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    reloadFromFirstPage();
  });

  const refresh = document.getElementById('btn-refresh');
  if (refresh) refresh.addEventListener('click', () => { loadStats(); loadLogs(); });

  const prev = document.getElementById('page-prev');
  const next = document.getElementById('page-next');
  if (prev) prev.addEventListener('click', () => { if (currentPage > 0) { currentPage--; loadLogs(); } });
  if (next) next.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (currentPage < totalPages - 1) { currentPage++; loadLogs(); }
  });
})();

/* ════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════ */
(function init() {
  renderLoading();
  loadStats();
  loadFilters();
  loadLogs();
})();

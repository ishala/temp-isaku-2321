'use strict';

/* ════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════ */

/** HTML-escape a value to safely embed in innerHTML */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns badge HTML for a sentiment label.
 * @param {string} label  'positif' | 'negatif' (case-insensitive)
 */
function badgeHtml(label) {
  const l = String(label || '').toLowerCase().trim();
  if (l === 'negatif') return '<span class="badge negative">Negatif</span>';
  if (l === 'positif') return '<span class="badge positive">Positif</span>';
  return '<span class="badge" style="opacity:.45">—</span>';  // belum dianalisis
}

/**
 * Returns badge HTML for review status.
 * @param {string} status  'pending' | 'disetujui' | 'ditolak'
 */
function statusBadge(status) {
  const s = String(status).toLowerCase().trim();
  if (s === 'disetujui') return '<span class="badge positive">Disetujui</span>';
  if (s === 'ditolak')   return '<span class="badge negative">Ditolak</span>';
  return '<span class="badge warn">Pending</span>';
}

/* ── API helpers ── */
const API_BASE = 'http://localhost:8000';
function authHeaders(json) {
  const h = { 'Authorization': 'Bearer ' + localStorage.getItem('token') };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function apiCall(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: authHeaders(!!body),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || ('HTTP ' + res.status));
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}
const LABEL_TO_ENG = { positif: 'positive', negatif: 'negative' };

/* ── Toast ── */
function toast(msg, type) {
  let el = document.getElementById('ulasan-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ulasan-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'padding:11px 18px;border-radius:10px;font-size:12px;font-family:Inter,sans-serif;font-weight:500;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .2s;color:#0b0b12;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#F87171' : '#4ADE80';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

/** Format a date string to Indonesian locale */
function fmtDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch (_) {
    return dateStr;
  }
}

/** Truncate text with ellipsis */
function truncate(str, max) {
  return str.length > max ? str.substring(0, max) + '…' : str;
}

/** Capitalize first letter */
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/* ════════════════════════════════════════════════════════
   1. AUTH GUARD
   ════════════════════════════════════════════════════════ */
(function authGuard() {
  if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
  }
})();

/* ════════════════════════════════════════════════════════
   2. USER INFO
   ════════════════════════════════════════════════════════ */
(function userInfo() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const name = user.full_name || user.username || 'Pengguna';
    const role = user.role || 'analyst';

    const elName   = document.getElementById('user-name');
    const elRole   = document.getElementById('user-role');
    const elAvatar = document.getElementById('user-avatar');
    if (elName)   elName.textContent   = name;
    if (elRole)   elRole.textContent   = role;
    if (elAvatar) elAvatar.textContent = name.charAt(0).toUpperCase();

    /* Hide admin-only elements for non-admin roles */
    if (role !== 'admin') {
      /* Sidebar admin section */
      const sec = document.getElementById('admin-section');
      const nav = document.getElementById('nav-pengguna');
      const navAct = document.getElementById('nav-aktivitas');
      if (sec) sec.style.display = 'none';
      if (nav) nav.style.display = 'none';
      if (navAct) navAct.style.display = 'none';

      /* Admin-only action buttons in the table will be hidden after render */
      document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = 'none';
      });
    }
  } catch (_) {}
})();

/* ════════════════════════════════════════════════════════
   3. DATE DISPLAY
   ════════════════════════════════════════════════════════ */
(function dateDisplay() {
  const el = document.getElementById('date-display');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
})();

/* ════════════════════════════════════════════════════════
   4. LOGOUT MODAL
   ════════════════════════════════════════════════════════ */
(function logoutModal() {
  const btn     = document.getElementById('logout-btn');
  const modal   = document.getElementById('logout-modal');
  const cancel  = document.getElementById('modal-cancel');
  const confirm = document.getElementById('modal-confirm');
  if (!btn || !modal) return;

  btn.addEventListener('click', () => modal.classList.remove('hidden'));
  cancel.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  confirm.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });
})();

/* ════════════════════════════════════════════════════════
   5. DEMO DATA + TABLE STATE
   ════════════════════════════════════════════════════════ */

/** Master dataset — populated from API */
let allData = [];

/** Status pemuatan data: 'loading' | 'ok' | 'empty' | 'error' */
let dataState = 'loading';

/** Currently visible (filtered + sorted) rows */
let filteredData = [];

/** Pagination state */
const PAGE_SIZE = 10;
let currentPage = 1;

/** Active modal context */
let activeRowId = null;
let selectedKoreksiLabel = null;

/* ════════════════════════════════════════════════════════
   6. TABLE RENDERING
   ════════════════════════════════════════════════════════ */

function getUserRole() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.role || 'analyst';
  } catch (_) { return 'analyst'; }
}

function starsHtml(n) {
  return `<span class="star-display">${n}★</span>`;
}

/** Build a single table row */
function buildRow(row, index) {
  const role     = getUserRole();
  const isAdmin  = role === 'admin';
  const canApprove = row.analyzed && row.status === 'pending';

  const approveBtn = canApprove
    ? `<button class="action-btn approve" data-action="setujui" data-id="${row.id}" title="Setujui">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10.5l4.5 4.5 7.5-8" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>`
    : '';

  /* Tolak = prediksi salah → buka popup koreksi label, status menjadi Ditolak */
  const rejectBtn = canApprove
    ? `<button class="action-btn reject" data-action="tolak" data-id="${row.id}" title="Tolak & koreksi label">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/></svg>
       </button>`
    : '';

  const editBtn = `<button class="action-btn admin-only" data-action="edit" data-id="${row.id}" title="Edit ulasan" style="${isAdmin ? '' : 'display:none'}">
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.75" y="3.75" width="12.5" height="12.5" rx="1.5"/><path d="M7.5 10.5h5M7.5 7.5h3M7.5 13.5h2.5" stroke-linecap="round"/></svg>
  </button>`;

  const hapusBtn = `<button class="action-btn danger admin-only" data-action="hapus" data-id="${row.id}" title="Hapus ulasan" style="${isAdmin ? '' : 'display:none'}">
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4.75h6M4.75 6.75h10.5M8.25 8.75v5.5m3.5-5.5v5.5M5.75 6.75l.75 8.5A1.5 1.5 0 0 0 8 16.75h4a1.5 1.5 0 0 0 1.5-1.5l.75-8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`;

  return `<tr data-id="${row.id}">
    <td class="col-no">${index}</td>
    <td class="col-ulasan" data-action="detail" data-id="${row.id}" title="${esc(row.teks)}">${esc(truncate(row.teks, 60))}</td>
    <td>${starsHtml(row.bintang)}</td>
    <td class="text-[11px]">${esc(fmtDate(row.tanggal))}</td>
    <td>${badgeHtml(row.nb_label)}</td>
    <td>${badgeHtml(row.svm_label)}</td>
    <td>${statusBadge(row.status)}</td>
    <td class="col-aksi">
      <div class="flex items-center gap-[3px]">
        ${approveBtn}${rejectBtn}${editBtn}${hapusBtn}
      </div>
    </td>
  </tr>`;
}

/** Render current page from filteredData */
function renderTable() {
  const tbody    = document.getElementById('table-body');
  const subtitle = document.getElementById('table-subtitle');
  const paginfoEl = document.getElementById('pagination-info');
  if (!tbody) return;

  const total     = filteredData.length;
  const startIdx  = (currentPage - 1) * PAGE_SIZE;
  const endIdx    = Math.min(startIdx + PAGE_SIZE, total);
  const pageRows  = filteredData.slice(startIdx, endIdx);

  if (pageRows.length === 0) {
    let msg;
    if (dataState === 'loading')      msg = 'Memuat data dari server…';
    else if (dataState === 'error')   msg = 'Tidak dapat terhubung ke server backend. Pastikan API berjalan di http://localhost:8000.';
    else if (allData.length === 0)    msg = 'Belum ada data ulasan di database. Lakukan scraping terlebih dahulu pada panel di atas.';
    else                              msg = 'Tidak ada ulasan yang sesuai filter.';
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="table-empty-state">
        <svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="10" cy="10" r="7.25"/><path d="M10 6v4l2.5 2.5" stroke-linecap="round"/></svg>
        ${msg}
      </div>
    </td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((row, i) => buildRow(row, startIdx + i + 1)).join('');
  }

  subtitle.textContent = `${total.toLocaleString('id-ID')} ulasan ditemukan`;
  paginfoEl.textContent = total === 0
    ? 'Tidak ada ulasan'
    : `Menampilkan ${(startIdx + 1).toLocaleString('id-ID')}–${endIdx.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} ulasan`;

  renderPagination(total);
}

/* ════════════════════════════════════════════════════════
   7. PAGINATION
   ════════════════════════════════════════════════════════ */

function renderPagination(total) {
  const container = document.getElementById('pagination');
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const buttons = [];

  /* Prev */
  buttons.push(`<button class="page-btn" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.5 5l-5 5 5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`);

  /* Page numbers with ellipsis */
  const pages = buildPageList(currentPage, totalPages);
  pages.forEach(p => {
    if (p === '…') {
      buttons.push('<span class="page-ellipsis">…</span>');
    } else {
      buttons.push(`<button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`);
    }
  });

  /* Next */
  buttons.push(`<button class="page-btn" data-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.5 5l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>`);

  container.innerHTML = buttons.join('');
}

function buildPageList(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [];
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('…');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('…');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('…');
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push('…');
    pages.push(total);
  }
  return pages;
}

/* Pagination click handler */
document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  const p = btn.dataset.page;
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  if (p === 'prev') currentPage = Math.max(1, currentPage - 1);
  else if (p === 'next') currentPage = Math.min(totalPages, currentPage + 1);
  else currentPage = parseInt(p, 10);
  renderTable();
});

/* ════════════════════════════════════════════════════════
   8. FILTER & SORT
   ════════════════════════════════════════════════════════ */

function applyFiltersAndSort(preservePage) {
  const search  = (document.getElementById('filter-search').value || '').toLowerCase().trim();
  const source  = document.getElementById('filter-source').value;
  const status  = document.getElementById('filter-status').value;
  const bintang = document.getElementById('filter-bintang').value;
  const sort    = document.getElementById('filter-sort').value;

  let data = allData.filter(row => {
    if (search  && !row.teks.toLowerCase().includes(search))         return false;
    if (source  && row.source !== source)                             return false;
    if (status  && row.status !== status)                             return false;
    if (bintang && String(row.bintang) !== bintang)                  return false;
    return true;
  });

  /* Sort */
  data = data.slice().sort((a, b) => {
    if (sort === 'terlama')       return new Date(a.tanggal) - new Date(b.tanggal);
    if (sort === 'bintang-desc')  return b.bintang - a.bintang;
    if (sort === 'bintang-asc')   return a.bintang - b.bintang;
    return new Date(b.tanggal) - new Date(a.tanggal); /* terbaru default */
  });

  filteredData = data;

  if (preservePage === true) {
    /* Clamp to a valid page in case the current page no longer has rows */
    const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
  } else {
    currentPage = 1;
  }
  renderTable();
}

/* Attach filter listeners — changing a filter resets to page 1 */
['filter-search', 'filter-source', 'filter-status', 'filter-bintang', 'filter-sort'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => applyFiltersAndSort(false));
});

document.getElementById('btn-reset-filter').addEventListener('click', () => {
  document.getElementById('filter-search').value  = '';
  document.getElementById('filter-source').value  = '';
  document.getElementById('filter-status').value  = '';
  document.getElementById('filter-bintang').value = '';
  document.getElementById('filter-sort').value    = 'terbaru';
  applyFiltersAndSort();
});

/* ════════════════════════════════════════════════════════
   9. TABLE ROW ACTIONS (event delegation)
   ════════════════════════════════════════════════════════ */

document.getElementById('data-table').addEventListener('click', e => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id     = parseInt(target.dataset.id, 10);
  const row    = allData.find(r => r.id === id);
  if (!row) return;

  switch (action) {
    case 'setujui': handleSetujui(id); break;
    case 'tolak':   openKoreksiModal(row); break;  // tolak → popup koreksi label
    case 'edit':    openEditModal(row);    break;
    case 'hapus':   openHapusModal(row);   break;
    case 'detail':  openDetailModal(row);  break;
  }
});

async function setApproval(id, approvalStatus) {
  const row = allData.find(r => r.id === id);
  if (!row) return;
  if (!row.result_id) {
    toast('Ulasan belum dianalisis. Jalankan prediksi terlebih dahulu.', 'error');
    return;
  }
  try {
    await apiCall('PATCH', `/api/results/${row.result_id}/approve`, { approval_status: approvalStatus });
    toast(approvalStatus === 'approved' ? 'Ulasan disetujui.' : 'Ulasan ditolak.', 'ok');
    loadReviews(true);
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
}
function handleSetujui(id) { setApproval(id, 'approved'); }

/* ════════════════════════════════════════════════════════
   10. MODAL: KOREKSI
   ════════════════════════════════════════════════════════ */

function openKoreksiModal(row) {
  activeRowId          = row.id;
  selectedKoreksiLabel = null;

  document.getElementById('koreksi-teks').textContent     = row.teks;
  document.getElementById('koreksi-nb-badge').innerHTML   = badgeHtml(row.nb_label);
  document.getElementById('koreksi-svm-badge').innerHTML  = badgeHtml(row.svm_label);
  document.getElementById('koreksi-catatan').value        = '';

  /* Reset label selector */
  document.querySelectorAll('.label-opt').forEach(btn => btn.classList.remove('selected'));

  openModal('modal-koreksi');
}

/* Label option click */
document.querySelectorAll('.label-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.label-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedKoreksiLabel = btn.dataset.label;
  });
});

/* Save koreksi */
document.getElementById('btn-simpan-koreksi').addEventListener('click', async () => {
  if (!selectedKoreksiLabel) {
    toast('Pilih label baru terlebih dahulu.', 'error');
    return;
  }
  const row = allData.find(r => r.id === activeRowId);
  if (!row || !row.result_id) {
    toast('Ulasan belum dianalisis, tidak bisa dikoreksi.', 'error');
    return;
  }
  const catatan = document.getElementById('koreksi-catatan').value.trim();
  try {
    await apiCall('POST', `/api/results/${row.result_id}/correct`, {
      corrected_label: LABEL_TO_ENG[selectedKoreksiLabel] || selectedKoreksiLabel,
      correction_note: catatan || null,
    });
    closeModal('modal-koreksi');
    toast('Ulasan ditolak — label dikoreksi.', 'ok');
    loadReviews(true);
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});

/* ════════════════════════════════════════════════════════
   11. MODAL: EDIT
   ════════════════════════════════════════════════════════ */

function openEditModal(row) {
  activeRowId = row.id;
  document.getElementById('edit-teks').value    = row.teks;
  document.getElementById('edit-bintang').value = String(row.bintang);
  openModal('modal-edit');
}

document.getElementById('btn-simpan-edit').addEventListener('click', async () => {
  const newTeks    = document.getElementById('edit-teks').value.trim();
  const newBintang = parseInt(document.getElementById('edit-bintang').value, 10);

  if (!newTeks) { toast('Teks ulasan tidak boleh kosong.', 'error'); return; }

  try {
    await apiCall('PUT', `/api/reviews/${activeRowId}`, {
      original_text: newTeks,
      star_rating: newBintang,
    });
    closeModal('modal-edit');
    toast('Ulasan diperbarui.', 'ok');
    loadReviews(true);
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});

/* ════════════════════════════════════════════════════════
   12. MODAL: HAPUS
   ════════════════════════════════════════════════════════ */

function openHapusModal(row) {
  activeRowId = row.id;
  document.getElementById('hapus-teks-preview').textContent = truncate(row.teks, 80);
  openModal('modal-hapus');
}

document.getElementById('btn-konfirm-hapus').addEventListener('click', async () => {
  try {
    await apiCall('DELETE', `/api/reviews/${activeRowId}`);
    closeModal('modal-hapus');
    toast('Ulasan dihapus.', 'ok');
    loadReviews(true);
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});

/* ════════════════════════════════════════════════════════
   13. MODAL: DETAIL
   ════════════════════════════════════════════════════════ */

function openDetailModal(row) {
  document.getElementById('detail-teks').textContent         = row.teks;
  document.getElementById('detail-source').textContent       = row.source;
  document.getElementById('detail-tanggal').textContent      = fmtDate(row.tanggal);
  document.getElementById('detail-bintang').textContent      = row.bintang + '★';
  document.getElementById('detail-status').innerHTML         = statusBadge(row.status);
  document.getElementById('detail-nb').innerHTML             = badgeHtml(row.nb_label);
  document.getElementById('detail-svm').innerHTML            = badgeHtml(row.svm_label);
  document.getElementById('detail-corrected-by').textContent = row.corrected_by || '—';
  openModal('modal-detail');
}

/* ════════════════════════════════════════════════════════
   14. MODAL HELPERS
   ════════════════════════════════════════════════════════ */

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

/* Close buttons with data-modal attribute */
document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});

/* Close on overlay click */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* Close on Escape key */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  const logout = document.getElementById('logout-modal');
  if (logout && !logout.classList.contains('hidden')) logout.classList.add('hidden');
});

/* ════════════════════════════════════════════════════════
   15. TOOLTIP
   ════════════════════════════════════════════════════════ */
(function tooltip() {
  const tip = document.getElementById('tooltip');
  if (!tip) return;

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[title]');
    if (!target) return;
    const text = target.getAttribute('title');
    if (!text) return;

    /* Suppress native tooltip */
    target.dataset._title = text;
    target.removeAttribute('title');

    tip.textContent = text;
    tip.classList.remove('hidden');
    positionTip(e);
  });

  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('hidden')) positionTip(e);
  });

  document.addEventListener('mouseout', e => {
    const target = e.target.closest('[data-_title]');
    if (target) {
      target.setAttribute('title', target.dataset._title);
      delete target.dataset._title;
    }
    tip.classList.add('hidden');
  });

  function positionTip(e) {
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    const rect = tip.getBoundingClientRect();
    tip.style.left = Math.min(x, window.innerWidth  - rect.width  - 10) + 'px';
    tip.style.top  = Math.min(y, window.innerHeight - rect.height - 10) + 'px';
  }
})();

/* ════════════════════════════════════════════════════════
   16. PRINT
   ════════════════════════════════════════════════════════ */
document.getElementById('btn-print-ulasan').addEventListener('click', () => {
  /* Populate print table with all filtered data */
  const tbody = document.getElementById('print-table-body');
  tbody.innerHTML = filteredData.map((row, i) => `<tr>
    <td>${i + 1}</td>
    <td>${esc(row.teks)}</td>
    <td>${row.bintang}★</td>
    <td>${esc(fmtDate(row.tanggal))}</td>
    <td>${esc(row.source)}</td>
    <td>${cap(row.status)}</td>
    <td>${cap(row.nb_label)}</td>
    <td>${cap(row.svm_label)}</td>
  </tr>`).join('');

  /* Set date */
  const dateEl = document.getElementById('print-date-ulasan');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  /* Mark as printing */
  document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
  document.getElementById('print-ulasan-doc').classList.add('printing');

  window.print();

  /* Cleanup after print */
  setTimeout(() => {
    document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
  }, 600);
});

/* ════════════════════════════════════════════════════════
   17. API CALL + DATA INIT
   ════════════════════════════════════════════════════════ */
function loadReviews(preservePage) {
  const token = localStorage.getItem('token');

  fetch('http://localhost:8000/api/reviews/table', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
  })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(rows => {
      if (Array.isArray(rows) && rows.length > 0) {
        dataState = 'ok';
        allData = rows.map(r => ({
          id:           r.id,
          teks:         r.teks || '',
          bintang:      r.bintang || 0,
          tanggal:      r.tanggal || new Date().toISOString(),
          source:       r.source || '-',
          nb_label:     r.nb_label,
          nb_conf:      r.nb_conf,
          svm_label:    r.svm_label,
          svm_conf:     r.svm_conf,
          status:       r.status || 'pending',
          preprocessed: r.preprocessed,
          analyzed:     r.analyzed,
          result_id:    r.result_id,
          corrected_by: null,
        }));
      } else {
        dataState = 'empty';
        allData = [];
      }
      applyFiltersAndSort(preservePage);
    })
    .catch(() => {
      dataState = 'error';
      allData = [];
      applyFiltersAndSort(preservePage);
    });
}

/* ── Scraping Google Play → data mentah ── */
(function scrapeFeature() {
  const yearSel  = document.getElementById('scrape-year');
  const monthSel = document.getElementById('scrape-month');
  const appInput = document.getElementById('scrape-appid');
  const btn      = document.getElementById('btn-scrape');
  const statusEl = document.getElementById('scrape-status');
  if (!yearSel || !btn) return;

  const nowY = new Date().getFullYear();
  for (let y = nowY; y >= 2019; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    yearSel.appendChild(o);
  }

  function setLoading(on) {
    btn.disabled = on;
    btn.querySelector('.scrape-btn-text').style.display = on ? 'none' : '';
    btn.querySelector('.scrape-spinner').style.display  = on ? 'block' : 'none';
  }
  function showStatus(msg, type) {
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.style.color =
      type === 'error' ? '#F87171' : type === 'ok' ? '#4ADE80' : 'var(--c2)';
  }

  btn.addEventListener('click', async () => {
    const year  = parseInt(yearSel.value, 10);
    const month = monthSel.value ? parseInt(monthSel.value, 10) : null;
    const app_id = appInput.value.trim();
    if (!app_id) { showStatus('App ID tidak boleh kosong.', 'error'); return; }

    setLoading(true);
    showStatus('Mengambil ulasan dari Google Play… (bisa beberapa saat)', 'info');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/api/scrape/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ year, month, app_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Scraping gagal');
      showStatus(data.message || `${data.inserted} ulasan disimpan.`, 'ok');
      loadReviews();
    } catch (e) {
      showStatus('Gagal: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  });
})();

loadReviews();

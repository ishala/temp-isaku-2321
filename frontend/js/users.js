'use strict';

/* ════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════ */

/** HTML-escape a value for safe innerHTML embedding */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/**
 * Returns relative date string in Indonesian.
 * @param {string} isoStr  ISO 8601 date string
 * @returns {string}  "Belum pernah" | "Baru saja" | "N menit lalu" | "N jam lalu" | "N hari lalu"
 */
function formatRelativeDate(isoStr) {
  try {
    const ts = parseServerDate(isoStr).getTime();
    if (!Number.isFinite(ts)) return 'Belum pernah';
    const diff = Date.now() - ts;
    if (diff < 0) return 'Baru saja';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 2)  return 'Baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)   return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    if (days === 1)   return '1 hari lalu';
    if (days < 30)    return `${days} hari lalu`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 bulan lalu';
    if (months < 12)  return `${months} bulan lalu`;
    const years = Math.floor(months / 12);
    return `${years} tahun lalu`;
  } catch (_) {
    return isoStr;
  }
}

/**
 * Returns initials from a full name (first + last word).
 * @param {string} name
 * @returns {string}  Up to 2 uppercase characters
 */
function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/* ════════════════════════════════════════════════════════
   1. AUTH GUARD  (admin-only page)
   ════════════════════════════════════════════════════════ */
(function authGuard() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if ((user.role || '').toLowerCase() !== 'admin') {
      window.location.href = 'dashboard.html';
    }
  } catch (_) {
    window.location.href = 'login.html';
  }
})();

/* ════════════════════════════════════════════════════════
   2. USER INFO — populate sidebar user card
   ════════════════════════════════════════════════════════ */
(function userInfo() {
  try {
    const user   = JSON.parse(localStorage.getItem('user') || '{}');
    const name   = user.full_name || user.username || 'Admin';
    const role   = user.role || 'admin';
    const elName   = document.getElementById('user-name');
    const elRole   = document.getElementById('user-role');
    const elAvatar = document.getElementById('user-avatar');
    if (elName)   elName.textContent   = name;
    if (elRole)   elRole.textContent   = role;
    if (elAvatar) elAvatar.textContent = name.charAt(0).toUpperCase();
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
  if (cancel)  cancel.addEventListener('click',  () => modal.classList.add('hidden'));
  if (confirm) confirm.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  });
})();

/* ════════════════════════════════════════════════════════
   5. DEMO DATA
   ════════════════════════════════════════════════════════ */

/** @type {Array<{id:number, full_name:string, username:string, role:string, is_active:boolean, last_login:string}>} */
let allUsers = [];
let usersState = 'loading';   // 'loading' | 'ok' | 'error'

/** Muat daftar pengguna dari backend */
async function loadUsers() {
  try {
    const res = await fetch('/api/users/', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
    });
    if (!res.ok) throw new Error();
    const rows = await res.json();
    allUsers = rows.map(u => ({
      id: u.id,
      full_name: u.full_name,
      username: u.username,
      role: u.role,
      is_active: !!u.is_active,
      last_login: u.last_login_at,
    }));
    usersState = 'ok';
  } catch (_) {
    allUsers = [];
    usersState = 'error';
  }
  if (window._applyUserFilter) window._applyUserFilter();
  else renderTable(allUsers);
  updateKPIs();
}

/** Helper panggilan API /api/users */
async function userApi(method, path, body) {
  const res = await fetch('/api/users' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('token'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || ('HTTP ' + res.status));
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/* ════════════════════════════════════════════════════════
   6. KPI CARDS
   ════════════════════════════════════════════════════════ */
function updateKPIs() {
  const total    = allUsers.length;
  const admins   = allUsers.filter(u => u.role === 'admin'    && u.is_active).length;
  const analysts = allUsers.filter(u => u.role === 'analyst'  && u.is_active).length;
  const inactive = allUsers.filter(u => !u.is_active).length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('kpi-total',    total);
  set('kpi-admin',    admins);
  set('kpi-analyst',  analysts);
  set('kpi-inactive', inactive);
}

/* ════════════════════════════════════════════════════════
   7. TABLE RENDER
   ════════════════════════════════════════════════════════ */

/**
 * Builds the table body HTML and updates the subtitle counter.
 * @param {typeof allUsers} users
 */
function renderTable(users) {
  const tbody    = document.getElementById('user-table-body');
  const subtitle = document.getElementById('table-subtitle');
  if (!tbody) return;

  if (!users.length) {
    let msg;
    if (usersState === 'loading')    msg = 'Memuat data pengguna…';
    else if (usersState === 'error') msg = `Tidak dapat terhubung ke server backend (${window.location.origin}).`;
    else if (!allUsers.length)       msg = 'Belum ada pengguna di database.';
    else                             msg = 'Tidak ada pengguna yang sesuai filter.';
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="table-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/>
          </svg>
          ${msg}
        </div>
      </td></tr>`;
    if (subtitle) subtitle.textContent = '0 pengguna';
    return;
  }

  if (subtitle) {
    subtitle.textContent = `${users.length} pengguna${users.length !== allUsers.length ? ' ditemukan' : ''}`;
  }

  tbody.innerHTML = users.map((u, idx) => {
    const avatarClass = u.role === 'admin' ? 'admin' : 'analyst';
    const roleBadge   = u.role === 'admin'
      ? '<span class="badge accent">Admin</span>'
      : '<span class="badge info">Analyst</span>';
    const statusBadge = u.is_active
      ? '<span class="badge positive">Aktif</span>'
      : '<span class="badge negative">Nonaktif</span>';

    // Toggle button: pause icon for active (nonaktifkan), play icon for inactive (aktifkan)
    const toggleBtn = u.is_active
      ? `<button class="action-btn danger" data-action="toggle" data-id="${u.id}" title="Nonaktifkan pengguna">
           <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
             <rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/>
             <rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/>
           </svg>
         </button>`
      : `<button class="action-btn activate" data-action="toggle" data-id="${u.id}" title="Aktifkan pengguna">
           <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
             <path d="M6 4.5l10 5.5-10 5.5V4.5z" fill="currentColor" stroke="none"/>
           </svg>
         </button>`;

    return `<tr>
      <td style="color:#5C5A8A;text-align:right;font-variant-numeric:tabular-nums">${idx + 1}</td>
      <td>
        <div class="user-avatar-cell">
          <div class="user-avatar-sm ${esc(avatarClass)}">${esc(initials(u.full_name))}</div>
          <div>
            <div class="user-fullname">${esc(u.full_name)}</div>
            <div class="user-username">@${esc(u.username)}</div>
          </div>
        </div>
      </td>
      <td style="color:#9896C8">@${esc(u.username)}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td style="color:#5C5A8A;font-size:11px">${esc(formatRelativeDate(u.last_login))}</td>
      <td style="white-space:nowrap">
        <div style="display:flex;align-items:center;gap:4px">
          <button class="action-btn" data-action="edit" data-id="${u.id}" title="Edit pengguna">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L6 17H3v-3L13.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          ${toggleBtn}
          <button class="action-btn" data-action="reset-password" data-id="${u.id}" title="Reset password">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="10" cy="13" r="5.25"/>
              <path d="M7.25 13a2.75 2.75 0 1 1 5.5 0" stroke-linecap="round"/>
              <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none"/>
              <path d="M10 7.75V5m-2 2.25L10 5l2 2.25" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════
   8. SEARCH + FILTER
   ════════════════════════════════════════════════════════ */
(function searchFilter() {
  const searchEl  = document.getElementById('search-input');
  const roleEl    = document.getElementById('filter-role');
  const statusEl  = document.getElementById('filter-status');

  function applyFilter() {
    const q      = (searchEl  ? searchEl.value.toLowerCase().trim()  : '');
    const role   = (roleEl    ? roleEl.value.toLowerCase()            : '');
    const status = (statusEl  ? statusEl.value                        : '');

    const filtered = allUsers.filter(u => {
      const matchQ = !q ||
        u.full_name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q);
      const matchRole   = !role   || u.role === role;
      const matchStatus = !status ||
        (status === 'active'   &&  u.is_active) ||
        (status === 'inactive' && !u.is_active);
      return matchQ && matchRole && matchStatus;
    });

    renderTable(filtered);
  }

  if (searchEl) searchEl.addEventListener('input',  applyFilter);
  if (roleEl)   roleEl.addEventListener('change',   applyFilter);
  if (statusEl) statusEl.addEventListener('change', applyFilter);

  // Expose re-render helper for after data mutations
  window._applyUserFilter = applyFilter;
})();

/* ════════════════════════════════════════════════════════
   INITIAL RENDER
   ════════════════════════════════════════════════════════ */
(function init() {
  renderTable(allUsers);   // tampilkan state "memuat"
  updateKPIs();
  loadUsers();             // ambil data nyata dari backend
})();

/* ════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════ */

/**
 * Show a brief floating toast notification.
 * @param {string} message
 * @param {'positive'|'negative'|'warn'|'info'} type
 */
function showToast(message, type = 'positive') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    positive: `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10.5l4.5 4.5 7.5-8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    negative: `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/></svg>`,
    warn:     `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 6v5m0 3v.5" stroke-linecap="round"/><path d="M10 2L2 17h16L10 2z" stroke-linejoin="round"/></svg>`,
    info:     `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7.25"/><path d="M10 9v5m0-7v.5" stroke-linecap="round"/></svg>`,
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon ${esc(type)}">${icons[type] || icons.info}</div>
    <span>${esc(message)}</span>`;

  container.appendChild(toast);

  // Auto-dismiss after 3s
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 220);
  }, 3000);
}

/* ════════════════════════════════════════════════════════
   MODAL HELPERS
   ════════════════════════════════════════════════════════ */

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

/** Wire up all close buttons (data-modal="id") and overlay-click */
(function wireModalClose() {
  document.addEventListener('click', e => {
    // Close button inside modal
    const btn = e.target.closest('[data-modal]');
    if (btn && btn.classList.contains('modal-close-btn')) {
      closeModal(btn.dataset.modal);
      return;
    }
    if (btn && btn.classList.contains('btn-cancel')) {
      closeModal(btn.dataset.modal);
      return;
    }
    // Overlay click
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.add('hidden');
    }
  });
})();

/* ════════════════════════════════════════════════════════
   9. TABLE EVENT DELEGATION
   ════════════════════════════════════════════════════════ */

/** Currently targeted user ID for modals */
let activeUserId = null;

(function tableDelegate() {
  const tbody = document.getElementById('user-table-body');
  if (!tbody) return;

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id     = parseInt(btn.dataset.id, 10);
    const user   = allUsers.find(u => u.id === id);
    if (!user) return;

    activeUserId = id;

    if (action === 'edit')           openEditModal(user);
    if (action === 'toggle')         openToggleModal(user);
    if (action === 'reset-password') openResetModal(user);
  });
})();

/* ════════════════════════════════════════════════════════
   10. MODAL: TAMBAH PENGGUNA
   ════════════════════════════════════════════════════════ */
(function modalAddUser() {
  const btnOpen  = document.getElementById('btn-add-user');
  const form     = document.getElementById('form-add-user');
  const selector = document.getElementById('add-role-selector');

  let selectedRole = 'analyst';

  // Open
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      resetAddForm();
      openModal('modal-add-user');
    });
  }

  // Role selector
  if (selector) {
    selector.addEventListener('click', e => {
      const opt = e.target.closest('.role-opt');
      if (!opt) return;
      selectedRole = opt.dataset.role;
      selector.querySelectorAll('.role-opt').forEach(o => {
        o.classList.toggle('selected', o.dataset.role === selectedRole);
      });
    });
  }

  // Submit
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validateAddForm()) return;

      const nama      = document.getElementById('add-nama').value.trim();
      const username  = document.getElementById('add-username').value.trim();
      const password  = document.getElementById('add-password').value;

      try {
        await userApi('POST', '/', { full_name: nama, username, password, role: selectedRole });
        await loadUsers();
        closeModal('modal-add-user');
        resetAddForm();
        showToast(`Pengguna "${nama}" berhasil ditambahkan`, 'positive');
      } catch (err) {
        showFieldError('add-username', 'err-add-username', err.message);
      }
    });
  }

  function resetAddForm() {
    if (!form) return;
    form.reset();
    selectedRole = 'analyst';
    if (selector) {
      selector.querySelectorAll('.role-opt').forEach(o => {
        o.classList.toggle('selected', o.dataset.role === 'analyst');
      });
    }
    clearAddErrors();
  }

  function clearAddErrors() {
    ['add-nama','add-username','add-password','add-konfirmasi'].forEach(id => {
      const inp = document.getElementById(id);
      const err = document.getElementById(`err-${id}`);
      if (inp) inp.classList.remove('err');
      if (err) { err.textContent = ''; err.classList.remove('show'); }
    });
  }

  function showFieldError(inputId, errId, msg) {
    const inp = document.getElementById(inputId);
    const err = document.getElementById(errId);
    if (inp) inp.classList.add('err');
    if (err) { err.textContent = msg; err.classList.add('show'); }
  }

  function clearFieldError(inputId, errId) {
    const inp = document.getElementById(inputId);
    const err = document.getElementById(errId);
    if (inp) inp.classList.remove('err');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
  }

  function validateAddForm() {
    clearAddErrors();
    let valid = true;

    const nama     = document.getElementById('add-nama')?.value.trim()  || '';
    const username = document.getElementById('add-username')?.value.trim() || '';
    const password = document.getElementById('add-password')?.value    || '';
    const konfirm  = document.getElementById('add-konfirmasi')?.value  || '';

    if (!nama) {
      showFieldError('add-nama', 'err-add-nama', 'Nama lengkap wajib diisi.');
      valid = false;
    }

    if (!username) {
      showFieldError('add-username', 'err-add-username', 'Username wajib diisi.');
      valid = false;
    } else if (username.length < 4) {
      showFieldError('add-username', 'err-add-username', 'Username minimal 4 karakter.');
      valid = false;
    } else if (/\s/.test(username)) {
      showFieldError('add-username', 'err-add-username', 'Username tidak boleh mengandung spasi.');
      valid = false;
    } else if (allUsers.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      showFieldError('add-username', 'err-add-username', 'Username sudah digunakan.');
      valid = false;
    }

    if (!password) {
      showFieldError('add-password', 'err-add-password', 'Password wajib diisi.');
      valid = false;
    } else if (password.length < 8) {
      showFieldError('add-password', 'err-add-password', 'Password minimal 8 karakter.');
      valid = false;
    }

    if (!konfirm) {
      showFieldError('add-konfirmasi', 'err-add-konfirmasi', 'Konfirmasi password wajib diisi.');
      valid = false;
    } else if (password && konfirm !== password) {
      showFieldError('add-konfirmasi', 'err-add-konfirmasi', 'Password tidak cocok.');
      valid = false;
    }

    return valid;
  }

  // Expose for external call (reset on open)
  window._resetAddUserForm = resetAddForm;
})();

/* ════════════════════════════════════════════════════════
   11. MODAL: EDIT PENGGUNA
   ════════════════════════════════════════════════════════ */

let editSelectedRole = 'analyst';

function openEditModal(user) {
  editSelectedRole = user.role;

  // Preview header
  const prevAvatar   = document.getElementById('edit-preview-avatar');
  const prevName     = document.getElementById('edit-preview-name');
  const prevUsername = document.getElementById('edit-preview-username');
  if (prevAvatar) {
    prevAvatar.textContent = initials(user.full_name);
    prevAvatar.className   = `user-avatar-sm ${user.role === 'admin' ? 'admin' : 'analyst'}`;
  }
  if (prevName)     prevName.textContent     = user.full_name;
  if (prevUsername) prevUsername.textContent = `@${user.username}`;

  // Fill fields
  const namaEl = document.getElementById('edit-nama');
  if (namaEl) namaEl.value = user.full_name;

  // Role selector
  const selector = document.getElementById('edit-role-selector');
  if (selector) {
    selector.querySelectorAll('.role-opt').forEach(o => {
      o.classList.toggle('selected', o.dataset.role === user.role);
    });
  }

  // Clear errors
  const errEl = document.getElementById('err-edit-nama');
  const inpEl = document.getElementById('edit-nama');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  if (inpEl) inpEl.classList.remove('err');

  openModal('modal-edit-user');
}

(function modalEditUser() {
  const selector = document.getElementById('edit-role-selector');
  const form     = document.getElementById('form-edit-user');

  // Role selector clicks
  if (selector) {
    selector.addEventListener('click', e => {
      const opt = e.target.closest('.role-opt');
      if (!opt) return;
      editSelectedRole = opt.dataset.role;
      selector.querySelectorAll('.role-opt').forEach(o => {
        o.classList.toggle('selected', o.dataset.role === editSelectedRole);
      });
    });
  }

  // Submit
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const nama  = document.getElementById('edit-nama')?.value.trim() || '';
      const errEl = document.getElementById('err-edit-nama');
      const inpEl = document.getElementById('edit-nama');

      if (!nama) {
        if (inpEl) inpEl.classList.add('err');
        if (errEl) { errEl.textContent = 'Nama lengkap wajib diisi.'; errEl.classList.add('show'); }
        return;
      }

      try {
        await userApi('PUT', '/' + activeUserId, { full_name: nama, role: editSelectedRole });
        await loadUsers();
        closeModal('modal-edit-user');
        showToast(`Data pengguna "${nama}" berhasil diperbarui`, 'positive');
      } catch (err) {
        if (inpEl) inpEl.classList.add('err');
        if (errEl) { errEl.textContent = err.message; errEl.classList.add('show'); }
      }
    });
  }
})();

/* ════════════════════════════════════════════════════════
   12. MODAL: TOGGLE STATUS
   ════════════════════════════════════════════════════════ */

function openToggleModal(user) {
  const title       = document.getElementById('toggle-modal-title');
  const desc        = document.getElementById('toggle-modal-desc');
  const namePreview = document.getElementById('toggle-user-name-preview');
  const iconWrap    = document.getElementById('toggle-icon-wrap');
  const confirmBtn  = document.getElementById('btn-confirm-toggle');

  if (user.is_active) {
    // Will deactivate
    if (title) title.textContent = 'Nonaktifkan Pengguna?';
    if (desc)  desc.textContent  = `Pengguna tidak akan bisa login sampai akun diaktifkan kembali.`;
    if (iconWrap) {
      iconWrap.className = 'w-9 h-9 rounded-[10px] bg-negative/10 border border-negative/20 flex items-center justify-center text-negative flex-shrink-0 mt-[1px]';
      iconWrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/>
        <rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" stroke="none"/>
      </svg>`;
    }
    if (confirmBtn) {
      confirmBtn.textContent  = 'Nonaktifkan';
      confirmBtn.className    = 'btn-danger';
    }
  } else {
    // Will activate
    if (title) title.textContent = 'Aktifkan Pengguna?';
    if (desc)  desc.textContent  = `Pengguna akan bisa login kembali ke sistem.`;
    if (iconWrap) {
      iconWrap.className = 'w-9 h-9 rounded-[10px] bg-positive/10 border border-positive/20 flex items-center justify-center text-positive flex-shrink-0 mt-[1px]';
      iconWrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M6 4.5l10 5.5-10 5.5V4.5z" fill="currentColor" stroke="none"/>
      </svg>`;
    }
    if (confirmBtn) {
      confirmBtn.textContent  = 'Aktifkan';
      confirmBtn.className    = 'btn-accent';
    }
  }

  if (namePreview) namePreview.textContent = `${user.full_name} (@${user.username})`;

  openModal('modal-toggle-status');
}

(function modalToggleStatus() {
  const confirmBtn = document.getElementById('btn-confirm-toggle');
  if (!confirmBtn) return;

  confirmBtn.addEventListener('click', async () => {
    const user = allUsers.find(u => u.id === activeUserId);
    if (!user) return;

    const wasActive = user.is_active;
    try {
      await userApi('PUT', '/' + activeUserId, { is_active: wasActive ? 0 : 1 });
      await loadUsers();
      closeModal('modal-toggle-status');
      const msg = wasActive
        ? `Pengguna "${user.full_name}" telah dinonaktifkan`
        : `Pengguna "${user.full_name}" telah diaktifkan kembali`;
      showToast(msg, wasActive ? 'warn' : 'positive');
    } catch (err) {
      closeModal('modal-toggle-status');
      showToast('Gagal: ' + err.message, 'negative');
    }
  });
})();

/* ════════════════════════════════════════════════════════
   13. MODAL: RESET PASSWORD
   ════════════════════════════════════════════════════════ */

function openResetModal(user) {
  const subtitle   = document.getElementById('reset-user-subtitle');
  const prevAvatar = document.getElementById('reset-preview-avatar');
  const prevName   = document.getElementById('reset-preview-name');
  const prevUser   = document.getElementById('reset-preview-username');

  if (subtitle)   subtitle.textContent   = `Reset password untuk ${user.full_name}`;
  if (prevAvatar) {
    prevAvatar.textContent = initials(user.full_name);
    prevAvatar.className   = `user-avatar-sm ${user.role === 'admin' ? 'admin' : 'analyst'}`;
  }
  if (prevName)   prevName.textContent   = user.full_name;
  if (prevUser)   prevUser.textContent   = `@${user.username}`;

  // Clear fields + errors
  const form = document.getElementById('form-reset-password');
  if (form) form.reset();
  clearResetErrors();

  openModal('modal-reset-password');
}

function clearResetErrors() {
  ['reset-password','reset-konfirmasi'].forEach(id => {
    const inp = document.getElementById(id);
    const err = document.getElementById(`err-${id}`);
    if (inp) inp.classList.remove('err');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
  });
}

(function modalResetPassword() {
  const form = document.getElementById('form-reset-password');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearResetErrors();

    const password = document.getElementById('reset-password')?.value    || '';
    const konfirm  = document.getElementById('reset-konfirmasi')?.value  || '';
    let valid = true;

    if (!password || password.length < 8) {
      const inp = document.getElementById('reset-password');
      const err = document.getElementById('err-reset-password');
      if (inp) inp.classList.add('err');
      if (err) { err.textContent = !password ? 'Password wajib diisi.' : 'Password minimal 8 karakter.'; err.classList.add('show'); }
      valid = false;
    }

    if (!konfirm) {
      const inp = document.getElementById('reset-konfirmasi');
      const err = document.getElementById('err-reset-konfirmasi');
      if (inp) inp.classList.add('err');
      if (err) { err.textContent = 'Konfirmasi password wajib diisi.'; err.classList.add('show'); }
      valid = false;
    } else if (password && konfirm !== password) {
      const inp = document.getElementById('reset-konfirmasi');
      const err = document.getElementById('err-reset-konfirmasi');
      if (inp) inp.classList.add('err');
      if (err) { err.textContent = 'Password tidak cocok.'; err.classList.add('show'); }
      valid = false;
    }

    if (!valid) return;

    const user = allUsers.find(u => u.id === activeUserId);
    const name = user ? user.full_name : 'Pengguna';

    try {
      await userApi('PUT', '/' + activeUserId, { password });
      closeModal('modal-reset-password');
      form.reset();
      showToast(`Password "${name}" berhasil direset`, 'positive');
    } catch (err) {
      showToast('Gagal: ' + err.message, 'negative');
    }
  });
})();

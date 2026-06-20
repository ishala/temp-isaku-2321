/* ═══════════════════════════════════════════════════════
   preprocessing.js — tahap data mentah → preprocessing → DB
   ═══════════════════════════════════════════════════════ */
const API = 'http://localhost:8000';

/* ── Auth guard ── */
(function () {
  if (!localStorage.getItem('token')) window.location.href = 'login.html';
})();

/* ── User info ── */
(function () {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const name = user.full_name || user.username || 'Pengguna';
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-role').textContent = user.role || 'analyst';
    document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
    if (user.role !== 'admin') {
      const sec = document.getElementById('admin-section');
      const nav = document.getElementById('nav-pengguna');
      const navAct = document.getElementById('nav-aktivitas');
      if (sec) sec.style.display = 'none';
      if (nav) nav.style.display = 'none';
      if (navAct) navAct.style.display = 'none';
    }
  } catch (_) {}
})();

/* ── Date display ── */
(function () {
  const el = document.getElementById('date-display');
  if (el) el.textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
})();

/* ── Logout modal ── */
(function () {
  const btn = document.getElementById('logout-btn');
  const modal = document.getElementById('logout-modal');
  const cancel = document.getElementById('modal-cancel');
  const confirm = document.getElementById('modal-confirm');
  if (!btn || !modal) return;
  btn.addEventListener('click', () => modal.classList.remove('hidden'));
  cancel.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  confirm.addEventListener('click', () => { localStorage.clear(); window.location.href = 'login.html'; });
})();

/* ── Helpers ── */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function authHeaders(json) {
  const h = { 'Authorization': 'Bearer ' + localStorage.getItem('token') };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

let dataState = 'loading';   // 'loading' | 'ok' | 'empty' | 'error'
let pending = [];

/* ── Load stats ── */
async function loadStats() {
  try {
    const res = await fetch(`${API}/api/preprocess/stats`, { headers: authHeaders() });
    if (!res.ok) throw new Error();
    const s = await res.json();
    setStats(s.total, s.preprocessed, s.pending);
  } catch (_) {
    setStats(0, 0, 0);
  }
}
function setStats(total, done, pend) {
  document.getElementById('pp-total').textContent   = (total || 0).toLocaleString('id-ID');
  document.getElementById('pp-done').textContent    = (done || 0).toLocaleString('id-ID');
  document.getElementById('pp-pending').textContent = (pend || 0).toLocaleString('id-ID');
}

/* ── Load pending list ── */
async function loadPending() {
  try {
    const res = await fetch(`${API}/api/preprocess/pending?limit=500`, { headers: authHeaders() });
    if (!res.ok) throw new Error();
    pending = await res.json();
    dataState = pending.length ? 'ok' : 'empty';
  } catch (_) {
    pending = [];
    dataState = 'error';
  }
  renderPending();
}

function renderPending() {
  const tbody = document.getElementById('pp-tbody');
  const empty = document.getElementById('pp-empty');
  const sub   = document.getElementById('pp-list-sub');
  document.getElementById('pp-check-all').checked = false;

  if (!pending.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent =
      dataState === 'error'
        ? 'Tidak dapat terhubung ke server backend (http://localhost:8000).'
        : 'Tidak ada data mentah yang menunggu. Lakukan scraping di halaman Data Ulasan terlebih dahulu.';
    sub.textContent = dataState === 'error' ? 'Server tidak terhubung' : 'Tidak ada antrean';
    return;
  }
  empty.style.display = 'none';
  sub.textContent = `${pending.length} ulasan menunggu`;

  tbody.innerHTML = pending.map(r => `
    <tr data-id="${r.id}">
      <td><input type="checkbox" class="pp-row-check" data-id="${r.id}" /></td>
      <td class="col-teks" title="${esc(r.teks)}">${esc(r.teks)}</td>
      <td>${r.bintang ? r.bintang + '★' : '—'}</td>
      <td class="text-[11px]">${esc(r.source || '-')}</td>
    </tr>`).join('');
}

/* ── Select-all ── */
document.getElementById('pp-check-all').addEventListener('change', e => {
  document.querySelectorAll('.pp-row-check').forEach(c => { c.checked = e.target.checked; });
});

/* ── Row click → preview (abaikan klik checkbox) ── */
document.getElementById('pp-tbody').addEventListener('click', e => {
  if (e.target.closest('input')) return;
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  document.querySelectorAll('#pp-tbody tr').forEach(r => r.classList.remove('selected'));
  tr.classList.add('selected');
  showPreview(parseInt(tr.dataset.id, 10));
});

/* ── Preview steps ── */
async function showPreview(id) {
  const emptyEl = document.getElementById('pp-preview-empty');
  const stepsEl = document.getElementById('pp-preview-steps');
  emptyEl.style.display = 'none';
  stepsEl.classList.remove('hidden');
  stepsEl.innerHTML = '<p class="text-[12px] text-c3">Memproses…</p>';

  try {
    const res = await fetch(`${API}/api/preprocess/preview/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error();
    renderSteps(await res.json());
  } catch (_) {
    stepsEl.innerHTML = '<p class="text-[12px]" style="color:#F87171">Tidak dapat memproses di server. Pastikan backend berjalan.</p>';
  }
}

function renderSteps(d) {
  const steps = [
    { label: 'Teks Asli', text: d.original },
    { label: 'Cleaning (emoji, lowercase, elongasi, URL, simbol, angka)', text: d.cleaned },
    { label: 'Normalisasi Slang (kamus tidak baku → baku)', text: d.normalized },
    { label: 'Stopword Removal', text: d.no_stopword },
    { label: 'Stemming (Sastrawi + Porter) — siap untuk TF-IDF', text: d.stemmed },
  ];
  document.getElementById('pp-preview-steps').innerHTML = steps.map((s, i) => `
    <div class="pp-step">
      <div class="pp-step-label"><span class="pp-step-num">${i + 1}</span>${esc(s.label)}</div>
      <div class="pp-step-text ${s.text ? '' : 'muted'}">${s.text ? esc(s.text) : '(kosong)'}</div>
    </div>`).join('');
}

/* ── Run preprocessing ── */
document.getElementById('btn-run-pp').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-pp');
  const checked = [...document.querySelectorAll('.pp-row-check:checked')].map(c => parseInt(c.dataset.id, 10));
  const ids = checked.length ? checked : null;   // null = semua pending

  setRunLoading(btn, true);
  try {
    const res = await fetch(`${API}/api/preprocess/run`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ review_ids: ids }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Gagal'); }
    const data = await res.json();
    await loadStats();
    await loadPending();
    flash(`${data.processed} ulasan dipreprocess. Lanjut ke halaman Analisis untuk prediksi.`, 'ok');
  } catch (err) {
    flash('Gagal: ' + err.message, 'error');
  } finally {
    setRunLoading(btn, false);
  }
});

function setRunLoading(btn, on) {
  btn.disabled = on;
  btn.querySelector('.pp-run-text').style.display = on ? 'none' : '';
  btn.querySelector('.pp-run-spinner').style.display = on ? 'block' : 'none';
}

/* ── Toast ── */
function flash(msg, type) {
  let el = document.getElementById('pp-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pp-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'padding:11px 18px;border-radius:10px;font-size:12px;font-family:Inter,sans-serif;font-weight:500;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .2s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#F87171' : '#4ADE80';
  el.style.color = '#0b0b12';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

/* ── Init ── */
loadStats();
loadPending();

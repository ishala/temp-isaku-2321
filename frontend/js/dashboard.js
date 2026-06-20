/* ═══════════════════════════════════════════════════════
   dashboard.js — i.saku Sentiment Analytics
   ═══════════════════════════════════════════════════════ */

/* ── Auth guard ── */
(function () {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = 'login.html';
})();

/* ── User info ── */
(function () {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const name = user.full_name || user.username || 'Pengguna';
    const role = user.role || 'analyst';

    document.getElementById('user-name').textContent = name;
    document.getElementById('user-role').textContent = role;
    document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

    if (role !== 'admin') {
      document.getElementById('admin-section').style.display = 'none';
      document.getElementById('nav-pengguna').style.display = 'none';
      const navAct = document.getElementById('nav-aktivitas');
      if (navAct) navAct.style.display = 'none';
    }
  } catch (_) {}
})();

/* ── Date display ── */
(function () {
  const el = document.getElementById('date-display');
  const now = new Date();
  el.textContent = now.toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
})();

/* ── Theme-aware chart colors (dibaca dari CSS var, ikut tema) ── */
function chartChrome() {
  const cv = getComputedStyle(document.documentElement);
  const line = cv.getPropertyValue('--line-rgb').trim() || '255 255 255';
  const c3   = cv.getPropertyValue('--c-c3').trim()     || '92 90 138';
  const page = cv.getPropertyValue('--page').trim()     || '#080810';
  return {
    grid:    `rgb(${line} / 0.05)`,
    hover:   `rgb(${line} / 0.12)`,
    axis:    `rgb(${c3} / 0.85)`,
    axisDim: `rgb(${c3} / 0.70)`,
    stroke:  page,
  };
}

/* ── Navigation ── */
const pages = {
  dashboard:     { title: 'Dashboard',           sub: 'Ringkasan performa model &amp; distribusi sentimen' },
  analisis:      { title: 'Analisis Ulasan',     sub: 'Input atau unggah ulasan untuk diklasifikasikan' },
  perbandingan:  { title: 'Perbandingan Model',  sub: 'NB vs SVM — metrik evaluasi &amp; visualisasi' },
  laporan:       { title: 'Laporan',             sub: 'Export hasil analisis ke PDF / Excel' },
  dataset:       { title: 'Dataset',             sub: 'Kelola data latih &amp; data uji' },
  preprocessing: { title: 'Preprocessing',       sub: 'Pipeline tokenisasi, stemming, dan TF-IDF' },
  pengguna:      { title: 'Manajemen Pengguna',  sub: 'Kelola akun &amp; role pengguna' },
};

let currentPage = 'dashboard';

function navigateTo(pageId) {
  if (!document.getElementById('page-' + pageId)) return;
  currentPage = pageId;

  Object.keys(pages).forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.add('hidden');
  });

  document.getElementById('page-' + pageId).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  const meta = pages[pageId];
  if (meta) {
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-subtitle').innerHTML = meta.sub;
  }
}

document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', e => {
    const href = link.getAttribute('href');
    if (href && href !== '#') return;
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

/* ── Logout modal ── */
const logoutBtn    = document.getElementById('logout-btn');
const modal        = document.getElementById('logout-modal');
const modalCancel  = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

logoutBtn.addEventListener('click', () => modal.classList.remove('hidden'));
modalCancel.addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
modalConfirm.addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
});

/* ── Panduan (pop-up tata cara) ── */
(function () {
  const gModal  = document.getElementById('guide-modal');
  const gOpen   = document.getElementById('btn-panduan');
  const gClose  = document.getElementById('guide-close');
  const gCancel = document.getElementById('guide-cancel');
  if (!gModal || !gOpen) return;
  const show = () => gModal.classList.remove('hidden');
  const hide = () => gModal.classList.add('hidden');
  gOpen.addEventListener('click', show);
  if (gClose)  gClose.addEventListener('click', hide);
  if (gCancel) gCancel.addEventListener('click', hide);
  gModal.addEventListener('click', e => { if (e.target === gModal) hide(); });
})();

/* ════════════════════════════════════════════════════════
   SHARED TOOLTIP
   ════════════════════════════════════════════════════════ */
const tooltip = (() => {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:9999', 'display:none',
    'background:#10101E', 'border:0.5px solid rgba(255,255,255,.1)',
    'border-radius:8px', 'padding:8px 12px',
    'font-family:Inter,sans-serif', 'font-size:11px', 'color:#9896C8',
    'white-space:nowrap', 'box-shadow:0 8px 24px rgba(0,0,0,.55)',
    'transition:opacity .1s',
  ].join(';');
  document.body.appendChild(el);
  return el;
})();

function showTooltip(html, clientX, clientY) {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';

  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = clientX + 14;
  let top  = clientY - 10;
  if (left + tw > vw - 8) left = clientX - tw - 14;
  if (top + th  > vh - 8) top  = vh - th - 8;
  if (top < 8) top = 8;

  tooltip.style.left = left + 'px';
  tooltip.style.top  = top  + 'px';
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

/* ════════════════════════════════════════════════════════
   TREND CHART
   ════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('canvas-trend');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let labels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun'];
  let datasets = {
    all: { positive: [], negative: [] },
    nb:  { positive: [], negative: [] },
    svm: { positive: [], negative: [] },
  };

  const SERIES = [
    { key: 'positive', color: '#4ADE80', label: 'Positif', dashed: false },
    { key: 'negative', color: '#F87171', label: 'Negatif', dashed: true  },
  ];

  const PAD = { l: 36, r: 16, t: 12, b: 28 };

  let activeFilter = 'all';
  let hoveredCol   = null;
  let hasData      = false;   // diisi dari /api/reports/trend

  /* ── helpers ── */
  function colX(i, cw) {
    return PAD.l + (i / (labels.length - 1)) * cw;
  }

  function valY(v, ch) {
    return PAD.t + ch - (v / 100) * ch;
  }

  /* ── draw ── */
  function drawTrend(filter, hovCol = null) {
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const cw = W - PAD.l - PAD.r;
    const ch = H - PAD.t - PAD.b;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    const data = datasets[filter] || datasets.all;
    const ck = chartChrome();

    /* Empty state — belum ada data dari database */
    if (!hasData) {
      ctx.fillStyle = ck.axisDim;
      ctx.font = '12px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Belum ada data tren di database', W / 2, H / 2);
      return;
    }

    /* grid + Y labels */
    ctx.strokeStyle = ck.grid;
    ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(val => {
      const y = valY(val, ch);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = ck.axisDim;
      ctx.font = '9px Inter,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val + '%', PAD.l - 6, y + 3);
    });

    /* X labels */
    ctx.fillStyle = ck.axis;
    ctx.font = '9px Inter,sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((l, i) => {
      ctx.fillText(l, colX(i, cw), H - PAD.b + 16);
    });

    /* Vertical hover indicator */
    if (hovCol !== null) {
      const x = colX(hovCol, cw);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ch);
      ctx.strokeStyle = ck.hover;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.restore();
    }

    /* Series lines */
    SERIES.forEach(({ key, color, dashed }) => {
      const values = data[key];
      ctx.save();

      /* line */
      ctx.beginPath();
      if (dashed) ctx.setLineDash([4, 3]);
      values.forEach((v, i) => {
        const x = colX(i, cw), y = valY(v, ch);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      ctx.stroke();

      /* area fill */
      ctx.lineTo(colX(labels.length - 1, cw), PAD.t + ch);
      ctx.lineTo(PAD.l, PAD.t + ch);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
      grad.addColorStop(0, color + '1a'); /* ~10% opacity */
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.restore();

      /* dots */
      values.forEach((v, i) => {
        const x = colX(i, cw), y = valY(v, ch);
        const hov = hovCol === i;
        const r   = hov ? 5 : 3;

        ctx.save();
        if (hov) {
          /* outer glow ring */
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = color + '22';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = ck.stroke;
        ctx.lineWidth = hov ? 2 : 1.5;
        ctx.stroke();
        ctx.restore();
      });
    });
  }

  /* ── initial draw ── */
  drawTrend(activeFilter);
  window.addEventListener('resize', () => drawTrend(activeFilter, hoveredCol));
  window.addEventListener('themechange', () => drawTrend(activeFilter, hoveredCol));

  /* ── update dari data backend ── */
  window.addEventListener('dashboard:trend', (e) => {
    const d = e.detail;
    if (d && d.labels && d.labels.length) {
      labels = d.labels;
      datasets = d.datasets;
      hasData = true;
    } else {
      hasData = false;
    }
    hoveredCol = null;
    drawTrend(activeFilter, null);
  });

  /* ── filter buttons ── */
  document.querySelectorAll('[data-chart-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-chart-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.chartFilter;
      drawTrend(activeFilter, hoveredCol);
    });
  });

  /* ── hover interactivity ── */
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    const cw = rect.width - PAD.l - PAD.r;

    /* find nearest column within 28px */
    let nearest = null;
    let minDist  = Infinity;
    labels.forEach((_, i) => {
      const dist = Math.abs(mouseX - colX(i, cw));
      if (dist < minDist && dist < 28) { minDist = dist; nearest = i; }
    });

    if (nearest !== hoveredCol) {
      hoveredCol = nearest;
      drawTrend(activeFilter, hoveredCol);
    }

    if (nearest !== null) {
      const data = datasets[activeFilter] || datasets.all;
      const html = `
        <div style="font-size:10px;color:#5C5A8A;text-transform:uppercase;
                    letter-spacing:.08em;margin-bottom:6px;font-weight:500;">
          ${labels[nearest]}
        </div>
        ${SERIES.map(({ color, label, key }) => `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <div style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></div>
            <span>${label}</span>
            <span style="color:#EEECff;font-weight:600;margin-left:8px;">${data[key][nearest]}%</span>
          </div>`).join('')}
      `;
      showTooltip(html, e.clientX, e.clientY);
      canvas.style.cursor = 'crosshair';
    } else {
      hideTooltip();
      canvas.style.cursor = '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredCol = null;
    hideTooltip();
    canvas.style.cursor = '';
    drawTrend(activeFilter, null);
  });
})();

/* ════════════════════════════════════════════════════════
   DONUT CHART
   ════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('canvas-donut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let SLICES = [];   // diisi dari /api/reports/stats

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = 160 * dpr;
  canvas.height = 160 * dpr;
  canvas.style.width  = '160px';
  canvas.style.height = '160px';
  ctx.scale(dpr, dpr);

  const CX = 80, CY = 80, RO = 68, RI = 50;
  const GAP = 0.025;
  let total = 0;
  let sliceAngles = [];

  function computeAngles() {
    total = SLICES.reduce((s, sl) => s + sl.value, 0) || 1;
    const g = SLICES.length > 1 ? GAP : 0;   // tanpa gap bila hanya 1 slice (100%)
    sliceAngles = [];
    let a = -Math.PI / 2;
    SLICES.forEach(sl => {
      const sweep = (sl.value / total) * Math.PI * 2 - g;
      sliceAngles.push({ start: a, end: a + sweep });
      a += sweep + g;
    });
  }

  function drawDonut(hovIdx = null) {
    ctx.clearRect(0, 0, 160, 160);

    if (!SLICES.length || total <= 0) {
      /* Empty state — ring abu-abu */
      ctx.beginPath();
      ctx.arc(CX, CY, RO, 0, Math.PI * 2);
      ctx.arc(CX, CY, RI, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fillStyle = chartChrome().grid;
      ctx.fill();
      return;
    }

    const g = SLICES.length > 1 ? GAP : 0;
    let angle = -Math.PI / 2;
    SLICES.forEach((sl, idx) => {
      const sweep = (sl.value / total) * Math.PI * 2 - g;
      const hov   = hovIdx === idx;

      ctx.save();

      if (hov) {
        /* slight scale-out on hover */
        ctx.translate(CX, CY);
        const mid = angle + sweep / 2;
        ctx.translate(Math.cos(mid) * 3, Math.sin(mid) * 3);
        ctx.translate(-CX, -CY);
      }

      ctx.beginPath();
      ctx.arc(CX, CY, hov ? RO + 4 : RO, angle, angle + sweep);
      ctx.arc(CX, CY, RI, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = sl.color;
      ctx.globalAlpha = hov ? 1 : 0.82;
      ctx.fill();
      ctx.restore();

      angle += sweep + g;
    });
  }

  drawDonut();

  const centerValEl = document.getElementById('donut-center-val');
  const centerLblEl = document.getElementById('donut-center-label');

  function pctStr(v) { return v.toFixed(1).replace('.', ',') + '%'; }

  /* ── Update distribusi dari backend (pos & neg = jumlah) ── */
  function updateDistribution(pos, neg) {
    const t = pos + neg;
    if (t <= 0) {
      SLICES = [];
      computeAngles();
      drawDonut();
      if (centerValEl) { centerValEl.textContent = '—'; centerValEl.style.color = ''; }
      const lp = document.getElementById('legend-pos');
      const ln = document.getElementById('legend-neg');
      if (lp) lp.innerHTML = '— <span class="text-c3 font-normal">—</span>';
      if (ln) ln.innerHTML = '— <span class="text-c3 font-normal">—</span>';
      return;
    }
    const posPct = +(pos / t * 100).toFixed(1);
    const negPct = +(neg / t * 100).toFixed(1);

    /* Chart hanya memuat slice > 0 supaya 100%/0% tidak menghasilkan sweep negatif */
    SLICES = [
      { value: posPct, color: '#4ADE80', label: 'Positif', count: pos.toLocaleString('id-ID') },
      { value: negPct, color: '#F87171', label: 'Negatif', count: neg.toLocaleString('id-ID') },
    ].filter(s => s.value > 0);
    computeAngles();
    drawDonut();

    /* Teks tengah mengikuti kelas dominan */
    const posDom = posPct >= negPct;
    const col = posDom ? '#4ADE80' : '#F87171';
    if (centerValEl) { centerValEl.textContent = Math.round(posDom ? posPct : negPct) + '%'; centerValEl.style.color = col; }
    if (centerLblEl) { centerLblEl.textContent = posDom ? 'Positif' : 'Negatif'; centerLblEl.style.color = col; }

    const lp = document.getElementById('legend-pos');
    const ln = document.getElementById('legend-neg');
    if (lp) lp.innerHTML = `${pos.toLocaleString('id-ID')} <span class="text-c3 font-normal">${pctStr(posPct)}</span>`;
    if (ln) ln.innerHTML = `${neg.toLocaleString('id-ID')} <span class="text-c3 font-normal">${pctStr(negPct)}</span>`;
  }

  window.addEventListener('dashboard:dist', e => {
    if (e.detail) updateDistribution(e.detail.pos || 0, e.detail.neg || 0);
  });
  window.addEventListener('themechange', () => drawDonut(hoveredSlice));

  /* ── hover interactivity ── */
  let hoveredSlice = null;

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - CX, dy = my - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= RI && dist <= RO + 6) {
      /* angle relative to -PI/2 (12 o'clock start) */
      let ang = Math.atan2(dy, dx) - (-Math.PI / 2);
      if (ang < 0) ang += Math.PI * 2;

      let found = null;
      sliceAngles.forEach((sa, idx) => {
        /* normalize to 0..2PI range */
        let s = sa.start + Math.PI / 2;
        let en = sa.end   + Math.PI / 2;
        if (s  < 0) s  += Math.PI * 2;
        if (en < 0) en += Math.PI * 2;
        if (ang >= s && ang <= en) found = idx;
      });

      if (found !== hoveredSlice) {
        hoveredSlice = found;
        drawDonut(hoveredSlice);
      }

      if (found !== null) {
        const sl = SLICES[found];
        const html = `
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${sl.color};flex-shrink:0;"></div>
            <span style="color:#EEECff;font-weight:600;">${sl.label}</span>
          </div>
          <div style="color:#9896C8;">${sl.count} ulasan</div>
          <div style="color:#9896C8;">${sl.value}% dari total</div>
        `;
        showTooltip(html, e.clientX, e.clientY);
        canvas.style.cursor = 'pointer';
      }
    } else {
      if (hoveredSlice !== null) {
        hoveredSlice = null;
        drawDonut(null);
      }
      hideTooltip();
      canvas.style.cursor = '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (hoveredSlice !== null) {
      hoveredSlice = null;
      drawDonut(null);
    }
    hideTooltip();
    canvas.style.cursor = '';
  });
})();


/* ════════════════════════════════════════════════════════
   DASHBOARD DATA LOADER — realisasi data dari backend/DB
   ════════════════════════════════════════════════════════ */
(function () {
  const API = 'http://localhost:8000';
  const headers = { 'Authorization': 'Bearer ' + localStorage.getItem('token') };

  const ID_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MAP = {
    positive: { cls: 'positive', text: 'Positif' },
    negative: { cls: 'negative', text: 'Negatif' },
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── KPI + distribusi (donut) ── */
  async function loadStats() {
    try {
      const res = await fetch(`${API}/api/reports/stats`, { headers });
      if (!res.ok) throw new Error();
      const s = await res.json();

      document.getElementById('kpi-total').textContent = (s.total_reviews || 0).toLocaleString('id-ID');

      const pos = s.svm_positive || 0;
      const neg = s.svm_negative || 0;
      const t = pos + neg;
      document.getElementById('kpi-pos').textContent = t ? (pos / t * 100).toFixed(1).replace('.', ',') + '%' : '—';
      document.getElementById('kpi-neg').textContent = t ? (neg / t * 100).toFixed(1).replace('.', ',') + '%' : '—';

      window.dispatchEvent(new CustomEvent('dashboard:dist', { detail: { pos, neg } }));
    } catch (_) {
      document.getElementById('kpi-total').textContent = '—';
      document.getElementById('kpi-pos').textContent = '—';
      document.getElementById('kpi-neg').textContent = '—';
      window.dispatchEvent(new CustomEvent('dashboard:dist', { detail: { pos: 0, neg: 0 } }));
    }
  }

  /* ── Tren bulanan ── */
  async function loadTrend() {
    try {
      const res = await fetch(`${API}/api/reports/trend?days=365`, { headers });
      if (!res.ok) throw new Error();
      const rows = await res.json();
      if (!rows.length) { window.dispatchEvent(new CustomEvent('dashboard:trend', { detail: null })); return; }

      const months = {};  // "YYYY-MM" → sums
      rows.forEach(r => {
        const key = String(r.date).slice(0, 7);
        const m = months[key] || (months[key] = { nbP: 0, nbN: 0, svP: 0, svN: 0 });
        m.nbP += r.nb_positive || 0; m.nbN += r.nb_negative || 0;
        m.svP += r.svm_positive || 0; m.svN += r.svm_negative || 0;
      });
      const keys = Object.keys(months).sort();
      const pct = (a, b) => (a + b > 0 ? Math.round(a / (a + b) * 100) : 0);
      const labels = keys.map(k => ID_BULAN[parseInt(k.slice(5, 7), 10) - 1]);
      const datasets = {
        all: { positive: [], negative: [] },
        nb:  { positive: [], negative: [] },
        svm: { positive: [], negative: [] },
      };
      keys.forEach(k => {
        const m = months[k];
        datasets.nb.positive.push(pct(m.nbP, m.nbN));   datasets.nb.negative.push(pct(m.nbN, m.nbP));
        datasets.svm.positive.push(pct(m.svP, m.svN));  datasets.svm.negative.push(pct(m.svN, m.svP));
        datasets.all.positive.push(pct(m.nbP + m.svP, m.nbN + m.svN));
        datasets.all.negative.push(pct(m.nbN + m.svN, m.nbP + m.svP));
      });
      window.dispatchEvent(new CustomEvent('dashboard:trend', { detail: { labels, datasets } }));
    } catch (_) {
      window.dispatchEvent(new CustomEvent('dashboard:trend', { detail: null }));
    }
  }

  /* ── Ulasan terbaru ── */
  async function loadRecent() {
    const box = document.getElementById('recent-reviews');
    if (!box) return;
    try {
      const res = await fetch(`${API}/api/reports/analysis-data?approval_status=&limit=5`, { headers });
      if (!res.ok) throw new Error();
      const rows = await res.json();
      if (!rows.length) {
        box.innerHTML = '<p class="text-[12px] text-c3 py-4 text-center">Belum ada ulasan yang dianalisis.</p>';
        return;
      }
      box.innerHTML = rows.map(r => {
        const m = MAP[r.svm_sentiment] || MAP.positive;
        const conf = r.svm_confidence != null ? Math.round(r.svm_confidence) + '% keyakinan' : '—';
        return `<div class="review-item">
          <div class="flex items-start justify-between gap-2 mb-[5px]">
            <span class="review-text">"${esc(r.review_text)}"</span>
            <span class="badge ${m.cls}">${m.text}</span>
          </div>
          <div class="flex items-center gap-2"><span class="text-[10px] text-c3">SVM · ${conf}</span></div>
        </div>`;
      }).join('');
    } catch (_) {
      box.innerHTML = '<p class="text-[12px] text-c3 py-4 text-center">Tidak dapat terhubung ke server backend.</p>';
    }
  }

  loadStats();
  loadTrend();
  loadRecent();
})();

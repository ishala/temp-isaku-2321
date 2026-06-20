/* ═══════════════════════════════════════════════════════
   laporan.js — i.saku Sentiment Analytics
   ═══════════════════════════════════════════════════════ */

/* ── Utility ── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Auth guard ── */
(function () {
  if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
  }
})();

/* ── User info + admin section visibility ── */
(function () {
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

    if (role !== 'admin') {
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
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
})();

/* ── Logout modal ── */
(function () {
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

/* ── Theme-aware chart colors (ikut tema light/dark) ── */
function chartChrome() {
  const cv = getComputedStyle(document.documentElement);
  const line = cv.getPropertyValue('--line-rgb').trim() || '255 255 255';
  const c3   = cv.getPropertyValue('--c-c3').trim()     || '92 90 138';
  return {
    grid:    `rgb(${line} / 0.05)`,
    axisDim: `rgb(${c3} / 0.65)`,
    axis:    `rgb(${c3})`,
    label:   (cv.getPropertyValue('--c1').trim() || '#EEECff'),
    sub:     (cv.getPropertyValue('--c2').trim() || '#9896C8'),
    centerBg:(cv.getPropertyValue('--surface2').trim() || '#17172A'),
    stroke:  (cv.getPropertyValue('--page').trim() || '#080810'),
  };
}

/* daftar fungsi redraw chart → dipanggil ulang saat tema berubah */
const __charts = [];
window.addEventListener('themechange', () => __charts.forEach(fn => { try { fn(); } catch (_) {} }));

/* ── Metrik evaluasi model (hasil penelitian — statis) ── */
const REPORT_METRICS = {
  nb:  { acc: 81.53, prec: 81.56, rec: 81.53, f1: 81.48 },
  svm: { acc: 88.11, prec: 88.13, rec: 88.11, f1: 88.10 },
};

/* ── Mini preview chart: canvas-compare-preview (NB vs SVM, semua metrik) ── */
(function () {
  const canvas = document.getElementById('canvas-compare-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    const dpr    = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const cs     = getComputedStyle(parent);
    const W      = (parent.clientWidth  || 300) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H      = (parent.clientHeight || 100) - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const ck = chartChrome();
    const GROUPS = [
      { label: 'Akurasi',   key: 'acc'  },
      { label: 'Precision', key: 'prec' },
      { label: 'Recall',    key: 'rec'  },
      { label: 'F1',        key: 'f1'   },
    ];
    const SERIES = [
      { name: 'NB',  src: REPORT_METRICS.nb,  color: '#4ADE80' },
      { name: 'SVM', src: REPORT_METRICS.svm, color: '#6C63FF' },
    ];

    const PAD     = { l: 26, r: 12, t: 18, b: 36 };
    const cw      = W - PAD.l - PAD.r;
    const ch      = H - PAD.t - PAD.b;
    const MIN_VAL = 70, RANGE = 30; /* 70–100 range */
    const yOf = v => PAD.t + ch - ((v - MIN_VAL) / RANGE) * ch;

    /* Y axis subtle grid lines */
    [75, 85, 95, 100].forEach(pct => {
      const y = yOf(pct);
      if (y < PAD.t - 0.5 || y > PAD.t + ch + 0.5) return;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(W - PAD.r, y);
      ctx.strokeStyle = ck.grid;
      ctx.lineWidth   = 1;
      ctx.stroke();

      ctx.fillStyle  = ck.axisDim;
      ctx.font       = '8px Inter,sans-serif';
      ctx.textAlign  = 'right';
      ctx.fillText(pct + '%', PAD.l - 4, y + 3);
    });

    const groupW   = cw / GROUPS.length;
    const innerGap = 3;
    const barW     = Math.min(20, (groupW * 0.62 - innerGap) / SERIES.length);
    const clusterW = barW * SERIES.length + innerGap * (SERIES.length - 1);

    GROUPS.forEach((g, gi) => {
      const gx = PAD.l + groupW * gi + groupW / 2;
      const x0 = gx - clusterW / 2;
      SERIES.forEach((s, si) => {
        const v = s.src[g.key];
        const x = x0 + si * (barW + innerGap), y = yOf(v), r = 3;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, PAD.t + ch);
        ctx.lineTo(x, PAD.t + ch);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, y, 0, PAD.t + ch);
        grad.addColorStop(0, s.color);
        grad.addColorStop(1, s.color + '80');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.fillStyle = ck.label;
        ctx.font      = 'bold 8px Inter,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(1), x + barW / 2, y - 4);
      });
      ctx.fillStyle = ck.sub;
      ctx.font      = '8px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.label, gx, H - PAD.b + 14);
    });

    /* Legend */
    let lgX = PAD.l;
    const lgY = H - 6;
    SERIES.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(lgX + 3, lgY - 3, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ck.sub; ctx.font = '8px Inter,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(s.name, lgX + 10, lgY);
      lgX += 10 + ctx.measureText(s.name).width + 14;
    });
  }

  draw();
  window.addEventListener('resize', draw);
  __charts.push(draw);
})();

/* ── Mini preview chart: canvas-pie-preview (donut) ── */
(function () {
  const canvas = document.getElementById('canvas-pie-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let slices = [
    { label: 'Positif',  pct: 78.6, color: '#4ADE80' },
    { label: 'Negatif',  pct: 21.4, color: '#F87171' },
  ];
  window.addEventListener('report:dist', e => {
    const d = e.detail; const t = (d.pos || 0) + (d.neg || 0);
    if (t > 0) {
      slices = [
        { label: 'Positif', pct: +(d.pos / t * 100).toFixed(1), color: '#4ADE80' },
        { label: 'Negatif', pct: +(d.neg / t * 100).toFixed(1), color: '#F87171' },
      ];
      draw();
    }
  });

  function draw() {
    const dpr    = window.devicePixelRatio || 1;
    const SIZE   = 160;

    canvas.width        = SIZE * dpr;
    canvas.height       = SIZE * dpr;
    canvas.style.width  = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx    = SIZE / 2;
    const cy    = SIZE / 2;
    const outer = 74;
    const inner = 48;

    let startAngle = -Math.PI / 2;

    slices.forEach(s => {
      const sweep = (s.pct / 100) * Math.PI * 2;

      /* Outer arc */
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(startAngle) * inner, cy + Math.sin(startAngle) * inner);
      ctx.arc(cx, cy, outer, startAngle, startAngle + sweep);
      ctx.arc(cx, cy, inner, startAngle + sweep, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();

      startAngle += sweep;
    });

    /* Centre circle background */
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 1, 0, Math.PI * 2);
    ctx.fillStyle = chartChrome().centerBg;
    ctx.fill();

    /* Center text: largest pct */
    const top = slices.reduce((a, b) => (b.pct > a.pct ? b : a));
    ctx.fillStyle  = top.color;
    ctx.font       = 'bold 18px Inter,sans-serif';
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(top.pct + '%', cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  draw();
  __charts.push(draw);
})();

/* ── Mini preview chart: canvas-trend-preview (3-line mini trend) ── */
(function () {
  const canvas = document.getElementById('canvas-trend-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let labels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun'];
  let series = [
    { values: [72, 76, 77, 74, 79, 79], color: '#4ADE80', label: 'Positif' },
    { values: [28, 24, 23, 26, 21, 21], color: '#F87171', label: 'Negatif', dashed: true },
  ];

  const PAD = { l: 22, r: 8, t: 8, b: 18 };
  let hoveredCol = null;

  window.addEventListener('report:trend', e => {
    const d = e.detail;
    if (d && d.labels && d.labels.length) {
      labels = d.labels;
      series = [
        { values: d.positive, color: '#4ADE80', label: 'Positif' },
        { values: d.negative, color: '#F87171', label: 'Negatif', dashed: true },
      ];
      hoveredCol = null;
      draw();
    }
  });

  /* tooltip (dibuat sekali, dipakai bersama) */
  const tip = (() => {
    let el = document.getElementById('__chart-tip');
    if (!el) {
      el = document.createElement('div');
      el.id = '__chart-tip';
      el.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;display:none;' +
        'background:#10101E;border:0.5px solid rgba(255,255,255,.12);border-radius:8px;' +
        'padding:8px 12px;font-family:Inter,sans-serif;font-size:11px;color:#9896C8;' +
        'white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.55);';
      document.body.appendChild(el);
    }
    return el;
  })();
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let l = x + 14, t = y - 10;
    if (l + tw > window.innerWidth - 8) l = x - tw - 14;
    if (t + th > window.innerHeight - 8) t = window.innerHeight - th - 8;
    if (t < 8) t = 8;
    tip.style.left = l + 'px';
    tip.style.top  = t + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  function draw(hovCol = null) {
    const dpr    = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const cs     = getComputedStyle(parent);
    const W      = (parent.clientWidth  || 400) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H      = (parent.clientHeight || 80)  - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const cw = W - PAD.l - PAD.r;
    const ch = H - PAD.t - PAD.b;
    const n  = labels.length;
    const ck = chartChrome();

    function xAt(i)  { return PAD.l + (i / (n - 1)) * cw; }
    function yAt(v)  { return PAD.t + ch - ((v - 0) / 100) * ch; }

    /* Grid lines */
    [0, 50, 100].forEach(v => {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(W - PAD.r, y);
      ctx.strokeStyle = ck.grid;
      ctx.lineWidth   = 1;
      ctx.stroke();
    });

    /* Y labels */
    [0, 50, 100].forEach(v => {
      ctx.fillStyle  = ck.axisDim;
      ctx.font       = '8px Inter,sans-serif';
      ctx.textAlign  = 'right';
      ctx.fillText(v, PAD.l - 3, yAt(v) + 3);
    });

    /* X labels */
    ctx.fillStyle  = ck.axisDim;
    ctx.font       = '8px Inter,sans-serif';
    ctx.textAlign  = 'center';
    labels.forEach((l, i) => {
      ctx.fillText(l, xAt(i), H - 4);
    });

    /* Vertical hover indicator */
    if (hovCol !== null) {
      const x = xAt(hovCol);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ch);
      ctx.strokeStyle = ck.hover;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.restore();
    }

    /* Series */
    series.forEach(s => {
      ctx.save();
      ctx.beginPath();
      if (s.dashed) ctx.setLineDash([3, 3]);
      s.values.forEach((v, i) => {
        const x = xAt(i);
        const y = yAt(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 1.6;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      /* Area fill under line */
      ctx.lineTo(xAt(n - 1), PAD.t + ch);
      ctx.lineTo(xAt(0),     PAD.t + ch);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
      grad.addColorStop(0, s.color + '18');
      grad.addColorStop(1, s.color + '00');
      ctx.fillStyle = grad;
      ctx.setLineDash([]);
      ctx.fill();

      ctx.restore();

      /* Dots at each data point */
      s.values.forEach((v, i) => {
        const hov = hovCol === i;
        const x = xAt(i), y = yAt(v);
        if (hov) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fillStyle = s.color + '22';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, hov ? 3.4 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle   = s.color;
        ctx.fill();
        ctx.strokeStyle = ck.stroke;
        ctx.lineWidth   = hov ? 1.5 : 1;
        ctx.stroke();
      });
    });
  }

  const render = () => draw(hoveredCol);
  render();
  window.addEventListener('resize', render);
  __charts.push(render);

  /* hover interactivity (sama seperti chart tren di dashboard) */
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const cw = rect.width - PAD.l - PAD.r;
    const n  = labels.length;
    let nearest = null, min = Infinity;
    for (let i = 0; i < n; i++) {
      const x = PAD.l + (i / (n - 1)) * cw;
      const d = Math.abs(mx - x);
      if (d < min && d < 22) { min = d; nearest = i; }
    }
    if (nearest !== hoveredCol) { hoveredCol = nearest; draw(hoveredCol); }
    if (nearest !== null) {
      const html =
        `<div style="font-size:10px;color:#5C5A8A;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;font-weight:500;">${labels[nearest]} 2025</div>` +
        series.map(s => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;"><div style="width:6px;height:6px;border-radius:50%;background:${s.color};flex-shrink:0;"></div><span>${s.label}</span><span style="color:#EEECff;font-weight:600;margin-left:8px;">${s.values[nearest]}%</span></div>`).join('');
      showTip(html, e.clientX, e.clientY);
      canvas.style.cursor = 'crosshair';
    } else {
      hideTip();
      canvas.style.cursor = '';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    hoveredCol = null;
    hideTip();
    canvas.style.cursor = '';
    draw(null);
  });
})();

/* ── Filter panel ── */
(function () {
  /* ---- Default date range: 6 months ago → today ---- */
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function defaultDari() {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return isoDate(d);
  }

  function defaultSampai() {
    return isoDate(new Date());
  }

  const elDari    = document.getElementById('filter-dari');
  const elSampai  = document.getElementById('filter-sampai');
  const elSource  = document.getElementById('filter-source');
  const elStatus  = document.getElementById('filter-status');
  const elModel   = document.getElementById('filter-model');
  const btnApply  = document.getElementById('btn-apply-filter');
  const linkReset = document.getElementById('link-reset-filter');

  function setDefaults() {
    /* Kosongkan tanggal = tampilkan semua data; user pilih rentang lalu Terapkan */
    if (elDari)   elDari.value   = '';
    if (elSampai) elSampai.value = '';
    if (elSource) elSource.value = '';
    if (elStatus) elStatus.value = '';
    if (elModel)  elModel.value  = 'both';
  }

  setDefaults();

  /* ---- Format date range label ---- */
  function fmtMonthYear(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  }

  function buildFilterLabel() {
    const dari   = elDari   ? elDari.value   : '';
    const sampai = elSampai ? elSampai.value : '';
    const source = elSource ? elSource.options[elSource.selectedIndex].text : '';
    const status = elStatus ? elStatus.options[elStatus.selectedIndex].text : '';
    const model  = elModel  ? elModel.options[elModel.selectedIndex].text   : '';

    const parts = [];
    if (dari && sampai) parts.push(fmtMonthYear(dari) + ' – ' + fmtMonthYear(sampai));
    if (source && elSource.value) parts.push(source);
    if (status && elStatus.value) parts.push(status);
    if (model)                    parts.push(model);

    return parts.length ? 'Filter aktif: ' + parts.join(' · ') : '';
  }

  /* ---- Update mini stats & card subtitles ---- */
  function updateUI() {
    const label = buildFilterLabel();

    /* Update card subs */
    [1, 2, 3, 4, 5, 6].forEach(n => {
      const el = document.getElementById('card-sub-' + n);
      if (!el) return;
      /* Kartu 6 (kosakata berpengaruh) tidak terpengaruh filter → subtitle tetap */
      if (n === 6) return;
      if (label) {
        el.textContent = label;
      } else {
        /* Restore original subtitles */
        const defaults = {
          1: 'Tabel ulasan asli beserta metadata lengkap',
          2: 'Label prediksi NB dan SVM dengan tingkat keyakinan',
          3: 'Akurasi, precision, recall, F1 · agreement rate',
          4: 'Distribusi sentimen, statistik utama, temuan kunci',
          5: 'Tren sentimen bulanan dalam rentang yang dipilih',
        };
        el.textContent = defaults[n] || '';
      }
    });

    /* Update filter badge in print docs (kartu 6 tidak ikut filter) */
    [1, 2, 3, 4, 5].forEach(n => {
      const el = document.getElementById('print-filter-' + n);
      if (el) el.textContent = label;
    });

    /* stat-periode & stat-source diisi dari data nyata oleh laporan-report.js */
  }

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      updateUI();
      if (window.reloadReport) window.reloadReport();   // muat ulang data sesuai filter
    });
  }

  if (linkReset) {
    linkReset.addEventListener('click', e => {
      e.preventDefault();
      setDefaults();
      updateUI();
      if (window.reloadReport) window.reloadReport();
    });
  }

  /* Run on load to show defaults */
  updateUI();
})();

/* ── Print per card ── */
(function () {
  function fmtDate() {
    return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function printDoc(n) {
    const docId = 'print-doc-' + n;
    const doc   = document.getElementById(docId);
    if (!doc) return;

    /* Set date in all .print-date-span inside this doc */
    const dateStr = fmtDate();
    doc.querySelectorAll('.print-date-span').forEach(span => {
      span.textContent = dateStr;
    });

    /* Remove .printing from all docs, add to target */
    document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
    doc.classList.add('printing');

    window.print();

    setTimeout(() => {
      document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
    }, 600);
  }

  for (let i = 1; i <= 6; i++) {
    const btn = document.getElementById('btn-cetak-' + i);
    if (btn) {
      (function (n) {
        btn.addEventListener('click', () => printDoc(n));
      })(i);
    }
  }
})();

/* ── Cetak Semua dropdown ── */
(function () {
  const wrap    = document.getElementById('cetak-semua-wrap');
  const trigger = document.getElementById('btn-cetak-semua');
  const dropdown = document.getElementById('cetak-semua-dropdown');
  if (!trigger || !dropdown) return;

  function fmtDate() {
    return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function openDropdown() {
    dropdown.classList.remove('hidden');
    document.addEventListener('click', outsideClick);
  }

  function closeDropdown() {
    dropdown.classList.add('hidden');
    document.removeEventListener('click', outsideClick);
  }

  function outsideClick(e) {
    if (!wrap.contains(e.target)) closeDropdown();
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (dropdown.classList.contains('hidden')) {
      openDropdown();
    } else {
      closeDropdown();
    }
  });

  /* Item click — print that specific doc */
  dropdown.querySelectorAll('.cetak-semua-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const n   = item.getAttribute('data-target');
      const doc = document.getElementById('print-doc-' + n);
      if (!doc) { closeDropdown(); return; }

      const dateStr = fmtDate();
      doc.querySelectorAll('.print-date-span').forEach(span => {
        span.textContent = dateStr;
      });

      document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
      doc.classList.add('printing');

      closeDropdown();
      window.print();

      setTimeout(() => {
        document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
      }, 600);
    });
  });
})();

/* ═══════════════════════════════════════════════════════
   perbandingan.js — Perbandingan Model NB vs SVM
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

/* ── Metrik evaluasi model (hasil penelitian — statis) ── */
const METRICS = {
  nb:  { acc: 81.53, prec: 81.56, rec: 81.53, f1: 81.48 },
  svm: { acc: 88.11, prec: 88.13, rec: 88.11, f1: 88.10 },
};
const METRIC_ROWS = [
  ['Akurasi',   'acc'],
  ['Precision', 'prec'],
  ['Recall',    'rec'],
  ['F1 Score',  'f1'],
];
const id1 = v => v.toFixed(1).replace('.', ',') + '%';

function fillMetricTables() {
  const rows = METRIC_ROWS.map(([label, key]) => {
    const nb = METRICS.nb[key], svm = METRICS.svm[key];
    const sel = (svm - nb);
    const selStr = (sel >= 0 ? '+' : '') + sel.toFixed(1).replace('.', ',') + '%';
    return { label, nb, svm, selStr };
  });
  const screenHtml = rows.map(r =>
    `<tr><td>${r.label}</td><td>${id1(r.nb)}</td><td>${id1(r.svm)}</td>
     <td style="color:#4ADE80">${r.selStr}</td></tr>`).join('');
  document.getElementById('metric-tbody').innerHTML = screenHtml;

  const printHtml = rows.map(r =>
    `<tr><td>${r.label}</td><td>${id1(r.nb)}</td><td>${id1(r.svm)}</td><td>${r.selStr}</td></tr>`).join('');
  const pEl = document.getElementById('pcmp-metric-tbody');
  if (pEl) pEl.innerHTML = printHtml;
}

/* ── Bar chart NB vs SVM (akurasi) ── */
function chartChrome() {
  const cv = getComputedStyle(document.documentElement);
  const line = cv.getPropertyValue('--line-rgb').trim() || '255 255 255';
  const c3   = cv.getPropertyValue('--c-c3').trim()     || '92 90 138';
  return {
    grid:    `rgb(${line} / 0.06)`,
    axisDim: `rgb(${c3} / 0.7)`,
    label:   (cv.getPropertyValue('--c1').trim() || '#EEECff'),
    sub:     (cv.getPropertyValue('--c2').trim() || '#9896C8'),
  };
}

(function () {
  const canvas = document.getElementById('canvas-compare');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    const dpr    = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const cs     = getComputedStyle(parent);
    const W = (parent.clientWidth  || 400) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = (parent.clientHeight || 260) - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);

    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
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
      { name: 'Naive Bayes', src: METRICS.nb,  color: '#4ADE80' },
      { name: 'SVM',         src: METRICS.svm, color: '#6C63FF' },
    ];
    const PAD  = { l: 34, r: 16, t: 24, b: 42 };
    const cw   = W - PAD.l - PAD.r;
    const ch   = H - PAD.t - PAD.b;
    const MIN_VAL = 70, RANGE = 30;
    const yOf = v => PAD.t + ch - ((v - MIN_VAL) / RANGE) * ch;

    /* Grid + label sumbu-Y */
    [75, 80, 85, 90, 95, 100].forEach(pct => {
      const y = yOf(pct);
      if (y < PAD.t - 0.5 || y > PAD.t + ch + 0.5) return;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y);
      ctx.strokeStyle = ck.grid; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = ck.axisDim; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(pct + '%', PAD.l - 5, y + 3);
    });

    /* Grouped bars: tiap metrik berisi bar NB & SVM */
    const groupW   = cw / GROUPS.length;
    const innerGap = 4;
    const barW     = Math.min(26, (groupW * 0.6 - innerGap) / SERIES.length);
    const clusterW = barW * SERIES.length + innerGap * (SERIES.length - 1);

    GROUPS.forEach((g, gi) => {
      const gx = PAD.l + groupW * gi + groupW / 2;
      const x0 = gx - clusterW / 2;
      SERIES.forEach((s, si) => {
        const v = s.src[g.key];
        const x = x0 + si * (barW + innerGap), y = yOf(v), r = 4;
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
        grad.addColorStop(0, s.color); grad.addColorStop(1, s.color + '80');
        ctx.fillStyle = grad; ctx.fill();

        ctx.fillStyle = ck.label; ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(1), x + barW / 2, y - 5);
      });
      ctx.fillStyle = ck.sub; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(g.label, gx, H - PAD.b + 16);
    });

    /* Legend */
    const lgY = H - 8;
    let lgX = PAD.l;
    SERIES.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(lgX + 4, lgY - 3, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ck.sub; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(s.name, lgX + 12, lgY);
      lgX += 12 + ctx.measureText(s.name).width + 18;
    });
  }

  draw();
  window.addEventListener('resize', draw);
  window.addEventListener('themechange', draw);
})();

/* ── Agreement rate dari backend ── */
async function loadAgreement() {
  let total = 0, agree = 0, rate = 0, ok = false;
  try {
    const res = await fetch(`${API}/api/reports/stats`, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
    });
    if (!res.ok) throw new Error();
    const s = await res.json();
    total = s.total_analyzed || 0;
    agree = s.agreement_count || 0;
    rate  = s.agreement_rate || 0;
    ok = true;
  } catch (_) { ok = false; }

  const disagree = Math.max(0, total - agree);
  const fmt = n => n.toLocaleString('id-ID');

  document.getElementById('cmp-total').textContent    = ok ? fmt(total) : '—';
  document.getElementById('cmp-agree').textContent    = ok ? fmt(agree) : '—';
  document.getElementById('cmp-disagree').textContent = ok ? fmt(disagree) : '—';
  document.getElementById('cmp-rate').textContent     = ok ? (String(rate).replace('.', ',') + '%') : '—';
  document.getElementById('agree-sub').textContent    =
    ok ? `Dari ${fmt(total)} ulasan yang dianalisis` : 'Server tidak terhubung';

  // Print doc agreement table
  const pAgree = document.getElementById('pcmp-agree-tbody');
  if (pAgree) {
    pAgree.innerHTML = ok
      ? `<tr><td>Sepakat (NB = SVM)</td><td>${fmt(agree)}</td><td>${String(rate).replace('.', ',')}%</td></tr>
         <tr><td>Tidak Sepakat</td><td>${fmt(disagree)}</td><td>${total ? (100 - rate).toFixed(2).replace('.', ',') : 0}%</td></tr>
         <tr style="font-weight:600;"><td>Total Dianalisis</td><td>${fmt(total)}</td><td>100%</td></tr>`
      : '<tr><td colspan="3" style="text-align:center">Data tidak tersedia</td></tr>';
  }

  // Kesimpulan (gabungan metrik statis + agreement nyata)
  const f1diff = (METRICS.svm.f1 - METRICS.nb.f1).toFixed(1).replace('.', ',');
  const kesimpulan =
    `SVM mengungguli Naive Bayes pada seluruh metrik evaluasi (akurasi ${id1(METRICS.svm.acc)} ` +
    `vs ${id1(METRICS.nb.acc)}, selisih F1 ${f1diff} poin). ` +
    (ok ? `Agreement rate kedua model ${String(rate).replace('.', ',')}% dari ${fmt(total)} ulasan, ` +
          `menunjukkan konsistensi klasifikasi yang tinggi. ` : '') +
    `Rekomendasi: gunakan SVM sebagai model utama, Naive Bayes sebagai pembanding validasi.`;
  document.getElementById('cmp-kesimpulan').textContent = kesimpulan;
  const pk = document.getElementById('pcmp-kesimpulan');
  if (pk) pk.textContent = kesimpulan;
}

/* ── Cetak halaman ── */
document.getElementById('btn-cetak-compare').addEventListener('click', () => {
  const dEl = document.getElementById('print-date-compare');
  if (dEl) dEl.textContent = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const doc = document.getElementById('print-doc-compare');
  document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
  doc.classList.add('printing');
  window.print();
  setTimeout(() => doc.classList.remove('printing'), 600);
});

/* ── Init ── */
fillMetricTables();
loadAgreement();

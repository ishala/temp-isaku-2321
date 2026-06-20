/* ═══════════════════════════════════════════════════════
   laporan-report.js — realisasi data Laporan dari backend/DB
   Mendukung filter tanggal/source/status/model dari panel kiri.
   (dimuat setelah laporan.js)
   ═══════════════════════════════════════════════════════ */
(function () {
  const API = 'http://localhost:8000';
  const headers = { Authorization: 'Bearer ' + localStorage.getItem('token') };
  const ID_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtNum = n => (n || 0).toLocaleString('id-ID');
  const pctStr = v => (v).toFixed(1).replace('.', ',') + '%';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const cap = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const SENT_TXT = { positive: 'Positif', negative: 'Negatif' };
  const STATUS_TXT = { approved: 'Disetujui', rejected: 'Ditolak', pending: 'Pending' };
  function badge(sent) {
    const cls = sent === 'negative' ? 'negative' : sent === 'positive' ? 'positive' : 'warn';
    return `<span class="badge ${cls}">${SENT_TXT[sent] || '—'}</span>`;
  }
  function fmtTgl(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return s; }
  }

  /* Baca nilai filter dari panel kiri → query string + model */
  function getFilters() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const p = new URLSearchParams();
    const dari = v('filter-dari'), sampai = v('filter-sampai');
    const source = v('filter-source'), status = v('filter-status');
    if (dari)   p.set('date_from', dari);
    if (sampai) p.set('date_to', sampai);
    if (source) p.set('source', source);
    if (status) p.set('status', status);
    const model = v('filter-model') || 'both';
    return { qs: p.toString(), status, model };
  }

  async function getJSON(path) {
    const res = await fetch(API + path, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ── Statistik + distribusi + agreement ── */
  async function loadStats(qs, model) {
    try {
      const s = await getJSON('/api/reports/stats?' + qs);
      // Pilih model utk distribusi (default SVM)
      const pos = model === 'nb' ? (s.nb_positive || 0) : (s.svm_positive || 0);
      const neg = model === 'nb' ? (s.nb_negative || 0) : (s.svm_negative || 0);
      const t = pos + neg;

      set('stat-total', fmtNum(s.total_reviews));
      set('pd4-total', fmtNum(t));
      set('pd4-pos', fmtNum(pos));
      set('pd4-neg', fmtNum(neg));
      set('pd4-pos-label', `Positif (${t ? pctStr(pos / t * 100) : '0%'})`);
      set('pd4-neg-label', `Negatif (${t ? pctStr(neg / t * 100) : '0%'})`);

      // Legend chip kartu Ringkasan Eksekutif (sinkron dgn pie)
      const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:5px;vertical-align:middle;"></span>`;
      setHTML('chip-pos', `${dot('#4ADE80')} Positif ${t ? pctStr(pos / t * 100) : '—'}`);
      setHTML('chip-neg', `${dot('#F87171')} Negatif ${t ? pctStr(neg / t * 100) : '—'}`);

      // Agreement (print-doc-3)
      setHTML('pd3-tbody',
        `<tr><td>Total Sepakat (NB = SVM)</td><td>${fmtNum(s.agreement_count)}</td><td>${(s.agreement_rate || 0).toString().replace('.', ',')}%</td></tr>`);

      window.dispatchEvent(new CustomEvent('report:dist', { detail: { pos, neg } }));
    } catch (_) {
      set('stat-total', '—');
      setHTML('chip-pos', 'Positif —');
      setHTML('chip-neg', 'Negatif —');
      setHTML('pd3-tbody', '<tr><td colspan="3" style="text-align:center">Data tidak tersedia</td></tr>');
      window.dispatchEvent(new CustomEvent('report:dist', { detail: { pos: 0, neg: 0 } }));
    }
  }

  /* ── Data mentah (card 1 + print-doc-1) ── */
  async function loadRaw(qs) {
    try {
      const rows = await getJSON('/api/reports/raw-data?' + qs);
      set('stat-source', new Set(rows.map(r => r.source)).size || 0);
      setHTML('card1-tbody', rows.length
        ? rows.slice(0, 3).map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td>${cap((r.original_text || '').slice(0, 46))}…</td>
            <td>${r.star_rating ? r.star_rating + '★' : '—'}</td>
            <td><span class="badge" style="opacity:.6">Mentah</span></td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--c3)">Tidak ada data untuk filter ini</td></tr>');
      setHTML('pd1-tbody', rows.length
        ? rows.map((r, i) => `<tr>
            <td>${i + 1}</td><td>${cap(r.original_text || '')}</td>
            <td>${cap(r.source || '-')}</td><td>${r.star_rating ?? '—'}</td>
            <td>${fmtTgl(r.review_date)}</td><td>Mentah</td></tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center">Tidak ada data</td></tr>');
    } catch (_) {
      setHTML('card1-tbody', '<tr><td colspan="4" style="text-align:center;color:#F87171">Server tidak terhubung</td></tr>');
    }
  }

  /* ── Hasil analisis (card 2 + print-doc-2 + distribusi per source) ── */
  async function loadAnalysis(qs, model) {
    try {
      // approval_status dikosongkan agar tidak menyaring 'approved' saja by default
      const rows = await getJSON('/api/reports/analysis-data?approval_status=&limit=1000&' + qs);

      // Distribusi per source (print-doc-4)
      const useNb = model === 'nb';
      const bySrc = {};
      rows.forEach(r => {
        const s = r.source || '-';
        const sent = useNb ? r.nb_sentiment : r.svm_sentiment;
        const b = bySrc[s] || (bySrc[s] = { p: 0, n: 0 });
        if (sent === 'negative') b.n++; else if (sent === 'positive') b.p++;
      });
      const srcKeys = Object.keys(bySrc);
      setHTML('pd4-source-tbody', srcKeys.length
        ? srcKeys.map(s => {
            const b = bySrc[s], tot = b.p + b.n;
            const pPct = tot ? (b.p / tot * 100).toFixed(1).replace('.', ',') : '0';
            const nPct = tot ? (b.n / tot * 100).toFixed(1).replace('.', ',') : '0';
            return `<tr><td>${cap(s)}</td><td>${fmtNum(tot)}</td><td>${fmtNum(b.p)} (${pPct}%)</td><td>${fmtNum(b.n)} (${nPct}%)</td></tr>`;
          }).join('')
        : '<tr><td colspan="4" style="text-align:center">Belum ada data</td></tr>');

      setHTML('card2-tbody', rows.length
        ? rows.slice(0, 3).map(r => `<tr>
            <td>${cap((r.review_text || '').slice(0, 32))}…</td>
            <td>${badge(r.nb_sentiment)}</td><td>${badge(r.svm_sentiment)}</td>
            <td>${r.svm_confidence != null ? r.svm_confidence + '%' : '—'}</td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--c3)">Tidak ada hasil untuk filter ini</td></tr>');
      setHTML('pd2-tbody', rows.length
        ? rows.map((r, i) => `<tr>
            <td>${i + 1}</td><td>${cap(r.review_text || '')}</td>
            <td>${SENT_TXT[r.nb_sentiment] || '—'}</td><td>${r.nb_confidence != null ? r.nb_confidence + '%' : '—'}</td>
            <td>${SENT_TXT[r.svm_sentiment] || '—'}</td><td>${r.svm_confidence != null ? r.svm_confidence + '%' : '—'}</td>
            <td>${STATUS_TXT[r.approval_status] || r.approval_status || '—'}</td></tr>`).join('')
        : '<tr><td colspan="7" style="text-align:center">Tidak ada data</td></tr>');
    } catch (_) {
      setHTML('card2-tbody', '<tr><td colspan="4" style="text-align:center;color:#F87171">Server tidak terhubung</td></tr>');
    }
  }

  /* ── Tren bulanan (print-doc-5 + chart) ── */
  async function loadTrend(qs, model) {
    try {
      const rows = await getJSON('/api/reports/trend?' + qs);
      if (!rows.length) {
        setHTML('pd5-tbody', '<tr><td colspan="6" style="text-align:center">Tidak ada data untuk filter ini</td></tr>');
        window.dispatchEvent(new CustomEvent('report:trend', { detail: null }));
        return;
      }
      const useNb = model === 'nb';
      const months = {};
      rows.forEach(r => {
        const k = String(r.date).slice(0, 7);
        const m = months[k] || (months[k] = { p: 0, n: 0 });
        m.p += useNb ? (r.nb_positive || 0) : (r.svm_positive || 0);
        m.n += useNb ? (r.nb_negative || 0) : (r.svm_negative || 0);
      });
      const keys = Object.keys(months).sort();
      const labels = [], positive = [], negative = [], rowsHtml = [];
      let tP = 0, tN = 0;
      keys.forEach(k => {
        const m = months[k], tot = m.p + m.n;
        const pPct = tot ? Math.round(m.p / tot * 100) : 0;
        const nPct = tot ? 100 - pPct : 0;
        const mon = ID_BULAN[parseInt(k.slice(5, 7), 10) - 1];
        labels.push(mon); positive.push(pPct); negative.push(nPct);
        tP += m.p; tN += m.n;
        rowsHtml.push(`<tr><td>${mon} ${k.slice(0, 4)}</td><td>${fmtNum(tot)}</td><td>${fmtNum(m.p)}</td><td>${pPct}%</td><td>${fmtNum(m.n)}</td><td>${nPct}%</td></tr>`);
      });
      const tot = tP + tN;
      rowsHtml.push(`<tr style="font-weight:600;"><td>Total</td><td>${fmtNum(tot)}</td><td>${fmtNum(tP)}</td><td>${tot ? Math.round(tP / tot * 100) : 0}%</td><td>${fmtNum(tN)}</td><td>${tot ? Math.round(tN / tot * 100) : 0}%</td></tr>`);
      setHTML('pd5-tbody', rowsHtml.join(''));
      if (keys.length) set('stat-periode', labels[0] + ' – ' + labels[labels.length - 1] + ' ' + keys[keys.length - 1].slice(0, 4));
      window.dispatchEvent(new CustomEvent('report:trend', { detail: { labels, positive, negative } }));
    } catch (_) {
      setHTML('pd5-tbody', '<tr><td colspan="6" style="text-align:center;color:#F87171">Server tidak terhubung</td></tr>');
    }
  }

  /* ── Kosakata berpengaruh (card 6 + print-doc-6) — tidak terpengaruh filter ── */
  async function loadTopWords() {
    const elPos = document.getElementById('topwords-pos');
    const elNeg = document.getElementById('topwords-neg');
    try {
      const d = await getJSON('/api/reports/top-words?n=20');
      if (!d || !d.available || (!d.positive.length && !d.negative.length)) {
        const msg = '<div class="text-[11px] text-c3">Model belum tersedia</div>';
        if (elPos) elPos.innerHTML = msg;
        if (elNeg) elNeg.innerHTML = msg;
        setHTML('pd6-pos-tbody', '<tr><td colspan="3" style="text-align:center">Data tidak tersedia</td></tr>');
        setHTML('pd6-neg-tbody', '<tr><td colspan="3" style="text-align:center">Data tidak tersedia</td></tr>');
        return;
      }

      // Bar preview (max 8 per kolom agar ringkas)
      const maxAbs = arr => Math.max(1e-9, ...arr.map(w => Math.abs(w.weight)));
      function rowsHtml(arr, color) {
        const m = maxAbs(arr);
        return arr.slice(0, 8).map(w => {
          const pct = Math.max(8, Math.round(Math.abs(w.weight) / m * 100));
          return `<div title="bobot ${w.weight}">
            <div class="flex items-center justify-between text-[11px] mb-[2px]">
              <span class="text-c1 font-medium truncate" style="max-width:90px">${cap(w.word)}</span>
              <span class="text-c3 tabular-nums">${w.weight.toFixed(2)}</span>
            </div>
            <div style="height:5px;border-radius:3px;background:rgba(150,150,180,.12);overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
            </div>
          </div>`;
        }).join('');
      }
      if (elPos) elPos.innerHTML = rowsHtml(d.positive, '#4ADE80');
      if (elNeg) elNeg.innerHTML = rowsHtml(d.negative, '#F87171');

      // Print doc (semua 20)
      const tbl = arr => arr.map((w, i) =>
        `<tr><td>${i + 1}</td><td>${cap(w.word)}</td><td>${w.weight.toFixed(4)}</td></tr>`).join('');
      setHTML('pd6-pos-tbody', tbl(d.positive));
      setHTML('pd6-neg-tbody', tbl(d.negative));
    } catch (_) {
      const msg = '<div class="text-[11px]" style="color:#F87171">Server tidak terhubung</div>';
      if (elPos) elPos.innerHTML = msg;
      if (elNeg) elNeg.innerHTML = msg;
    }
  }

  /* Muat ulang seluruh laporan sesuai filter aktif */
  function reloadReport() {
    const { qs, model } = getFilters();
    loadStats(qs, model);
    loadRaw(qs);
    loadAnalysis(qs, model);
    loadTrend(qs, model);
  }

  // Expose agar tombol "Terapkan Filter" / "Reset" di laporan.js bisa memicu
  window.reloadReport = reloadReport;

  reloadReport();
  loadTopWords();   // sekali saja — bobot kata bersifat global (tak ikut filter)
})();

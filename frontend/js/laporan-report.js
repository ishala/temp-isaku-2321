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

  /* ── Narasi dinamis (Kesimpulan / Temuan Kunci / Perubahan Signifikan) ──
     Disusun dari data nyata; tiap loader mengisi bagiannya ke _ctx lalu
     memanggil ulang builder. Guard bila data belum/ tidak tersedia. */
  const _ctx = { stats: null, sources: null, trend: null };

  function buildConclusion() {
    const el = document.getElementById('pd3-conclusion');
    if (!el) return;
    const m = window.REPORT_METRICS;
    if (!m) { el.textContent = '—'; return; }
    const better = m.svm.acc >= m.nb.acc ? 'SVM' : 'Naive Bayes';
    const worse  = better === 'SVM' ? 'Naive Bayes' : 'SVM';
    const bAcc = (better === 'SVM' ? m.svm : m.nb).acc;
    const wAcc = (better === 'SVM' ? m.nb : m.svm).acc;
    const dF1  = Math.abs(m.svm.f1 - m.nb.f1);
    let txt = `Model ${better} mengungguli ${worse} pada metrik evaluasi, dengan akurasi ${pctStr(bAcc)} berbanding ${pctStr(wAcc)} dan selisih F1 Score ${pctStr(dF1)}.`;
    if (_ctx.stats && _ctx.stats.agreement_rate != null) {
      txt += ` Kedua model sepakat pada ${pctStr(_ctx.stats.agreement_rate)} hasil analisis (sesuai filter aktif).`;
    }
    txt += ` Rekomendasi: gunakan ${better} sebagai model utama, dengan ${worse} sebagai pembanding validasi.`;
    el.textContent = txt;
  }

  function buildChanges() {
    const el = document.getElementById('pd5-changes');
    if (!el) return;
    const t = _ctx.trend;
    if (!t || !t.labels.length) { el.textContent = 'Tidak ada data tren untuk rentang yang dipilih.'; return; }
    if (t.labels.length < 2) {
      el.textContent = `Hanya tersedia data untuk ${t.firstLabel} (positif ${t.firstPos}%, negatif ${100 - t.firstPos}%), sehingga perubahan antarbulan belum dapat dihitung.`;
      return;
    }
    const diff = t.lastPos - t.firstPos;
    const arah    = diff >= 0 ? 'meningkat' : 'menurun';
    const arahNeg = diff >= 0 ? 'menurun' : 'meningkat';
    let txt = `Sentimen positif ${arah} dari ${t.firstPos}% di ${t.firstLabel} menjadi ${t.lastPos}% di ${t.lastLabel}, perubahan sebesar ${Math.abs(diff)} poin persentase. Sentimen negatif ${arahNeg} dari ${100 - t.firstPos}% menjadi ${100 - t.lastPos}% pada periode yang sama.`;
    if (t.peakLabel) txt += ` Volume ulasan tertinggi terjadi pada ${t.peakLabel} dengan ${fmtNum(t.peakTotal)} ulasan.`;
    el.textContent = txt;
  }

  function buildFindings() {
    const el = document.getElementById('pd4-findings');
    if (!el) return;
    const lines = [];
    let i = 1;

    const s = _ctx.stats;
    if (s && (s.pos + s.neg) > 0) {
      const t = s.pos + s.neg;
      const dom = s.pos >= s.neg ? 'positif' : 'negatif';
      lines.push(`${i++}. Sentimen ${dom} mendominasi — positif ${pctStr(s.pos / t * 100)} dan negatif ${pctStr(s.neg / t * 100)} dari ${fmtNum(t)} ulasan teranalisis.`);
    }

    if (_ctx.sources) {
      const arr = Object.entries(_ctx.sources)
        .map(([name, b]) => ({ name, p: b.p, n: b.n, tot: b.p + b.n }))
        .filter(x => x.tot > 0);
      if (arr.length) {
        const bestPos = arr.slice().sort((a, b) => (b.p / b.tot) - (a.p / a.tot))[0];
        const worst   = arr.slice().sort((a, b) => (b.n / b.tot) - (a.n / a.tot))[0];
        lines.push(`${i++}. Source "${cap(bestPos.name)}" memiliki proporsi positif tertinggi (${pctStr(bestPos.p / bestPos.tot * 100)}), sedangkan "${cap(worst.name)}" proporsi negatif tertinggi (${pctStr(worst.n / worst.tot * 100)}).`);
      }
    }

    if (_ctx.trend && _ctx.trend.labels.length >= 2) {
      const tr = _ctx.trend, diff = tr.lastPos - tr.firstPos;
      lines.push(`${i++}. Tren sentimen positif ${diff >= 0 ? 'meningkat' : 'menurun'} ${Math.abs(diff)} poin dari ${tr.firstLabel} ke ${tr.lastLabel}.`);
    }

    const m = window.REPORT_METRICS;
    if (m) {
      const better = m.svm.acc >= m.nb.acc ? 'SVM' : 'Naive Bayes';
      const bAcc = (better === 'SVM' ? m.svm : m.nb).acc;
      const wAcc = (better === 'SVM' ? m.nb : m.svm).acc;
      lines.push(`${i++}. Model ${better} memiliki akurasi lebih tinggi (${pctStr(bAcc)}) dibanding ${better === 'SVM' ? 'Naive Bayes' : 'SVM'} (${pctStr(wAcc)}).`);
    }

    el.innerHTML = lines.length ? lines.join('<br/>') : 'Tidak ada data untuk filter ini.';
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
      // Pilih model utk distribusi. 'both' = hanya ulasan NB & SVM sepakat.
      let pos, neg;
      if (model === 'nb')        { pos = s.nb_positive || 0;    neg = s.nb_negative || 0; }
      else if (model === 'svm')  { pos = s.svm_positive || 0;   neg = s.svm_negative || 0; }
      else                       { pos = s.agree_positive || 0; neg = s.agree_negative || 0; }
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

      _ctx.stats = { pos, neg, agreement_rate: s.agreement_rate != null ? s.agreement_rate : null };
      buildConclusion();
      buildFindings();

      window.dispatchEvent(new CustomEvent('report:dist', { detail: { pos, neg } }));
    } catch (_) {
      set('stat-total', '—');
      setHTML('chip-pos', 'Positif —');
      setHTML('chip-neg', 'Negatif —');
      setHTML('pd3-tbody', '<tr><td colspan="3" style="text-align:center">Data tidak tersedia</td></tr>');
      _ctx.stats = null;
      buildConclusion();
      buildFindings();
      window.dispatchEvent(new CustomEvent('report:dist', { detail: { pos: 0, neg: 0 } }));
    }
  }

  /* ── Data mentah (card 1 + print-doc-1) ── */
  async function loadRaw(qs) {
    try {
      const rows = await getJSON('/api/reports/raw-data?limit=100000&' + qs);
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
            <td style="text-align:center">${i + 1}</td><td>${cap(r.original_text || '')}</td>
            <td>${cap(r.source || '-')}</td><td style="text-align:center">${r.star_rating ?? '—'}</td>
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
      const rows = await getJSON('/api/reports/analysis-data?approval_status=&limit=100000&' + qs);

      // Distribusi per source (print-doc-4). 'both' = hanya ulasan NB & SVM sepakat.
      const bySrc = {};
      rows.forEach(r => {
        const s = r.source || '-';
        const b = bySrc[s] || (bySrc[s] = { p: 0, n: 0 });
        let sent;
        if (model === 'nb')       sent = r.nb_sentiment;
        else if (model === 'svm') sent = r.svm_sentiment;
        else {
          if (r.nb_sentiment !== r.svm_sentiment) return;  // lewati yang tidak sepakat
          sent = r.svm_sentiment;
        }
        if (sent === 'negative') b.n++; else if (sent === 'positive') b.p++;
      });
      _ctx.sources = bySrc;
      buildFindings();

      const srcKeys = Object.keys(bySrc);
      setHTML('pd4-source-tbody', srcKeys.length
        ? srcKeys.map(s => {
            const b = bySrc[s], tot = b.p + b.n;
            const pPct = tot ? (b.p / tot * 100).toFixed(1).replace('.', ',') : '0';
            const nPct = tot ? (b.n / tot * 100).toFixed(1).replace('.', ',') : '0';
            return `<tr><td>${cap(s)}</td><td>${fmtNum(tot)}</td><td>${fmtNum(b.p)} (${pPct}%)</td><td>${fmtNum(b.n)} (${nPct}%)</td></tr>`;
          }).join('')
        : '<tr><td colspan="4" style="text-align:center">Belum ada data</td></tr>');

      /* Kolom mengikuti model terpilih: NB saja, SVM saja, atau keduanya */
      const showNb  = model !== 'svm';   // 'both' atau 'nb'
      const showSvm = model !== 'nb';    // 'both' atau 'svm'
      const confOf  = r => (model === 'nb' ? r.nb_confidence : r.svm_confidence);

      /* ── Card 2 (preview layar) ── */
      let card2Head = '<th>Teks</th>';
      if (showNb)  card2Head += '<th>NB</th>';
      if (showSvm) card2Head += '<th>SVM</th>';
      card2Head += '<th>Conf.</th>';
      setHTML('card2-head', card2Head);
      const card2Cols = 2 + (showNb ? 1 : 0) + (showSvm ? 1 : 0);

      setHTML('card2-tbody', rows.length
        ? rows.slice(0, 3).map(r => {
            let tds = `<td>${cap((r.review_text || '').slice(0, 32))}…</td>`;
            if (showNb)  tds += `<td>${badge(r.nb_sentiment)}</td>`;
            if (showSvm) tds += `<td>${badge(r.svm_sentiment)}</td>`;
            const c = confOf(r);
            tds += `<td>${c != null ? c + '%' : '—'}</td>`;
            return `<tr>${tds}</tr>`;
          }).join('')
        : `<tr><td colspan="${card2Cols}" style="text-align:center;color:var(--c3)">Tidak ada hasil untuk filter ini</td></tr>`);

      /* ── Print doc 2 ── */
      let pd2Head = '<th style="width:56px;">No</th><th>Teks Ulasan</th>';
      if (showNb)  pd2Head += '<th style="width:70px;">NB Label</th><th style="width:60px;">NB Conf.</th>';
      if (showSvm) pd2Head += '<th style="width:70px;">SVM Label</th><th style="width:65px;">SVM Conf.</th>';
      pd2Head += '<th style="width:70px;">Status</th>';
      setHTML('pd2-head', pd2Head);
      const pd2Cols = 3 + (showNb ? 2 : 0) + (showSvm ? 2 : 0);

      setHTML('pd2-tbody', rows.length
        ? rows.map((r, i) => {
            let tds = `<td style="text-align:center">${i + 1}</td><td>${cap(r.review_text || '')}</td>`;
            if (showNb)  tds += `<td>${SENT_TXT[r.nb_sentiment] || '—'}</td><td>${r.nb_confidence != null ? r.nb_confidence + '%' : '—'}</td>`;
            if (showSvm) tds += `<td>${SENT_TXT[r.svm_sentiment] || '—'}</td><td>${r.svm_confidence != null ? r.svm_confidence + '%' : '—'}</td>`;
            tds += `<td>${STATUS_TXT[r.approval_status] || r.approval_status || '—'}</td>`;
            return `<tr>${tds}</tr>`;
          }).join('')
        : `<tr><td colspan="${pd2Cols}" style="text-align:center">Tidak ada data</td></tr>`);
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
        _ctx.trend = { labels: [] };
        buildChanges();
        buildFindings();
        window.dispatchEvent(new CustomEvent('report:trend', { detail: null }));
        return;
      }
      // 'both' = hanya ulasan NB & SVM sepakat (agree_*)
      const pKey = model === 'nb' ? 'nb_positive' : model === 'svm' ? 'svm_positive' : 'agree_positive';
      const nKey = model === 'nb' ? 'nb_negative' : model === 'svm' ? 'svm_negative' : 'agree_negative';
      const months = {};
      rows.forEach(r => {
        const k = String(r.date).slice(0, 7);
        const m = months[k] || (months[k] = { p: 0, n: 0 });
        m.p += r[pKey] || 0;
        m.n += r[nKey] || 0;
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

      /* Ringkasan tren utk narasi (Perubahan Signifikan + Temuan Kunci) */
      let peakIdx = 0, peakTot = -1;
      keys.forEach((k, idx) => { const m = months[k]; const t = m.p + m.n; if (t > peakTot) { peakTot = t; peakIdx = idx; } });
      _ctx.trend = {
        labels,
        firstLabel: labels[0] + ' ' + keys[0].slice(0, 4),
        lastLabel:  labels[labels.length - 1] + ' ' + keys[keys.length - 1].slice(0, 4),
        firstPos:   positive[0],
        lastPos:    positive[positive.length - 1],
        peakLabel:  labels[peakIdx] + ' ' + keys[peakIdx].slice(0, 4),
        peakTotal:  peakTot,
      };
      buildChanges();
      buildFindings();

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
      const d = await getJSON('/api/reports/top-words?n=30');
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

      // Print doc (semua 30)
      const tbl = arr => arr.map((w, i) =>
        `<tr><td style="text-align:center">${i + 1}</td><td>${cap(w.word)}</td><td>${w.weight.toFixed(4)}</td></tr>`).join('');
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
    _ctx.stats = _ctx.sources = _ctx.trend = null;
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

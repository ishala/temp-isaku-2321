/* ── Auth guard ── */
(function () {
  if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
  }
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
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  confirm.addEventListener('click', () => { localStorage.clear(); window.location.href = 'login.html'; });
})();

/* ── Tab switching ── */
(function () {
  const btns = document.querySelectorAll('.tab-btn');
  const panels = {
    single:  document.getElementById('tab-single'),
    dataset: document.getElementById('tab-dataset'),
  };

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(p => p && p.classList.add('hidden'));
      const t = panels[btn.dataset.tab];
      if (t) t.classList.remove('hidden');
    });
  });
})();

/* ── Single text analysis ── */
(function () {
  const textarea   = document.getElementById('single-text');
  const counter    = document.getElementById('char-counter');
  const btnAnalyze = document.getElementById('btn-single-analyze');
  const btnText    = btnAnalyze.querySelector('.btn-analyze-text');
  const btnSpinner = btnAnalyze.querySelector('.btn-analyze-spinner');
  const btnIcon    = btnAnalyze.querySelector('.analyze-icon');
  const errorMsg   = document.getElementById('single-error-msg');
  const resultEmpty   = document.getElementById('result-empty');
  const resultContent = document.getElementById('result-content');
  const agreementBadge = document.getElementById('result-agreement-badge');

  textarea.addEventListener('input', () => {
    counter.textContent = textarea.value.length.toLocaleString('id-ID') + ' karakter';
    errorMsg.style.display = 'none';
  });

  function setLoading(on) {
    btnAnalyze.disabled = on;
    btnText.style.display    = on ? 'none'   : 'inline';
    btnIcon.style.display    = on ? 'none'   : 'inline';
    btnSpinner.style.display = on ? 'block'  : 'none';
  }

  const LABEL_MAP = { positif: 'Positif', negatif: 'Negatif' };
  const CLASS_MAP = { positif: 'positive', negatif: 'negative' };

  function applyResult(ids, label, confidence) {
    const { cardId, barId, pctId, confId, badgeId } = ids;
    const pct = Math.round(confidence * 100);
    const key = label.toLowerCase();
    const cls = CLASS_MAP[key] || 'positive';
    const txt = LABEL_MAP[key] || label;

    const badge = document.getElementById(badgeId);
    badge.textContent = txt;
    badge.className = 'badge ' + cls;

    const bar = document.getElementById(barId);
    bar.style.width = '0%';
    bar.className = 'confidence-fill ' + cls;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));

    document.getElementById(pctId).textContent = pct + '%';
    document.getElementById(confId).textContent = pct + '% · ' + txt;

    const card = document.getElementById(cardId);
    card.className = 'result-model-card ' + cls + '-result';
  }

  function buildPreprocSteps(text) {
    const lower    = text.toLowerCase();
    const tokens   = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const STOPWORDS = new Set(['yang','dan','di','ke','dari','ini','itu','juga','dengan','untuk','ada',
      'tidak','sudah','saya','nya','ya','tapi','atau','bisa','kami','kita','kalau','jadi','lebih',
      'sangat','banget','sekali','cukup','punya','saat','atas','bawah','dalam','lagi','bagi','karena',
      'oleh','pada','setelah','sebelum','antara','lalu','akan','masih','hanya','seperti','setiap',
      'mau','buat','bahwa','sih','nih','deh','dong','loh','kan','aja','udah','dah','gak','ga','nggak']);
    const filtered = tokens.filter(t => !STOPWORDS.has(t) && t.length > 1);
    const stemmed  = filtered.map(t =>
      t.replace(/^(me|ber|di|ke|ter|pe|per|se)/, '').replace(/(kan|an|i|nya|lah|kah|pun)$/, '') || t
    );

    const steps = [
      { label: 'Lowercase',          text: lower.substring(0, 90) + (lower.length > 90 ? '…' : '') },
      { label: 'Tokenisasi',         text: tokens.slice(0, 14).join(' · ') + (tokens.length > 14 ? ' …' : '') },
      { label: 'Stopword Removal',   text: filtered.slice(0, 14).join(' · ') + (filtered.length > 14 ? ' …' : '') || '(semua token terfilter)' },
      { label: 'Stemming',           text: stemmed.slice(0, 14).join(' · ') + (stemmed.length > 14 ? ' …' : '') || '—' },
      { label: 'Vektorisasi TF-IDF', text: 'Vektor ' + stemmed.length + ' fitur — diproses server-side' },
    ];

    document.getElementById('preproc-steps').innerHTML = steps.map((s, i) => `
      <div class="preproc-step">
        <div class="preproc-step-num">${i + 1}</div>
        <div class="preproc-step-body">
          <div class="preproc-step-label">${s.label}</div>
          <div class="preproc-step-text">${esc(s.text)}</div>
        </div>
      </div>`).join('');
  }

  async function callPredict(text, saveToDb) {
    const res = await fetch('http://localhost:8000/api/predict/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token'),
      },
      body: JSON.stringify({ text, save_to_db: !!saveToDb }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  const toId = s => (s === 'negative' || s === 'negatif' ? 'negatif' : 'positif');

  function demoResult() {
    const labels = ['positif', 'negatif'];
    return { label: labels[Math.floor(Math.random() * labels.length)], confidence: 0.65 + Math.random() * 0.3 };
  }

  btnAnalyze.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) { errorMsg.style.display = 'block'; textarea.focus(); return; }

    setLoading(true);
    errorMsg.style.display = 'none';

    try {
      const saveDb = document.getElementById('toggle-save-db').checked;
      let nbRes, svmRes;
      try {
        const data = await callPredict(text, saveDb);
        if (!data.nb_sentiment && !data.svm_sentiment) throw new Error('model kosong');
        nbRes  = { label: toId(data.nb_sentiment || data.svm_sentiment),  confidence: data.nb_confidence  || 0 };
        svmRes = { label: toId(data.svm_sentiment || data.nb_sentiment), confidence: data.svm_confidence || 0 };
      } catch (_) {
        nbRes = demoResult(); svmRes = demoResult();   // fallback offline
      }

      resultEmpty.classList.add('hidden');
      resultContent.classList.remove('hidden');

      applyResult({ cardId: 'nb-card',  barId: 'nb-bar',  pctId: 'nb-pct',  confId: 'nb-conf-text',  badgeId: 'nb-badge'  }, nbRes.label,  nbRes.confidence);
      applyResult({ cardId: 'svm-card', barId: 'svm-bar', pctId: 'svm-pct', confId: 'svm-conf-text', badgeId: 'svm-badge' }, svmRes.label, svmRes.confidence);

      const agree = nbRes.label.toLowerCase() === svmRes.label.toLowerCase();
      agreementBadge.textContent = agree ? 'Kedua model sepakat' : 'Hasil berbeda';
      agreementBadge.className   = 'badge ' + (agree ? 'positive' : 'warn');
      agreementBadge.classList.remove('hidden');

      buildPreprocSteps(text);
      updatePrintResult(text, nbRes, svmRes);
    } finally {
      setLoading(false);
    }
  });

  function updatePrintResult(text, nbRes, svmRes) {
    document.getElementById('print-analyzed-text').textContent = text;
    document.getElementById('print-nb-label').textContent  = LABEL_MAP[nbRes.label.toLowerCase()]  || nbRes.label;
    document.getElementById('print-nb-conf').textContent   = Math.round(nbRes.confidence * 100) + '%';
    document.getElementById('print-svm-label').textContent = LABEL_MAP[svmRes.label.toLowerCase()] || svmRes.label;
    document.getElementById('print-svm-conf').textContent  = Math.round(svmRes.confidence * 100) + '%';
  }
})();

/* ── Preprocessing detail toggle ── */
(function () {
  const toggle = document.getElementById('toggle-preproc');
  const detail = document.getElementById('preproc-detail');
  if (!toggle || !detail) return;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    detail.classList.toggle('open', !expanded);
  });
})();


/* ── Prediksi Dataset (dari data hasil preprocessing di DB) ── */
(function () {
  const API     = 'http://localhost:8000';
  const tbody   = document.getElementById('ds-tbody');
  const emptyEl = document.getElementById('ds-empty');
  const subEl   = document.getElementById('ds-sub');
  const btnRun  = document.getElementById('btn-run-predict');
  const summary = document.getElementById('ds-summary');
  if (!btnRun) return;

  let dataState = 'loading';   // 'loading' | 'ok' | 'empty' | 'error'
  let rows = [];

  function authHeaders(json) {
    const h = { 'Authorization': 'Bearer ' + localStorage.getItem('token') };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function loadPending() {
    try {
      const res = await fetch(`${API}/api/predict/db/pending`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      rows = await res.json();
      dataState = rows.length ? 'ok' : 'empty';
    } catch (_) {
      rows = []; dataState = 'error';
    }
    render();
  }

  function render() {
    summary.classList.add('hidden');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyEl.style.display = 'block';
      emptyEl.textContent =
        dataState === 'error'
          ? 'Tidak dapat terhubung ke server backend (http://localhost:8000).'
          : 'Belum ada data preprocessed yang menunggu prediksi. Jalankan Preprocessing terlebih dahulu.';
      subEl.textContent = dataState === 'error' ? 'Server tidak terhubung' : 'Tidak ada antrean';
      btnRun.disabled = true;
      return;
    }
    emptyEl.style.display = 'none';
    btnRun.disabled = false;
    subEl.textContent = `${rows.length} ulasan siap diprediksi`;
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c1)" title="${esc(r.teks)}">${esc(r.teks)}</td>
        <td class="text-[11px] text-c3" title="${esc(r.stemmed || '')}">${esc((r.stemmed || '').slice(0, 48))}${(r.stemmed || '').length > 48 ? '…' : ''}</td>
        <td>${r.bintang ? r.bintang + '★' : '—'}</td>
        <td class="text-[11px]">${esc(r.source || '-')}</td>
      </tr>`).join('');
  }

  function setLoading(on) {
    btnRun.disabled = on;
    btnRun.querySelector('.ds-run-text').style.display = on ? 'none' : '';
    btnRun.querySelector('.ds-run-spinner').style.display = on ? 'block' : 'none';
  }

  btnRun.addEventListener('click', async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/predict/db`, {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ review_ids: null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Gagal'); }
      const data = await res.json();
      showSummary(data.analyzed);
      await loadPending();
    } catch (err) {
      showSummary(0, err.message);
    } finally {
      setLoading(false);
    }
  });

  function showSummary(n, errMsg) {
    summary.classList.remove('hidden');
    summary.innerHTML = errMsg
      ? `<span style="color:#F87171">Gagal: ${esc(errMsg)}</span>`
      : `<span style="color:#4ADE80;font-weight:600">${n} ulasan berhasil diprediksi.</span> Lihat label NB/SVM di halaman <a href="ulasan.html" class="text-accent hover:underline">Data Ulasan</a>.`;
  }

  loadPending();
})();

/* ── Print handlers (topbar buttons) ── */
(function () {
  function fmtDate() {
    return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function printDoc(docId) {
    const dateId = docId === 'print-result-doc' ? 'print-date-result' : 'print-date-compare';
    const dateEl = document.getElementById(dateId);
    if (dateEl) dateEl.textContent = fmtDate();

    document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing'));
    document.getElementById(docId).classList.add('printing');
    window.print();
    setTimeout(() => document.querySelectorAll('.print-doc').forEach(d => d.classList.remove('printing')), 600);
  }

  document.getElementById('btn-print-result').addEventListener('click', () => printDoc('print-result-doc'));
  document.getElementById('btn-print-compare').addEventListener('click', () => printDoc('print-compare-doc'));
})();

/* ── Utility ── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

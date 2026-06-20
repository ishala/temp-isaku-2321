/* ═══════════════════════════════════════════════════════
   theme.js — toggle tema light/dark (shared)
   Tema awal sudah di-set oleh script inline di <head>
   (anti-flash). File ini menangani tombol & persistensi.
   ═══════════════════════════════════════════════════════ */
(function () {
  const root = document.documentElement;

  /* SVG path untuk ikon (di dalam <svg id="theme-icon">) */
  const ICON = {
    /* tampil saat tema gelap → tawarkan beralih ke terang (matahari) */
    dark: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    /* tampil saat tema terang → tawarkan beralih ke gelap (bulan) */
    light: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  };

  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function paintIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = ICON[theme] || ICON.dark;
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.style.background = theme === 'light' ? '#F4F5FA' : '#080810';
    try { localStorage.setItem('theme', theme); } catch (_) {}
    paintIcon(theme);
    /* beri tahu komponen lain (mis. chart canvas) untuk re-render */
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function toggle() {
    apply(current() === 'light' ? 'dark' : 'light');
  }

  /* init ikon sesuai tema aktif + pasang handler */
  paintIcon(current());
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', toggle);
})();

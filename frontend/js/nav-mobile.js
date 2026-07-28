/* nav-mobile.js — drawer sidebar untuk layar <1024px.
   Dipakai bersama oleh 9 halaman shell. Tidak menyentuh logika bisnis. */
(function () {
  'use strict';

  var LG = 1024;

  var CLOSE_ICON =
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6"><path d="M5.5 5.5l9 9m0-9l-9 9" stroke-linecap="round"/></svg>';

  /* Drawer menutupi hamburger di topbar saat terbuka, jadi drawer
     diberi tombol tutupnya sendiri di pojok kanan header sidebar. */
  function buildCloseButton(sidebar) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-close';
    btn.setAttribute('aria-label', 'Tutup menu');
    btn.innerHTML = CLOSE_ICON;

    var header = sidebar.firstElementChild;
    if (header) header.appendChild(btn);
    else sidebar.insertBefore(btn, sidebar.firstChild);

    return btn;
  }

  function init() {
    var btn     = document.getElementById('btn-menu');
    var sidebar = document.querySelector('.sidebar');
    var overlay = document.getElementById('nav-overlay');

    if (!sidebar || !btn) return;

    var closeBtn = buildCloseButton(sidebar);

    function isOpen() {
      return sidebar.classList.contains('open');
    }

    function open() {
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      closeBtn.focus();
    }

    function close() {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.setAttribute('aria-expanded', 'false');
    if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', 'Buka menu');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    });

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      close();
    });

    if (overlay) overlay.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });

    // Tutup drawer saat pindah halaman lewat link di sidebar, dan saat
    // tombol Keluar ditekan — modal logout (z-50) berada di bawah drawer,
    // jadi drawer harus menyingkir dulu supaya dialognya terlihat.
    sidebar.addEventListener('click', function (e) {
      if (window.innerWidth >= LG) return;
      if (e.target.closest('a, #logout-btn')) close();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= LG && isOpen()) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

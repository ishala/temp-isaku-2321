/* ── Particle canvas ── */
(function () {
  const canvas = document.getElementById('canvas-bg');
  const ctx = canvas.getContext('2d');
  let W, H, particles;

  const COLOR = 'rgba(108,99,255,';

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function mkParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.4,
      vx: (Math.random() - .5) * .3,
      vy: (Math.random() - .5) * .3,
      a: Math.random() * .4 + .05,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, mkParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* subtle diagonal accent lines */
    ctx.save();
    ctx.strokeStyle = 'rgba(108,99,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = -H; i < W + H; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }
    ctx.restore();

    /* particles */
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = COLOR + p.a + ')';
      ctx.fill();
    });

    /* connecting lines */
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.strokeStyle = COLOR + ((1 - dist / 100) * .06) + ')';
          ctx.lineWidth = .5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init();
  draw();
})();

/* ── Eye toggle ── */
const eyeBtn = document.getElementById('eye-btn');
const pwdInput = document.getElementById('password');
const eyeIcon = document.getElementById('eye-icon');

eyeBtn.addEventListener('click', () => {
  const show = pwdInput.type === 'password';
  pwdInput.type = show ? 'text' : 'password';
  eyeIcon.innerHTML = show
    ? `<path d="M3.5 3.5l13 13M8.5 8.7A3 3 0 0 0 11.3 11.5m-4.6-4.8A5.5 5.5 0 0 0 2.5 10s3 5.5 7.5 5.5c1.4 0 2.7-.4 3.8-1.1M7 5a10 10 0 0 1 3-.5c4.5 0 7.5 5.5 7.5 5.5a13 13 0 0 1-2.7 3.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>`
    : `<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="10" cy="10" r="2.25" stroke="currentColor" stroke-width="1.5" fill="none"/>`;
  eyeBtn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
});

/* ── Form validation & submit ── */
const form = document.getElementById('login-form');
const btnLogin = document.getElementById('btn-login');
const alertEl = document.getElementById('alert-error');
const alertText = document.getElementById('alert-text');

function setFieldError(id, show) {
  const el = document.getElementById('err-' + id);
  const inp = document.getElementById(id);
  el.classList.toggle('show', show);
  inp.classList.toggle('err', show);
}

function clearErrors() {
  ['username', 'password'].forEach(id => setFieldError(id, false));
  alertEl.classList.remove('error', 'success');
  alertEl.style.display = 'none';
}

function showAlert(msg, type = 'error') {
  alertText.textContent = msg;
  alertEl.className = 'alert ' + type;
  alertEl.style.display = 'flex';
}

function setLoading(on) {
  btnLogin.disabled = on;
  btnLogin.classList.toggle('loading', on);
}

/* Input: clear error on type */
['username', 'password'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    setFieldError(id, false);
    alertEl.style.display = 'none';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  let hasError = false;
  if (!username) { setFieldError('username', true); hasError = true; }
  if (!password) { setFieldError('password', true); hasError = true; }
  if (hasError) return;

  setLoading(true);

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert(data.detail || 'Username atau password salah.');
      setFieldError('username', true);
      setFieldError('password', true);
      return;
    }

    /* Simpan token & info user */
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify({
      id: data.user_id,
      username: data.username,
      full_name: data.full_name,
      role: data.role,
    }));

    showAlert('Login berhasil, mengalihkan…', 'success');

    /* Redirect by role */
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 700);

  } catch (err) {
    showAlert('Tidak dapat terhubung ke server. Pastikan backend sudah berjalan.');
  } finally {
    setLoading(false);
  }
});

/* ── Auto-redirect if already logged in ── */
(function () {
  const token = localStorage.getItem('token');
  if (token) window.location.href = 'dashboard.html';
})();

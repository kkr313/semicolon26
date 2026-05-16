// ClinDoc AI — Auth Logic

/* ---- Modal ---- */
function openAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}
function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

/* ---- Fill test credentials ---- */
function fillLogin(email, pwd) {
    switchTab('login');
    const form = document.getElementById('login-form');
    form.querySelector('input[name="email"]').value = email;
    form.querySelector('input[name="password"]').value = pwd;
}

/* ---- Tab Toggle ---- */
function switchTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');
    const ql = document.getElementById('quick-login');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginTab.style.background = 'var(--bg-accent-soft)';
        loginTab.style.color = 'var(--text-heading)';
        registerTab.style.background = 'transparent';
        registerTab.style.color = 'var(--text-muted)';
        if (ql) ql.classList.remove('hidden');
    } else {
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        registerTab.style.background = 'var(--bg-accent-soft)';
        registerTab.style.color = 'var(--text-heading)';
        loginTab.style.background = 'transparent';
        loginTab.style.color = 'var(--text-muted)';
        if (ql) ql.classList.add('hidden');
    }
}

/* ---- Login (called by inline onsubmit on index.html) ---- */
async function handleLogin(e) {
    e.preventDefault();
    const formEl = e.target;
    const fd = new FormData(formEl);            // reads name= attributes
    const btn = formEl.querySelector('button[type="submit"]');
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        const res = await fetch('/api/auth/login', { method: 'POST', body: fd });
        const data = await res.json();

        if (res.ok && data.success) {
            localStorage.setItem('clindoc_user', JSON.stringify(data.user));
            showToast('Welcome back!', 'success');
            setTimeout(() => {
                window.location.href = '/analyzer';
            }, 400);
        } else {
            errEl.textContent = data.detail || 'Invalid credentials';
            errEl.classList.remove('hidden');
        }
    } catch (err) {
        errEl.textContent = 'Connection error';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

/* ---- Register (called by inline onsubmit on index.html) ---- */
async function handleRegister(e) {
    e.preventDefault();
    const formEl = e.target;
    const fd = new FormData(formEl);
    const btn = formEl.querySelector('button[type="submit"]');
    const errEl = document.getElementById('register-error');
    const okEl = document.getElementById('register-success');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
        const res = await fetch('/api/auth/register', { method: 'POST', body: fd });
        const data = await res.json();

        if (res.ok && data.success) {
            okEl.textContent = 'Account created! Switching to login...';
            okEl.classList.remove('hidden');
            setTimeout(() => switchTab('login'), 1000);
        } else {
            errEl.textContent = data.detail || 'Registration failed';
            errEl.classList.remove('hidden');
        }
    } catch (err) {
        errEl.textContent = 'Connection error';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}

/* ---- Toast ---- */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* ---- Wire up all event listeners (CSP-safe, no inline handlers) ---- */
document.addEventListener('DOMContentLoaded', () => {
    // Auto-redirect if already logged in
    const user = JSON.parse(localStorage.getItem('clindoc_user') || 'null');
    if (user) { window.location.href = '/analyzer'; return; }

    // Theme toggle
    const themeBtn = document.querySelector('.theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Open auth modal buttons
    document.querySelectorAll('[data-action="open-auth"]').forEach(btn => {
        btn.addEventListener('click', openAuthModal);
    });

    // Close auth modal: backdrop + X button
    const backdrop = document.getElementById('auth-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeAuthModal);
    const closeBtn = document.getElementById('auth-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);

    // Escape key
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAuthModal(); });

    // Tab buttons
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    if (tabLogin) tabLogin.addEventListener('click', () => switchTab('login'));
    if (tabRegister) tabRegister.addEventListener('click', () => switchTab('register'));

    // Form submissions
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    // Test account quick-fill button
    const testBtn = document.getElementById('btn-test-account');
    if (testBtn) testBtn.addEventListener('click', () => fillLogin('demo@optum.com', 'demo123'));
});

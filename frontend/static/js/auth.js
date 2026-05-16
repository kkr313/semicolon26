// ClinDoc AI — Auth Logic

document.addEventListener('DOMContentLoaded', () => {
    const user = JSON.parse(localStorage.getItem('clindoc_user') || 'null');
    if (user) {
        window.location.href = '/analyzer';
    }
});

/* ---- Tab Toggle ---- */
function switchTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginTab.classList.add('bg-white/10', 'text-white');
        loginTab.classList.remove('text-slate-400');
        registerTab.classList.remove('bg-white/10', 'text-white');
        registerTab.classList.add('text-slate-400');
    } else {
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        registerTab.classList.add('bg-white/10', 'text-white');
        registerTab.classList.remove('text-slate-400');
        loginTab.classList.remove('bg-white/10', 'text-white');
        loginTab.classList.add('text-slate-400');
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

// ClinDoc AI — User Dashboard Logic

let chartScoreTrend = null;
let chartFeedback = null;

document.addEventListener('DOMContentLoaded', () => {
    const user = JSON.parse(localStorage.getItem('clindoc_user') || 'null');
    if (!user) { window.location.href = '/'; return; }
    document.getElementById('user-name').textContent = user.name || user.email;
    document.getElementById('greeting').textContent = 'Welcome, ' + (user.name || user.email);
    loadUserData();
});

function handleLogout() {
    localStorage.removeItem('clindoc_user');
    window.location.href = '/';
}

async function loadUserData() {
    const user = JSON.parse(localStorage.getItem('clindoc_user') || '{}');
    if (!user.id) return;

    try {
        const res = await fetch(`/api/user/history?user_id=${encodeURIComponent(user.id)}`);
        const data = await res.json();
        if (!res.ok) return;

        const history = data.history || [];
        const feedback = data.feedback || [];

        document.getElementById('stat-total-analyses').textContent = data.total_analyses || 0;
        document.getElementById('stat-total-feedback').textContent = feedback.length;

        renderHistory(history, data.total_analyses || 0);
        renderFeedbackList(feedback);
        renderScoreTrendChart(history);
        renderFeedbackChart(feedback);
    } catch (err) {
        console.error('Failed to load user data:', err);
    }
}

function renderHistory(history, totalAnalyses) {
    const listEl = document.getElementById('history-list');
    const noMsg = document.getElementById('no-history-msg');
    const countEl = document.getElementById('history-count');

    if (history.length === 0) { noMsg.style.display = ''; return; }

    noMsg.style.display = 'none';
    document.getElementById('history-header').classList.remove('hidden');
    document.getElementById('history-header').classList.add('grid');
    countEl.textContent = `Last ${history.length} of ${totalAnalyses}`;
    listEl.innerHTML = '';

    for (const h of history.slice().reverse()) {
        const date = h.analyzed_at ? new Date(h.analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
        const scoreColor = h.quality_score >= 80 ? '--clinical-green' : h.quality_score >= 60 ? '--clinical-blue' : h.quality_score >= 40 ? '--clinical-amber' : '--clinical-red';
        const docType = (h.doc_type || 'unknown').replace(/_/g, ' ');
        const gradeLetterBg = h.quality_grade === 'A' ? '--clinical-green' : h.quality_grade === 'B' ? '--clinical-blue' : h.quality_grade === 'C' ? '--clinical-amber' : '--clinical-red';

        listEl.innerHTML += `
            <div class="grid grid-cols-12 gap-3 items-center p-3 px-4 rounded-xl transition-colors" style="background:var(--bg-card-hover);border-left:3px solid var(${scoreColor});">
                <div class="col-span-4 flex items-center gap-3 min-w-0">
                    <span class="inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-black flex-shrink-0" style="background:color-mix(in srgb, var(${gradeLetterBg}) 15%, transparent);color:var(${gradeLetterBg});">${h.quality_grade || '?'}</span>
                    <div class="min-w-0">
                        <p class="text-sm font-semibold truncate" style="color:var(--text-heading);">${escapeHtml(h.filename || 'Unknown')}</p>
                        <p class="text-xs" style="color:var(--text-muted);">${escapeHtml(docType)}</p>
                    </div>
                </div>
                <div class="col-span-2 text-center">
                    <span class="text-sm font-bold" style="color:var(${scoreColor});">${h.quality_score}%</span>
                </div>
                <div class="col-span-2 text-center">
                    <span class="inline-flex items-center gap-1 text-sm font-bold" style="color:var(--clinical-amber);">${h.findings_count} <span class="text-xs font-normal" style="color:var(--text-muted);">issues</span></span>
                </div>
                <div class="col-span-2 text-center">
                    <span class="text-sm font-bold" style="color:var(--clinical-teal);">${h.compliance_pct}%</span>
                </div>
                <div class="col-span-2 text-right text-xs" style="color:var(--text-muted);">${date}</div>
            </div>`;
    }
}

function renderFeedbackList(feedback) {
    const listEl = document.getElementById('feedback-list');
    const noMsg = document.getElementById('no-feedback-msg');
    const countEl = document.getElementById('feedback-count');

    if (feedback.length === 0) { noMsg.style.display = ''; return; }

    noMsg.style.display = 'none';
    countEl.textContent = feedback.length + ' entries';
    listEl.innerHTML = '';

    for (const fb of feedback.slice().reverse()) {
        const date = fb.submitted_at ? new Date(fb.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const isPositive = fb.rating === 'positive';
        const colorVar = isPositive ? '--clinical-green' : '--clinical-red';
        const icon = isPositive ? '👍' : '👎';
        const label = isPositive ? 'Accurate' : 'Needs work';

        listEl.innerHTML += `
            <div class="flex items-center gap-4 py-3.5 px-1" style="border-bottom:1px solid var(--border-card);">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style="background:color-mix(in srgb, var(${colorVar}) 12%, transparent);">${icon}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <p class="text-sm font-medium truncate" style="color:var(--text-heading);">${escapeHtml(fb.filename || 'Unknown')}</p>
                        <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full flex-shrink-0" style="color:var(${colorVar});background:color-mix(in srgb, var(${colorVar}) 10%, transparent);">${label}</span>
                    </div>
                    ${fb.comment ? `<p class="text-xs mt-0.5 truncate" style="color:var(--text-secondary);">"${escapeHtml(fb.comment)}"</p>` : ''}
                </div>
                <span class="text-xs flex-shrink-0" style="color:var(--text-muted);">${date}</span>
            </div>`;
    }
}

function renderScoreTrendChart(history) {
    if (chartScoreTrend) chartScoreTrend.destroy();
    const ctx = document.getElementById('chart-score-trend').getContext('2d');

    if (history.length === 0) {
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = getCSSVar('--text-muted');
        ctx.textAlign = 'center';
        ctx.fillText('No data yet — analyze a document first', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    const labels = history.map(h => {
        if (!h.analyzed_at) return '—';
        const d = new Date(h.analyzed_at);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const scores = history.map(h => h.quality_score || 0);

    chartScoreTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: scores,
                borderColor: getCSSVar('--clinical-teal'),
                backgroundColor: 'rgba(13,148,136,0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: getCSSVar('--clinical-teal'),
                pointBorderWidth: 0,
                borderWidth: 2.5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: chartTooltipConfig() },
            scales: {
                x: chartAxisConfig(false),
                y: { ...chartAxisConfig(true), beginAtZero: true, max: 100, ticks: { ...chartAxisConfig(true).ticks, stepSize: 25 } }
            },
            animation: { duration: 1000 }
        }
    });
}

function renderFeedbackChart(feedback) {
    if (chartFeedback) chartFeedback.destroy();
    const ctx = document.getElementById('chart-feedback').getContext('2d');

    const pos = feedback.filter(f => f.rating === 'positive').length;
    const neg = feedback.filter(f => f.rating === 'negative').length;
    const total = pos + neg;

    document.getElementById('feedback-total').textContent = total;

    // Update label text
    const labelEl = document.getElementById('feedback-label');
    if (labelEl) {
        if (total === 0) labelEl.textContent = 'Submit feedback on analyses';
        else if (pos > neg) labelEl.textContent = 'Mostly positive feedback';
        else if (neg > pos) labelEl.textContent = 'Mostly needs improvement';
        else labelEl.textContent = 'Mixed feedback';
    }

    if (total === 0) return;

    const greenColor = getCSSVar('--clinical-green');
    const redColor = getCSSVar('--clinical-red');

    // CSS filter glow on canvas
    ctx.canvas.style.filter = `drop-shadow(0 0 10px ${greenColor}50)`;

    chartFeedback = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Negative'],
            datasets: [{ data: [pos, neg], backgroundColor: [greenColor, redColor], hoverBackgroundColor: [greenColor, redColor], borderWidth: 0, borderRadius: 8, spacing: 2 }]
        },
        options: {
            cutout: '75%',
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: chartTooltipConfig() },
            animation: { animateRotate: true, duration: 1400, easing: 'easeOutQuart' }
        }
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

window.addEventListener('themechange', () => { loadUserData(); });

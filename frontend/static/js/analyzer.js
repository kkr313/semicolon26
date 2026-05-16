// ClinDoc AI — Analyzer Page Logic

let selectedFile = null;
let analysisResult = null;
let feedbackRating = null;
let analysisStartTime = null;
let chartQuality = null;
let chartSeverity = null;
let chartCompliance = null;
let lastResultData = null;

document.addEventListener('DOMContentLoaded', () => {
    const user = JSON.parse(localStorage.getItem('clindoc_user') || 'null');
    if (!user) { window.location.href = '/'; return; }
    document.getElementById('user-name').textContent = user.name || user.email;
    setupDropZone();
});

/* ---- LLM Status Check ---- */
async function checkLLMStatus() {
    const dot = document.getElementById('llm-status-dot');
    const text = document.getElementById('llm-status-text');
    try {
        const res = await fetch('/api/analysis/status');
        const data = await res.json();
        // Sync demo toggle with server .env config
        const demoToggle = document.getElementById('demo-toggle');
        if (demoToggle && typeof data.demo_mode === 'boolean') {
            demoToggle.checked = data.demo_mode;
        }
        if (data.online) {
            dot.style.background = getCSSVar('--clinical-green');
            text.textContent = 'LLM Gateway Online';
            text.style.color = getCSSVar('--clinical-green');
        } else {
            dot.style.background = getCSSVar('--clinical-red');
            text.textContent = 'LLM Gateway Offline';
            text.style.color = getCSSVar('--clinical-red');
        }
    } catch {
        dot.style.background = getCSSVar('--clinical-amber');
        text.textContent = 'Status Unknown';
        text.style.color = getCSSVar('--clinical-amber');
    }
}

/* ---- Load Available Models ---- */
async function loadModels() {
    const select = document.getElementById('model-select');
    try {
        const res = await fetch('/api/analysis/models');
        const data = await res.json();
        if (data.models && data.models.length) {
            select.innerHTML = '';
            for (const m of data.models) {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (m === 'gpt-4.1-nano') opt.selected = true;
                select.appendChild(opt);
            }
        }
    } catch {
        select.innerHTML = '<option value="gpt-4.1-nano">gpt-4.1-nano</option>';
    }
}

function handleLogout() {
    localStorage.removeItem('clindoc_user');
    window.location.href = '/';
}

/* ---- File Upload ---- */
function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drop-zone-active'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drop-zone-active'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone-active');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
}

function handleFile(file) {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|docx|txt)$/i)) {
        showToast('Unsupported file type. Use PDF, DOCX, or TXT.', 'error');
        return;
    }
    if (file.size < 100) {
        showToast('File is too small — it may be empty or corrupted.', 'error');
        return;
    }
    selectedFile = file;
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatSize(file.size);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ---- AI Pipeline Animation ---- */
const AI_STEPS = [
    { pct: [0, 8],   label: 'Parsing',        messages: ['Reading document bytes...', 'Detecting file format...', 'Extracting raw text content...'] },
    { pct: [8, 15],  label: 'Chunking',       messages: ['Calculating token boundaries...', 'Building context-aware segments...'] },
    { pct: [15, 40], label: 'NLP Extraction',  messages: ['Sending chunks to LLM for summarization...', 'Extracting clinical entities (drugs, endpoints, AEs)...', 'Waiting for LLM response...', 'Processing entity extraction results...'] },
    { pct: [40, 70], label: 'Risk Scan',       messages: ['Running LLM risk analysis per chunk...', 'Checking ICH-GCP / ICH E3 compliance...', 'Evaluating severity of findings...', 'Cross-referencing regulatory rules...', 'Waiting for risk analysis response...'] },
    { pct: [70, 85], label: 'Rule Checks',     messages: ['Running rule-based section coverage scan...', 'Checking abbreviations & ambiguous language...', 'Computing completeness score...'] },
    { pct: [85, 95], label: 'Report',          messages: ['Calculating quality score & grade...', 'Building section coverage map...', 'Compiling final report...'] }
];

let pipelineTimer = null;
let logTimer = null;
let pipelineMaxPct = 95;

const RING_CIRCUMFERENCE = 2 * Math.PI * 38; // 238.76
function updateProgressRing(pct) {
    const ring = document.getElementById('progress-ring');
    if (ring) {
        const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
        ring.style.strokeDashoffset = offset;
    }
}

function spawnParticles() {
    const container = document.getElementById('ai-particles');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        p.className = 'ai-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.bottom = '0';
        p.style.animationDelay = (Math.random() * 3) + 's';
        p.style.animationDuration = (2 + Math.random() * 2) + 's';
        container.appendChild(p);
    }
}

function addLogLine(text, tag = 'info') {
    const log = document.getElementById('ai-log');
    if (!log) return;
    const tagColors = { info: '--clinical-teal', parse: '--clinical-blue', nlp: '--clinical-green', risk: '--clinical-amber', done: '--clinical-green' };
    const line = document.createElement('div');
    line.className = 'ai-log-line';
    line.innerHTML = `<span style="color:var(${tagColors[tag] || '--clinical-teal'});">[${tag}]</span> ${escapeHtml(text)}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function startPipelineAnimation(isDemoMode) {
    const steps = document.querySelectorAll('.ai-step');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const pctEl = document.getElementById('progress-pct');
    const log = document.getElementById('ai-log');

    // Reset state
    pipelineMaxPct = 95;
    steps.forEach(s => { s.classList.remove('active', 'done'); s.querySelector('.ai-step-fill').style.width = '0%'; });
    progressBar.style.width = '0%';
    pctEl.textContent = '0%';
    updateProgressRing(0);
    log.innerHTML = '<div class="ai-log-line"><span style="color:var(--clinical-teal);">[init]</span> Pipeline started...</div>';
    spawnParticles();

    let currentStep = 0;
    let currentPct = 0;
    // Demo: fast. Real LLM: slow, realistic pacing
    const speed = isDemoMode ? 80 : 800;
    const increment = isDemoMode ? 3 : 0.5;
    let msgIdx = 0;

    function tick() {
        if (currentStep >= AI_STEPS.length) return;
        // Don't exceed the cap — hold at max until API returns
        if (currentPct >= pipelineMaxPct) {
            progressText.textContent = 'Waiting for LLM response...';
            pipelineTimer = setTimeout(tick, 1000);
            return;
        }
        const step = AI_STEPS[currentStep];
        const stepEl = steps[currentStep];

        // Activate step
        if (!stepEl.classList.contains('active')) {
            stepEl.classList.add('active');
            progressText.textContent = step.messages[0];
            addLogLine(step.messages[0], ['parse', 'parse', 'nlp', 'risk', 'nlp', 'done'][currentStep]);
            msgIdx = 1;
        }

        // Advance within step
        const range = step.pct[1] - step.pct[0];
        const targetPct = Math.min(step.pct[1], pipelineMaxPct);
        currentPct = Math.min(currentPct + increment, targetPct);
        const stepProgress = ((currentPct - step.pct[0]) / range) * 100;
        stepEl.querySelector('.ai-step-fill').style.width = Math.min(stepProgress, 100) + '%';
        progressBar.style.width = currentPct + '%';
        pctEl.textContent = Math.round(currentPct) + '%';
        updateProgressRing(currentPct);

        // Show next message
        if (msgIdx < step.messages.length && stepProgress > (msgIdx / step.messages.length) * 100) {
            progressText.textContent = step.messages[msgIdx];
            addLogLine(step.messages[msgIdx], ['parse', 'parse', 'nlp', 'risk', 'nlp', 'done'][currentStep]);
            msgIdx++;
        }

        // Step complete
        if (currentPct >= step.pct[1]) {
            stepEl.classList.remove('active');
            stepEl.classList.add('done');
            stepEl.querySelector('.ai-step-fill').style.width = '100%';
            currentStep++;
            if (currentStep < AI_STEPS.length) {
                pipelineTimer = setTimeout(tick, speed);
            }
            return;
        }
        pipelineTimer = setTimeout(tick, speed);
    }

    pipelineTimer = setTimeout(tick, 300);
}

function stopPipelineAnimation(success) {
    if (pipelineTimer) { clearTimeout(pipelineTimer); pipelineTimer = null; }
    const steps = document.querySelectorAll('.ai-step');
    const progressBar = document.getElementById('progress-bar');
    const pctEl = document.getElementById('progress-pct');
    const progressText = document.getElementById('progress-text');

    steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); s.querySelector('.ai-step-fill').style.width = '100%'; });
    progressBar.style.width = '100%';
    pctEl.textContent = '100%';
    updateProgressRing(100);
    if (success) {
        progressText.textContent = 'Analysis complete!';
        addLogLine('All steps finished — report ready.', 'done');
    }
}

/* ---- Run Analysis ---- */
let analysisAbortController = null;

function cancelAnalysis() {
    if (analysisAbortController) {
        analysisAbortController.abort();
        analysisAbortController = null;
    }
    stopPipelineAnimation(false);
    const progressSection = document.getElementById('progress-section');
    progressSection.classList.add('hidden');
    addLogLine('Analysis cancelled by user.', 'risk');
    showToast('Analysis cancelled.', 'info');
}

async function runAnalysis() {
    if (!selectedFile) { showToast('Please select a file first.', 'error'); return; }

    const demoMode = document.getElementById('demo-toggle').checked;
    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');

    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    // Create abort controller for this request
    analysisAbortController = new AbortController();
    analysisStartTime = performance.now();

    startPipelineAnimation(demoMode);

    try {
        const form = new FormData();
        form.append('file', selectedFile);
        form.append('demo_mode', demoMode ? 'true' : 'false');
        form.append('model', document.getElementById('model-select').value);
        const user = JSON.parse(localStorage.getItem('clindoc_user') || '{}');
        if (user.id) form.append('user_id', user.id);

        const res = await fetch('/api/analysis/run', { method: 'POST', body: form, signal: analysisAbortController.signal });

        let data;
        try { data = await res.json(); } catch { data = { detail: 'Server error — please try again.' }; }

        stopPipelineAnimation(res.ok && data.success);

        if (res.ok && data.success) {
            analysisResult = data;
            setTimeout(() => {
                progressSection.classList.add('hidden');
                renderResults(data);
            }, 800);
        } else if (res.status === 422) {
            // Validation error (non-clinical doc, parse error) — show modal
            progressSection.classList.add('hidden');
            showValidationModal(data.detail || 'Document validation failed.');
        } else {
            progressSection.classList.add('hidden');
            showValidationModal(data.detail || 'Analysis failed. Please try again.');
        }
    } catch (err) {
        stopPipelineAnimation(false);
        if (err.name === 'AbortError') {
            // User cancelled — already handled in cancelAnalysis()
            return;
        }
        showToast('Connection error: ' + err.message, 'error');
        progressSection.classList.add('hidden');
    } finally {
        analysisAbortController = null;
    }
}

/* ---- Chart Helpers ---- */
function destroyCharts() {
    if (chartQuality) { chartQuality.destroy(); chartQuality = null; }
    if (chartSeverity) { chartSeverity.destroy(); chartSeverity = null; }
    if (chartCompliance) { chartCompliance.destroy(); chartCompliance = null; }
}

function createDonutChart(canvasId, value, max, color, bgColor) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    // CSS filter glow — only affects visible (colored) pixels
    canvas.style.filter = `drop-shadow(0 0 10px ${color}50)`;

    return new Chart(ctx, {
        type: 'doughnut',
        data: { datasets: [{
            data: [value, Math.max(0, max - value)],
            backgroundColor: [color, bgColor || getCSSVar('--chart-grid')],
            hoverBackgroundColor: [color, bgColor || getCSSVar('--chart-grid')],
            borderWidth: 0,
            borderRadius: 8,
            spacing: 2
        }] },
        options: {
            cutout: '75%',
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { animateRotate: true, duration: 1400, easing: 'easeOutQuart' }
        }
    });
}

function getScoreColor(score) {
    if (score >= 80) return getCSSVar('--clinical-green');
    if (score >= 60) return getCSSVar('--clinical-blue');
    if (score >= 40) return getCSSVar('--clinical-amber');
    return getCSSVar('--clinical-red');
}

/* ---- Render Results ---- */
function renderResults(data) {
    lastResultData = data;
    destroyCharts();
    const section = document.getElementById('results-section');
    section.classList.remove('hidden');

    const quality = data.quality || {};
    const score = quality.score ?? 0;
    const grade = quality.grade ?? '—';
    const allFindings = [...(data.risk?.findings || []), ...(data.rule?.rule_findings || [])];

    // Quality Score Gauge
    const scoreColor = getScoreColor(score);
    chartQuality = createDonutChart('chart-quality', score, 100, scoreColor);
    document.getElementById('gauge-score').textContent = score + '%';
    document.getElementById('gauge-score').style.color = scoreColor;
    const gradeEl = document.getElementById('gauge-grade');
    gradeEl.textContent = 'Grade ' + grade;
    gradeEl.style.background = scoreColor + '18';
    gradeEl.style.color = scoreColor;
    const scoreLabelEl = document.getElementById('score-label');
    if (scoreLabelEl) scoreLabelEl.textContent = score >= 80 ? 'Excellent quality' : score >= 60 ? 'Good — minor issues' : score >= 40 ? 'Needs improvement' : 'Critical issues found';

    // Severity Distribution
    const sevCounts = { high: 0, medium: 0, low: 0 };
    for (const f of allFindings) { const sev = (f.severity || 'low').toLowerCase(); if (sev in sevCounts) sevCounts[sev]++; else sevCounts.low++; }
    const sevCtx = document.getElementById('chart-severity').getContext('2d');
    chartSeverity = new Chart(sevCtx, {
        type: 'bar',
        data: { labels: ['High', 'Medium', 'Low'], datasets: [{ data: [sevCounts.high, sevCounts.medium, sevCounts.low], backgroundColor: [getCSSVar('--clinical-red'), getCSSVar('--clinical-amber'), getCSSVar('--clinical-blue')], borderRadius: 8, borderSkipped: false, barThickness: 36 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartTooltipConfig() }, scales: { x: chartAxisConfig(false), y: { ...chartAxisConfig(true), beginAtZero: true, ticks: { ...chartAxisConfig(true).ticks, stepSize: 1 } } }, animation: { duration: 1000 } }
    });
    document.getElementById('severity-legend').innerHTML = `
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-red);"></span>High: ${sevCounts.high}</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-amber);"></span>Medium: ${sevCounts.medium}</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-blue);"></span>Low: ${sevCounts.low}</span>`;

    // Compliance Ring
    const sectionCoverage = data.rule?.section_coverage || {};
    const coverageEntries = Object.entries(sectionCoverage);
    const totalSections = coverageEntries.length || 1;
    const presentSections = coverageEntries.filter(([, info]) => info.present).length;
    const compPct = Math.round((presentSections / totalSections) * 100);
    const compColor = compPct >= 80 ? getCSSVar('--clinical-green') : compPct >= 50 ? getCSSVar('--clinical-amber') : getCSSVar('--clinical-red');
    chartCompliance = createDonutChart('chart-compliance', presentSections, totalSections, compColor);
    document.getElementById('compliance-pct').textContent = presentSections + '/' + totalSections;
    document.getElementById('compliance-pct').style.color = compColor;
    const compLabelEl = document.getElementById('compliance-label');
    if (compLabelEl) compLabelEl.textContent = compPct >= 80 ? 'Strong compliance' : compPct >= 50 ? 'Partial compliance' : 'Low coverage — review needed';

    // Metric Chips
    document.getElementById('metric-type').textContent = data.doc_type_label || data.doc_type || '—';
    document.getElementById('metric-findings').textContent = allFindings.length;
    const tokens = data.token_usage || {};
    const totalTokens = tokens.total_tokens || ((tokens.total_prompt_tokens || 0) + (tokens.total_completion_tokens || 0));
    document.getElementById('metric-tokens').textContent = totalTokens > 0 ? totalTokens.toLocaleString() : '—';
    document.getElementById('metric-pages').textContent = data.pages || '—';

    // Small tags: model & time
    const tagModel = document.getElementById('tag-model');
    const tagTime = document.getElementById('tag-time');
    if (data.demo_mode) {
        tagModel.textContent = '⚠ Demo Mode';
        tagModel.style.color = 'var(--clinical-amber)';
    } else if (tokens.source === 'llm') {
        tagModel.textContent = 'Model: ' + (tokens.model_used || 'unknown') + ' · ' + (tokens.calls || 0) + ' calls';
    } else if (tokens.source === 'cache') {
        tagModel.textContent = 'Cached responses';
    } else {
        tagModel.textContent = '';
    }
    if (analysisStartTime) {
        const elapsed = (performance.now() - analysisStartTime) / 1000;
        tagTime.textContent = elapsed < 60
            ? '⏱ ' + elapsed.toFixed(1) + 's'
            : '⏱ ' + Math.floor(elapsed / 60) + 'm ' + (elapsed % 60).toFixed(0) + 's';
    }

    // Summary
    document.getElementById('result-summary').innerHTML = formatText(data.summary || 'No summary available.');

    // Result filename
    const fnEl = document.getElementById('result-filename');
    if (fnEl) fnEl.textContent = data.filename ? ('\uD83D\uDCC4 ' + data.filename) : '';

    // Entities
    const entitiesEl = document.getElementById('result-entities');
    entitiesEl.innerHTML = '';
    const entities = data.entities || '';
    if (typeof entities === 'string' && entities.trim()) {
        entitiesEl.innerHTML = formatText(entities);
    } else if (typeof entities === 'object' && entities !== null) {
        for (const [key, val] of Object.entries(entities)) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let display;
            if (Array.isArray(val)) {
                display = val.map(item => {
                    const text = typeof item === 'object' ? Object.values(item).join(' — ') : String(item);
                    return `<span class="inline-block px-2.5 py-1 rounded-lg text-xs mr-1.5 mb-1.5" style="background:var(--bg-input);border:1px solid var(--border-input);color:var(--text-secondary);">${escapeHtml(text)}</span>`;
                }).join('');
            } else if (typeof val === 'object' && val !== null) {
                display = Object.entries(val).map(([k, v]) =>
                    `<span class="inline-block px-2.5 py-1 rounded-lg text-xs mr-1.5 mb-1.5" style="background:var(--bg-input);border:1px solid var(--border-input);color:var(--text-secondary);">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`
                ).join('');
            } else {
                display = `<span class="text-sm" style="color:var(--text-secondary);">${escapeHtml(String(val))}</span>`;
            }
            entitiesEl.innerHTML += `
                <div class="p-3 rounded-xl" style="background:var(--bg-card-hover);border:1px solid var(--border-card);">
                    <div class="text-xs font-semibold uppercase tracking-wider mb-2" style="color:var(--text-muted);">${escapeHtml(label)}</div>
                    <div class="flex flex-wrap">${display}</div>
                </div>`;
        }
    } else {
        entitiesEl.innerHTML = '<p style="color:var(--text-muted);">No entities extracted.</p>';
    }

    // Risk Findings — with filters, expandable cards, evidence, section info
    const findingsEl = document.getElementById('result-findings');
    findingsEl.innerHTML = '';
    window._allFindings = allFindings; // store for filtering

    // Filter tabs (right side of header)
    const filterEl = document.getElementById('findings-filter');
    if (filterEl) {
        const tabs = [
            { key: 'all', label: 'All', count: allFindings.length, dot: '' },
            { key: 'high', label: 'High', count: sevCounts.high, dot: 'var(--clinical-red)' },
            { key: 'medium', label: 'Medium', count: sevCounts.medium, dot: 'var(--clinical-amber)' },
            { key: 'low', label: 'Low', count: sevCounts.low, dot: 'var(--clinical-blue)' },
        ];
        filterEl.innerHTML = tabs.map(t =>
            `<button onclick="filterFindings('${t.key}')" data-filter="${t.key}" class="finding-filter-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all" style="color:var(--text-muted);">${t.dot ? `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${t.dot};"></span>` : ''}${t.label} <span class="opacity-60">${t.count}</span></button>`
        ).join('');
        filterEl.style.display = allFindings.length > 0 ? 'inline-flex' : 'none';
        // Activate 'all' by default
        const allBtn = filterEl.querySelector('[data-filter="all"]');
        if (allBtn) { allBtn.style.background = 'var(--bg-card)'; allBtn.style.color = 'var(--text-heading)'; allBtn.style.boxShadow = 'var(--shadow-card)'; }
    }

    renderFindingsCards(allFindings, findingsEl);

    // Findings count badge
    const fcEl = document.getElementById('findings-count');
    if (fcEl) fcEl.textContent = allFindings.length + ' finding' + (allFindings.length !== 1 ? 's' : '');

    // ICH-GCP Completeness
    const compEl = document.getElementById('result-completeness');
    compEl.innerHTML = '';
    if (coverageEntries.length === 0) {
        compEl.innerHTML = '<p style="color:var(--text-muted);" class="col-span-full text-sm text-center py-4">No completeness data.</p>';
    } else {
        let presentCount = 0;
        for (const [sectionId, info] of coverageEntries) {
            const present = info.present;
            if (present) presentCount++;
            const label = info.label || sectionId;
            const colorVar = present ? '--clinical-green' : '--clinical-red';
            const icon = present
                ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
                : '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
            compEl.innerHTML += `
                <div class="p-3 rounded-xl flex items-center gap-2.5" style="background:color-mix(in srgb, var(${colorVar}) 6%, var(--bg-card));border:1px solid color-mix(in srgb, var(${colorVar}) 18%, transparent);">
                    <span style="color:var(${colorVar});">${icon}</span>
                    <span class="text-xs font-medium leading-tight" style="color:var(--text-secondary);">${escapeHtml(label)}</span>
                </div>`;
        }
        // Completeness count badge
        const ccEl = document.getElementById('completeness-count');
        if (ccEl) ccEl.textContent = presentCount + '/' + coverageEntries.length + ' present';
    }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---- Feedback ---- */
function selectRating(rating) {
    feedbackRating = rating;
    const pos = document.getElementById('btn-positive');
    const neg = document.getElementById('btn-negative');
    pos.style.borderColor = rating === 'positive' ? 'color-mix(in srgb, var(--clinical-green) 50%, transparent)' : 'var(--border-card)';
    pos.style.background = rating === 'positive' ? 'color-mix(in srgb, var(--clinical-green) 10%, transparent)' : 'transparent';
    pos.style.color = rating === 'positive' ? getCSSVar('--clinical-green') : getCSSVar('--text-secondary');
    neg.style.borderColor = rating === 'negative' ? 'color-mix(in srgb, var(--clinical-red) 50%, transparent)' : 'var(--border-card)';
    neg.style.background = rating === 'negative' ? 'color-mix(in srgb, var(--clinical-red) 10%, transparent)' : 'transparent';
    neg.style.color = rating === 'negative' ? getCSSVar('--clinical-red') : getCSSVar('--text-secondary');
}

async function submitFeedback() {
    if (!feedbackRating) { showToast('Please select a rating first.', 'error'); return; }
    const user = JSON.parse(localStorage.getItem('clindoc_user') || '{}');
    const comment = document.getElementById('feedback-comment').value.trim();
    try {
        const form = new FormData();
        form.append('filename', selectedFile ? selectedFile.name : 'unknown');
        form.append('rating', feedbackRating);
        form.append('comment', comment);
        form.append('user_name', user.name || user.email || '');
        form.append('user_role', user.role || '');
        if (user.id) form.append('user_id', user.id);
        const res = await fetch('/api/feedback/submit', { method: 'POST', body: form });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Feedback submitted. Thank you!', 'success');
            document.getElementById('feedback-msg').textContent = 'Feedback saved successfully.';
            document.getElementById('feedback-msg').classList.remove('hidden');
        } else {
            showToast(data.detail || 'Failed to submit feedback', 'error');
        }
    } catch (err) { showToast('Connection error', 'error'); }
}

/* ---- Download Report ---- */
async function downloadReport(format) {
    if (!lastResultData) { showToast('Run an analysis first.', 'error'); return; }
    const d = lastResultData;
    const form = new FormData();
    form.append('filename', d.filename || 'unknown');
    form.append('summary', typeof d.summary === 'string' ? d.summary : '');
    form.append('entities', JSON.stringify(d.entities || {}));
    form.append('risk', JSON.stringify(d.risk || {}));
    form.append('rule', JSON.stringify(d.rule || {}));
    form.append('quality', JSON.stringify(d.quality || {}));
    try {
        const res = await fetch(`/api/analysis/download/${format}`, { method: 'POST', body: form });
        if (!res.ok) { showToast('Download failed', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (d.filename || 'report').replace(/\.[^.]+$/, '') + '_report.' + format;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Report downloaded!', 'success');
    } catch (err) { showToast('Download error: ' + err.message, 'error'); }
}

/* ---- Helpers ---- */
function formatText(text) {
    let html = escapeHtml(text);
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-heading);font-weight:600;">$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong style="color:var(--text-heading);font-weight:600;">$1</strong>');
    // Bullet lines: - text or * text at start of line
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<div style="padding-left:1rem;position:relative;margin:2px 0;"><span style="position:absolute;left:0;color:var(--clinical-teal);">\u2022</span>$1</div>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
}

/* ---- Findings rendering & filtering ---- */
function renderFindingsCards(findings, container) {
    container.innerHTML = '';
    if (findings.length === 0) {
        container.innerHTML = '<p class="text-sm py-6 text-center" style="color:var(--text-muted);">No findings match this filter.</p>';
        return;
    }
    findings.forEach((f, idx) => {
        const severity = (f.severity || 'low').toLowerCase();
        const sevVar = severity === 'high' ? '--clinical-red' : severity === 'medium' ? '--clinical-amber' : '--clinical-blue';
        const sevIcon = severity === 'high' ? '\u26A0' : severity === 'medium' ? '\u25B2' : '\u25CF';
        const catLabel = (f.category || '').replace(/_/g, ' ');
        const hasDetails = f.evidence || f.recommendation || f.source_chunk;
        const cardId = 'finding-' + idx;

        container.innerHTML += `
            <div class="finding-card rounded-xl transition-all" style="background:var(--bg-card-hover);border:1px solid var(--border-card);border-left:4px solid var(${sevVar});overflow:hidden;">
                <div class="p-4 cursor-pointer" onclick="toggleFindingDetail('${cardId}')">
                    <div class="flex items-start gap-3">
                        <div class="flex-shrink-0 flex flex-col items-center gap-1 mt-0.5" style="min-width:48px;">
                            <span class="inline-flex items-center justify-center w-full px-2 py-1 text-[10px] font-bold rounded-md uppercase tracking-wide" style="background:color-mix(in srgb, var(${sevVar}) 15%, transparent);color:var(${sevVar});">${sevIcon} ${severity}</span>
                            <span class="text-[9px] font-mono" style="color:var(--text-muted);">#${idx + 1}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-semibold leading-snug" style="color:var(--text-heading);">${escapeHtml(f.title || f.finding || f.message || '')}</p>
                            ${f.description ? `<p class="text-xs mt-1.5 leading-relaxed" style="color:var(--text-secondary);">${escapeHtml(f.description)}</p>` : ''}
                            <div class="flex flex-wrap gap-1.5 mt-2">
                                ${catLabel ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style="background:var(--bg-input);color:var(--text-muted);">${escapeHtml(catLabel)}</span>` : ''}
                                ${f.section_reference ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style="background:var(--bg-input);color:var(--text-muted);">\u00A7 ${escapeHtml(f.section_reference)}</span>` : ''}
                                ${f.source_chunk ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style="background:color-mix(in srgb, var(--clinical-teal) 10%, transparent);color:var(--clinical-teal);">\uD83D\uDCC4 ${escapeHtml(f.source_chunk)}</span>` : ''}
                            </div>
                        </div>
                        ${hasDetails ? `<svg class="w-4 h-4 flex-shrink-0 mt-1 transition-transform finding-chevron" style="color:var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>` : ''}
                    </div>
                </div>
                ${hasDetails ? `
                <div id="${cardId}" class="finding-detail hidden" style="border-top:1px solid var(--border-card);">
                    <div class="p-4 space-y-3" style="background:color-mix(in srgb, var(${sevVar}) 3%, var(--bg-card));">
                        ${f.evidence ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">Evidence from Document</div>
                            <div class="text-xs leading-relaxed p-3 rounded-lg italic" style="background:var(--bg-input);color:var(--text-secondary);border-left:2px solid var(${sevVar});">&ldquo;${escapeHtml(f.evidence)}&rdquo;</div>
                        </div>` : ''}
                        ${f.recommendation ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">Recommendation</div>
                            <div class="text-xs leading-relaxed flex items-start gap-2" style="color:var(--text-secondary);">
                                <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style="color:var(--clinical-green);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                <span>${escapeHtml(f.recommendation)}</span>
                            </div>
                        </div>` : ''}
                        ${f.source_chunk ? `
                        <div class="flex items-center gap-2 text-[10px]" style="color:var(--text-muted);">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                            Source: ${escapeHtml(f.source_chunk)}
                        </div>` : ''}
                    </div>
                </div>` : ''}
            </div>`;
    });
}

function toggleFindingDetail(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest('.finding-card');
    const chevron = card?.querySelector('.finding-chevron');
    el.classList.toggle('hidden');
    if (chevron) chevron.style.transform = el.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

function filterFindings(severity) {
    const all = window._allFindings || [];
    const filtered = severity === 'all' ? all : all.filter(f => (f.severity || 'low').toLowerCase() === severity);
    const container = document.getElementById('result-findings');
    renderFindingsCards(filtered, container);
    // Update active tab
    document.querySelectorAll('.finding-filter-btn').forEach(btn => {
        const isActive = btn.dataset.filter === severity;
        btn.style.background = isActive ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isActive ? 'var(--shadow-card)' : 'none';
    });
}
function escapeHtml(str) { const div = document.createElement('div'); div.appendChild(document.createTextNode(str)); return div.innerHTML; }

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

/* ---- Validation Error Modal ---- */
function showValidationModal(message) {
    document.getElementById('validation-modal-msg').textContent = message;
    document.getElementById('validation-modal').classList.remove('hidden');
}
function closeValidationModal() {
    document.getElementById('validation-modal').classList.add('hidden');
    // Reset file selection so user can pick a new file
    selectedFile = null;
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('file-input').value = '';
}

window.addEventListener('themechange', () => { if (lastResultData) renderResults(lastResultData); });

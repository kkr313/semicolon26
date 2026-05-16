// ClinDoc AI — Analyzer Page Logic

let selectedFile = null;
let analysisResult = null;
let feedbackRating = null;
let analysisStartTime = null;
let chartQuality = null;
let chartSeverity = null;
let chartCompliance = null;
let lastResultData = null;
let lastCrossDocData = null;
let xdocChartQuality = null;
let xdocChartSeverity = null;
let xdocChartCoverage = null;
let xdocChartConsistency = null;
let xdocChartPairPie = null;

document.addEventListener('DOMContentLoaded', () => {
    const user = JSON.parse(localStorage.getItem('clindoc_user') || 'null');
    if (!user) { window.location.href = '/'; return; }
    document.getElementById('user-name').textContent = user.name || user.email;
    setupDropZone();
    setupModeToggle();
    checkLLMStatus();
    loadModels();
});

/* ---- Mode Toggle ---- */
let _gatewayOnline = null; // cached gateway status

function setupModeToggle() {
    const toggle = document.getElementById('demo-toggle');
    const track = document.getElementById('toggle-track');
    updateModeUI(toggle.checked);
    toggle.addEventListener('change', () => {
        updateModeUI(toggle.checked);
        updateLLMStatusDisplay(toggle.checked);
    });
}

function updateModeUI(isDemo) {
    const label = document.getElementById('mode-label');
    const desc = document.getElementById('mode-desc');
    const track = document.getElementById('toggle-track');
    const knob = document.getElementById('toggle-knob');
    if (isDemo) {
        label.textContent = 'DEMO MODE';
        label.style.color = 'var(--clinical-amber)';
        desc.textContent = 'Using pre-built sample data';
        track.style.background = 'var(--clinical-amber)';
        knob.style.transform = 'translateX(20px)';
    } else {
        label.textContent = 'LIVE MODE';
        label.style.color = 'var(--clinical-green)';
        desc.textContent = 'Using LLM Gateway';
        track.style.background = 'var(--clinical-green)';
        knob.style.transform = 'translateX(0)';
    }
}

/** Update LLM status dot/text based on demo toggle + gateway status */
function updateLLMStatusDisplay(isDemo) {
    const dot = document.getElementById('llm-status-dot');
    const text = document.getElementById('llm-status-text');
    if (isDemo) {
        dot.style.background = getCSSVar('--clinical-amber');
        text.textContent = 'Demo Mode — LLM Not Needed';
        text.style.color = getCSSVar('--clinical-amber');
    } else if (_gatewayOnline === true) {
        dot.style.background = getCSSVar('--clinical-green');
        text.textContent = 'LLM Gateway Online';
        text.style.color = getCSSVar('--clinical-green');
    } else if (_gatewayOnline === false) {
        dot.style.background = getCSSVar('--clinical-red');
        text.textContent = 'LLM Gateway Offline';
        text.style.color = getCSSVar('--clinical-red');
    } else {
        dot.style.background = getCSSVar('--clinical-amber');
        text.textContent = 'Checking...';
        text.style.color = getCSSVar('--clinical-amber');
    }
}

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
            updateModeUI(data.demo_mode);
        }
        // Cache gateway state and update display
        _gatewayOnline = !!data.online;
        const isDemo = demoToggle ? demoToggle.checked : false;
        updateLLMStatusDisplay(isDemo);
    } catch {
        _gatewayOnline = null;
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
                if (m === 'gpt-4.1') opt.selected = true;
                select.appendChild(opt);
            }
        }
    } catch {
        select.innerHTML = '<option value="gpt-4.1">gpt-4.1</option>';
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
    { pct: [15, 35], label: 'NLP Extraction',  messages: ['Sending chunks to LLM for summarization...', 'Extracting clinical entities (drugs, endpoints, AEs)...', 'Waiting for LLM response...', 'Processing entity extraction results...'] },
    { pct: [35, 50], label: '\uD83D\uDEE1\uFE0F Safety Agent',  messages: ['Safety Agent analyzing AE/SAE reporting...', 'Checking stopping rules & DSMB oversight...', 'Reviewing rescue medication criteria...', 'Evaluating safety monitoring plan...'] },
    { pct: [50, 65], label: '\uD83D\uDCCA Statistics Agent', messages: ['Statistics Agent reviewing sample size...', 'Checking endpoint definitions & multiplicity...', 'Evaluating missing data strategy...', 'Assessing randomization & analysis plan...'] },
    { pct: [65, 80], label: '\uD83D\uDCCB Regulatory Agent', messages: ['Regulatory Agent checking ICH M11 structure...', 'Verifying ICH-GCP 4.8 consent compliance...', 'Reviewing ICH E3 CSR sections...', 'Assessing data integrity provisions...'] },
    { pct: [80, 90], label: 'Rule Checks',     messages: ['Running rule-based section coverage scan...', 'Checking abbreviations & ambiguous language...', 'Computing completeness score...'] },
    { pct: [90, 95], label: 'Report',          messages: ['Merging multi-agent findings...', 'Detecting cross-agent agreement...', 'Calculating quality score & grade...', 'Compiling final report...'] }
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
            addLogLine(step.messages[0], ['parse', 'parse', 'nlp', 'risk', 'nlp', 'risk', 'nlp', 'done'][currentStep]);
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
            addLogLine(step.messages[msgIdx], ['parse', 'parse', 'nlp', 'risk', 'nlp', 'risk', 'nlp', 'done'][currentStep]);
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
    if (xdocChartQuality) { xdocChartQuality.destroy(); xdocChartQuality = null; }
    if (xdocChartSeverity) { xdocChartSeverity.destroy(); xdocChartSeverity = null; }
    if (xdocChartCoverage) { xdocChartCoverage.destroy(); xdocChartCoverage = null; }
    if (xdocChartConsistency) { xdocChartConsistency.destroy(); xdocChartConsistency = null; }
    if (xdocChartPairPie) { xdocChartPairPie.destroy(); xdocChartPairPie = null; }
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

    // Agent Panel — show 3 agent cards if agent_results present
    const agentPanel = document.getElementById('agent-panel');
    const agentCards = document.getElementById('agent-cards');
    const agentResults = data.risk?.agent_results || {};
    const hasAgents = Object.keys(agentResults).length > 0;

    if (hasAgents && agentPanel && agentCards) {
        agentPanel.classList.remove('hidden');
        const agentIcons = {
            shield: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
            chart: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>',
            clipboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
        };
        const agentColors = { red: '--clinical-red', blue: '--clinical-blue', green: '--clinical-green' };
        agentCards.innerHTML = '';
        for (const [name, info] of Object.entries(agentResults)) {
            const def = { shield: 'red', chart: 'blue', clipboard: 'green' };
            const colorKey = name === 'safety' ? 'red' : name === 'statistics' ? 'blue' : 'green';
            const colorVar = agentColors[colorKey] || '--clinical-teal';
            const iconKey = name === 'safety' ? 'shield' : name === 'statistics' ? 'chart' : 'clipboard';
            const confPct = Math.round((info.confidence || 0) * 100);
            agentCards.innerHTML += `
                <div class="rounded-xl p-4 transition-all hover:shadow-md cursor-pointer" style="background:color-mix(in srgb, var(${colorVar}) 5%, var(--bg-card));border:1px solid color-mix(in srgb, var(${colorVar}) 20%, transparent);" onclick="filterByAgent('${name}')">
                    <div class="flex items-center gap-2.5 mb-2.5">
                        <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:color-mix(in srgb, var(${colorVar}) 12%, transparent);color:var(${colorVar});">
                            ${agentIcons[iconKey] || ''}
                        </div>
                        <div>
                            <div class="text-sm font-bold" style="color:var(--text-heading);">${escapeHtml(info.label || name)}</div>
                            <div class="text-[10px]" style="color:var(--text-muted);">${escapeHtml(info.role || '')}</div>
                        </div>
                    </div>
                    <div class="flex items-center justify-between mt-2">
                        <span class="text-xs font-semibold" style="color:var(${colorVar});">${info.finding_count || 0} findings</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:color-mix(in srgb, var(${colorVar}) 12%, transparent);color:var(${colorVar});">${confPct}% confidence</span>
                    </div>
                </div>`;
        }

        // Agent filter tabs
        const agentFilter = document.getElementById('agent-filter');
        if (agentFilter) {
            agentFilter.style.display = 'inline-flex';
            const agentTabs = [{ key: 'all-agents', label: 'All Agents', dot: '' }];
            for (const [name, info] of Object.entries(agentResults)) {
                const colorKey = name === 'safety' ? 'red' : name === 'statistics' ? 'blue' : 'green';
                agentTabs.push({ key: name, label: info.label.replace(' Agent', ''), dot: `var(${agentColors[colorKey]})` });
            }
            agentFilter.innerHTML = agentTabs.map(t =>
                `<button onclick="filterByAgent('${t.key}')" data-agent-filter="${t.key}" class="agent-filter-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-semibold transition-all" style="color:var(--text-muted);">${t.dot ? `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${t.dot};"></span>` : ''}${t.label}</button>`
            ).join('');
            const allBtn = agentFilter.querySelector('[data-agent-filter="all-agents"]');
            if (allBtn) { allBtn.style.background = 'var(--bg-card)'; allBtn.style.color = 'var(--text-heading)'; allBtn.style.boxShadow = 'var(--shadow-card)'; }
        }
    } else if (agentPanel) {
        agentPanel.classList.add('hidden');
    }

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

    // Trust score badge (hallucination check summary)
    const trustEl = document.getElementById('trust-score');
    const verification = data.risk?.verification || {};
    if (trustEl && verification.total > 0) {
        const ts = verification.trust_score || 0;
        const tsColor = ts >= 70 ? 'var(--clinical-green)' : ts >= 40 ? 'var(--clinical-amber)' : 'var(--clinical-red)';
        const tsBg = ts >= 70 ? 'rgba(5,150,105,0.12)' : ts >= 40 ? 'rgba(217,119,6,0.12)' : 'rgba(239,68,68,0.12)';
        trustEl.style.display = 'inline-flex';
        trustEl.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg> Trust: ${ts}%`;
        trustEl.style.color = tsColor;
        trustEl.style.background = tsBg;
        trustEl.title = `${verification.verified || 0} verified, ${verification.partial || 0} partial, ${verification.unverified || 0} unverified`;
    } else if (trustEl) {
        trustEl.style.display = 'none';
    }

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

    // Cross-Document Comparison Panel

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---- Feedback ---- */
function _isXdocVisible() {
    const el = document.getElementById('cross-doc-results');
    return el && !el.classList.contains('hidden');
}

function selectRating(rating) {
    feedbackRating = rating;
    const isXdoc = _isXdocVisible();
    const pos = document.getElementById(isXdoc ? 'xdoc-btn-positive' : 'btn-positive');
    const neg = document.getElementById(isXdoc ? 'xdoc-btn-negative' : 'btn-negative');
    if (!pos || !neg) return;
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
    const isXdoc = _isXdocVisible();
    const commentEl = document.getElementById(isXdoc ? 'xdoc-feedback-comment' : 'feedback-comment');
    const comment = commentEl ? commentEl.value.trim() : '';

    // Build filename: single-doc uses selectedFile, multi-doc uses multiFiles array
    let filename = 'unknown';
    if (isXdoc && multiFiles.length > 0) {
        filename = multiFiles.map(f => f.name).join(', ');
    } else if (selectedFile) {
        filename = selectedFile.name;
    }

    try {
        const form = new FormData();
        form.append('filename', filename);
        form.append('rating', feedbackRating);
        form.append('comment', comment);
        form.append('user_name', user.name || user.email || '');
        form.append('user_role', user.role || '');
        if (user.id) form.append('user_id', user.id);
        const res = await fetch('/api/feedback/submit', { method: 'POST', body: form });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Feedback submitted. Thank you!', 'success');
            const msgEl = document.getElementById(isXdoc ? 'xdoc-feedback-msg' : 'feedback-msg');
            if (msgEl) { msgEl.textContent = 'Feedback saved successfully.'; msgEl.classList.remove('hidden'); }
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
    const agentIcons = {
        shield: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
        chart: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>',
        clipboard: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
    };
    const agentColorVars = { red: '--clinical-red', blue: '--clinical-blue', green: '--clinical-green' };

    findings.forEach((f, idx) => {
        const severity = (f.severity || 'low').toLowerCase();
        const sevVar = severity === 'high' ? '--clinical-red' : severity === 'medium' ? '--clinical-amber' : '--clinical-blue';
        const sevIcon = severity === 'high' ? '\u26A0' : severity === 'medium' ? '\u25B2' : '\u25CF';
        const catLabel = (f.category || '').replace(/_/g, ' ');
        const hasDetails = f.evidence || f.recommendation || f.source_chunk;
        const cardId = 'finding-' + idx;

        // Agent badge
        const agentIcon = f.agent_icon ? (agentIcons[f.agent_icon] || '') : '';
        const agentColor = f.agent_color ? (agentColorVars[f.agent_color] || '--clinical-teal') : '--clinical-teal';
        const agentBadge = f.agent_label
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold" style="background:color-mix(in srgb, var(${agentColor}) 12%, transparent);color:var(${agentColor});">${agentIcon} ${escapeHtml(f.agent_label)}</span>`
            : '';

        // Agreement indicator
        const agreeCount = f.agreement_count || (f.agents_agree ? f.agents_agree.length : 0);
        const agreeBadge = agreeCount > 1
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold" style="background:rgba(99,102,241,0.1);color:#6366f1;" title="${agreeCount} agents flagged this issue"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>${agreeCount}/3 agree</span>`
            : '';

        // Verification badge (hallucination check)
        const vStatus = f.verified || '';
        const vBadgeMap = {
            verified: { icon: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>', label: 'Verified', bg: 'rgba(5,150,105,0.1)', color: 'var(--clinical-green)' },
            partial: { icon: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z"/></svg>', label: 'Partial', bg: 'rgba(217,119,6,0.1)', color: 'var(--clinical-amber)' },
            unverified: { icon: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>', label: 'Unverified', bg: 'rgba(239,68,68,0.1)', color: 'var(--clinical-red)' },
        };
        const vBadge = vBadgeMap[vStatus]
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold" style="background:${vBadgeMap[vStatus].bg};color:${vBadgeMap[vStatus].color};" title="${f.verification_note || ''}">${vBadgeMap[vStatus].icon} ${vBadgeMap[vStatus].label}</span>`
            : '';

        container.innerHTML += `
            <div class="finding-card rounded-xl transition-all" data-agent="${f.agent || ''}" style="background:var(--bg-card-hover);border:1px solid var(--border-card);border-left:4px solid var(${sevVar});overflow:hidden;">
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
                                ${agentBadge}
                                ${agreeBadge}
                                ${vBadge}
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
                        ${f.fix_suggestion ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5" style="color:var(--clinical-teal);">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                AI Fix Suggestion
                                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold" style="background:rgba(20,184,166,0.1);color:var(--clinical-teal);">${f.fix_suggestion.confidence || 'medium'}</span>
                            </div>
                            <div class="text-xs leading-relaxed p-3 rounded-lg whitespace-pre-line" style="background:rgba(20,184,166,0.05);border:1px solid rgba(20,184,166,0.15);color:var(--text-secondary);">${escapeHtml(f.fix_suggestion.text)}</div>
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
    // Reset agent filter to "all"
    document.querySelectorAll('.agent-filter-btn').forEach(btn => {
        const isAll = btn.dataset.agentFilter === 'all-agents';
        btn.style.background = isAll ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isAll ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isAll ? 'var(--shadow-card)' : 'none';
    });
}

function filterByAgent(agent) {
    const all = window._allFindings || [];
    const filtered = agent === 'all-agents' ? all : all.filter(f => f.agent === agent);
    const container = document.getElementById('result-findings');
    renderFindingsCards(filtered, container);
    // Update agent filter tabs
    document.querySelectorAll('.agent-filter-btn').forEach(btn => {
        const isActive = btn.dataset.agentFilter === agent;
        btn.style.background = isActive ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isActive ? 'var(--shadow-card)' : 'none';
    });
    // Reset severity filter to "all"
    document.querySelectorAll('.finding-filter-btn').forEach(btn => {
        const isAll = btn.dataset.filter === 'all';
        btn.style.background = isAll ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isAll ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isAll ? 'var(--shadow-card)' : 'none';
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


// ═══════════════════════════════════════════════════════════════════════════
// MULTI-DOCUMENT CROSS-COMPARISON
// ═══════════════════════════════════════════════════════════════════════════

let multiFiles = [];

/* ---- Tab Switching ---- */
function switchAnalysisTab(tab) {
    const singleZone = document.getElementById('single-doc-zone');
    const multiZone = document.getElementById('multi-doc-zone');
    const tabSingle = document.getElementById('tab-single');
    const tabMulti = document.getElementById('tab-multi');

    if (tab === 'multi') {
        singleZone.classList.add('hidden');
        multiZone.classList.remove('hidden');
        tabMulti.style.background = 'var(--bg-accent-soft)';
        tabMulti.style.color = 'var(--text-heading)';
        tabSingle.style.background = 'transparent';
        tabSingle.style.color = 'var(--text-muted)';
    } else {
        multiZone.classList.add('hidden');
        singleZone.classList.remove('hidden');
        tabSingle.style.background = 'var(--bg-accent-soft)';
        tabSingle.style.color = 'var(--text-heading)';
        tabMulti.style.background = 'transparent';
        tabMulti.style.color = 'var(--text-muted)';
    }
}

/* ---- Multi-file Drop Zone ---- */
document.addEventListener('DOMContentLoaded', () => {
    const mDropZone = document.getElementById('multi-drop-zone');
    const mInput = document.getElementById('multi-file-input');
    if (!mDropZone || !mInput) return;

    mDropZone.addEventListener('click', () => mInput.click());
    mDropZone.addEventListener('dragover', (e) => { e.preventDefault(); mDropZone.classList.add('drop-zone-active'); });
    mDropZone.addEventListener('dragleave', () => mDropZone.classList.remove('drop-zone-active'));
    mDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        mDropZone.classList.remove('drop-zone-active');
        addMultiFiles(Array.from(e.dataTransfer.files));
    });
    mInput.addEventListener('change', () => {
        addMultiFiles(Array.from(mInput.files));
        mInput.value = '';
    });
});

function addMultiFiles(files) {
    const allowed = ['.pdf', '.docx', '.txt'];
    for (const f of files) {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        if (!allowed.includes(ext)) {
            showToast('Unsupported file: ' + f.name, 'error');
            continue;
        }
        if (f.size === 0) {
            showToast('Empty file: ' + f.name, 'error');
            continue;
        }
        if (multiFiles.length >= 3) {
            showToast('Maximum 3 documents (Protocol, CSR, Consent Form)', 'error');
            break;
        }
        if (multiFiles.some(mf => mf.name === f.name && mf.size === f.size)) continue;
        multiFiles.push(f);
    }
    renderMultiFileList();
}

function removeMultiFile(index) {
    multiFiles.splice(index, 1);
    renderMultiFileList();
}

function clearMultiFiles() {
    multiFiles = [];
    renderMultiFileList();
}

function renderMultiFileList() {
    const listEl = document.getElementById('multi-file-list');
    const actionEl = document.getElementById('multi-action');
    const countEl = document.getElementById('multi-file-count');

    if (multiFiles.length === 0) {
        listEl.classList.add('hidden');
        actionEl.classList.add('hidden');
        return;
    }

    listEl.classList.remove('hidden');
    actionEl.classList.remove('hidden');
    countEl.textContent = multiFiles.length + ' document' + (multiFiles.length > 1 ? 's' : '') + ' selected';

    const typeIcons = { '.pdf': '📕', '.docx': '📘', '.txt': '📝' };
    listEl.innerHTML = multiFiles.map((f, i) => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        return `<div class="flex items-center justify-between p-3 rounded-xl border" style="background:var(--bg-card-hover);border-color:var(--border-card);">
            <div class="flex items-center gap-3">
                <span class="text-lg">${typeIcons[ext] || '📄'}</span>
                <div>
                    <div class="text-xs font-semibold" style="color:var(--text-heading);">${escapeHtml(f.name)}</div>
                    <div class="text-[10px]" style="color:var(--text-muted);">${formatSize(f.size)}</div>
                </div>
            </div>
            <button onclick="removeMultiFile(${i})" class="text-xs px-2 py-1 rounded-lg transition hover:opacity-70" style="color:var(--clinical-red);">✕</button>
        </div>`;
    }).join('');
}

/* ---- Run Cross-Document Comparison ---- */
async function runMultiDocCompare() {
    // ── Validation: exactly 3 files ──────────────────────────────────────
    if (multiFiles.length === 0) {
        showValidationModal('No documents uploaded. Please upload exactly 3 documents: Protocol, CSR, and Consent Form.');
        return;
    }
    if (multiFiles.length < 3) {
        const missing = 3 - multiFiles.length;
        showValidationModal('You uploaded ' + multiFiles.length + ' document' + (multiFiles.length > 1 ? 's' : '') + ', but 3 are required.\n\nPlease upload all 3: Protocol, CSR, and Consent Form (' + missing + ' more needed).');
        return;
    }
    if (multiFiles.length > 3) {
        showValidationModal('You uploaded ' + multiFiles.length + ' documents, but exactly 3 are required.\n\nPlease upload one Protocol, one CSR, and one Consent Form.');
        return;
    }

    // ── Validation: no empty or very short files ─────────────────────────
    for (const f of multiFiles) {
        if (f.size === 0) {
            showValidationModal('"' + f.name + '" is empty (0 bytes). Please replace it with a valid document.');
            return;
        }
        if (f.size < 500) {
            showValidationModal('"' + f.name + '" is too short (' + formatSize(f.size) + '). Clinical documents should contain substantial content. Please replace it.');
            return;
        }
    }

    // ── Validation: no exact duplicate files ──────────────────────────────
    for (let i = 0; i < multiFiles.length; i++) {
        for (let j = i + 1; j < multiFiles.length; j++) {
            if (multiFiles[i].name === multiFiles[j].name) {
                showValidationModal('Duplicate file detected: "' + multiFiles[i].name + '" appears more than once. Each document must be unique.');
                return;
            }
        }
    }

    const demoMode = document.getElementById('demo-toggle').checked;
    const model = document.getElementById('model-select').value;
    const user = JSON.parse(localStorage.getItem('clindoc_user') || '{}');

    // Show progress overlay
    const progressSection = document.getElementById('progress-section');
    const uploadSection = document.getElementById('upload-section');
    const resultsSection = document.getElementById('results-section');
    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');

    analysisAbortController = new AbortController();
    analysisStartTime = performance.now();

    // Timeout: auto-abort after 3 minutes to avoid infinite hang
    const compareTimeout = setTimeout(() => {
        if (analysisAbortController) analysisAbortController.abort();
    }, 180000);

    startPipelineAnimation(demoMode);

    try {
        const form = new FormData();
        for (const f of multiFiles) form.append('files', f);
        form.append('demo_mode', demoMode ? 'true' : 'false');
        form.append('model', model);
        if (user.id) form.append('user_id', user.id);

        const res = await fetch('/api/analysis/compare', {
            method: 'POST',
            body: form,
            signal: analysisAbortController.signal,
        });

        clearTimeout(compareTimeout);

        let data;
        try { data = await res.json(); } catch { data = { detail: 'Server error' }; }

        stopPipelineAnimation(res.ok && data.success);

        if (res.ok && data.success) {
            setTimeout(() => {
                progressSection.classList.add('hidden');
                uploadSection.classList.add('hidden');
                renderCrossDocResults(data);
            }, 800);
        } else if (res.status === 422 || res.status === 400) {
            // Validation error — show prominent modal
            progressSection.classList.add('hidden');
            showValidationModal(data.detail || 'Document validation failed.');
        } else {
            progressSection.classList.add('hidden');
            showToast(data.detail || 'Comparison failed', 'error');
        }
    } catch (err) {
        clearTimeout(compareTimeout);
        stopPipelineAnimation(false);
        progressSection.classList.add('hidden');
        if (err.name === 'AbortError') {
            showToast('Comparison timed out or was cancelled.', 'info');
        } else {
            showToast('Comparison failed: ' + err.message, 'error');
        }
    }
}

function backToUpload() {
    document.getElementById('cross-doc-results').classList.add('hidden');
    document.getElementById('upload-section').classList.remove('hidden');
}

/* ---- Render Cross-Document Comparison Results ---- */
function renderCrossDocResults(data) {
    lastCrossDocData = data;
    destroyCharts();
    const section = document.getElementById('cross-doc-results');
    section.classList.remove('hidden');

    const risk = data.risk_score || {};
    const score = risk.score ?? 0;
    const grade = risk.grade || '—';
    const label = risk.label || '';
    const ic = data.issue_counts || {};
    const docs = data.documents || [];
    const pairwise = data.pairwise_comparisons || [];

    // ── Aggregate all field comparisons for unified table ─────────────────
    const allComps = [];
    pairwise.forEach(pair => {
        (pair.field_comparisons || []).forEach(c => {
            allComps.push({ ...c, pair_label: `${pair.doc_a_type || pair.doc_a || ''} vs ${pair.doc_b_type || pair.doc_b || ''}`, doc_a_type: pair.doc_a_type || 'Doc A', doc_b_type: pair.doc_b_type || 'Doc B' });
        });
    });

    // Build unified field rows: for each field, gather worst status across pairs
    const fieldMap = {};
    allComps.forEach(c => {
        const f = c.field || '';
        if (!fieldMap[f]) fieldMap[f] = { field: f, entries: [], worstStatus: 'match', worstSeverity: 'LOW' };
        fieldMap[f].entries.push(c);
        const statusRank = { match: 0, minor_diff: 1, mismatch: 2, missing: 3 };
        const sevRank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
        if ((statusRank[c.status] || 0) > (statusRank[fieldMap[f].worstStatus] || 0)) fieldMap[f].worstStatus = c.status;
        if ((sevRank[(c.severity || 'LOW').toUpperCase()] || 0) > (sevRank[fieldMap[f].worstSeverity] || 0)) fieldMap[f].worstSeverity = (c.severity || 'LOW').toUpperCase();
    });
    const unifiedFields = Object.values(fieldMap);
    window._allUnifiedFields = unifiedFields;

    // Count totals
    const totalComps = allComps.length;
    const matchCount = allComps.filter(c => c.status === 'match').length;
    const mismatchCount = allComps.filter(c => c.status === 'mismatch' || c.status === 'missing').length;
    const minorCount = allComps.filter(c => c.status === 'minor_diff').length;

    // ── Row 1: Dashboard charts (matches single-doc) ─────────────────────

    // Consistency Score — donut gauge (like single-doc quality)
    const scoreColor = getScoreColor(score);
    xdocChartQuality = createDonutChart('xdoc-chart-quality', score, 100, scoreColor);
    document.getElementById('xdoc-score-num').textContent = score + '%';
    document.getElementById('xdoc-score-num').style.color = scoreColor;
    const gradeEl = document.getElementById('xdoc-score-grade');
    gradeEl.textContent = 'Grade ' + grade;
    gradeEl.style.background = scoreColor + '18';
    gradeEl.style.color = scoreColor;
    document.getElementById('xdoc-score-label').textContent =
        score >= 80 ? 'Highly consistent' : score >= 60 ? 'Mostly consistent' : score >= 40 ? 'Notable differences' : 'Critical inconsistencies';

    // Severity Distribution — bar chart (like single-doc)
    const sevCounts = { high: ic.HIGH || 0, medium: ic.MEDIUM || 0, low: ic.LOW || 0 };
    const sevCtx = document.getElementById('xdoc-chart-severity').getContext('2d');
    xdocChartSeverity = new Chart(sevCtx, {
        type: 'bar',
        data: { labels: ['High', 'Medium', 'Low'], datasets: [{ data: [sevCounts.high, sevCounts.medium, sevCounts.low], backgroundColor: [getCSSVar('--clinical-red'), getCSSVar('--clinical-amber'), getCSSVar('--clinical-blue')], borderRadius: 8, borderSkipped: false, barThickness: 36 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartTooltipConfig() }, scales: { x: chartAxisConfig(false), y: { ...chartAxisConfig(true), beginAtZero: true, ticks: { ...chartAxisConfig(true).ticks, stepSize: 1 } } }, animation: { duration: 1000 } }
    });
    document.getElementById('xdoc-severity-legend').innerHTML = `
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-red);"></span>High: ${sevCounts.high}</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-amber);"></span>Medium: ${sevCounts.medium}</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-blue);"></span>Low: ${sevCounts.low}</span>`;

    // Coverage ring — donut showing matched vs total field comparisons
    const coveragePct = totalComps > 0 ? Math.round((matchCount / totalComps) * 100) : 0;
    const coverageColor = coveragePct >= 70 ? getCSSVar('--clinical-green') : coveragePct >= 40 ? getCSSVar('--clinical-amber') : getCSSVar('--clinical-red');
    xdocChartCoverage = createDonutChart('xdoc-chart-coverage', matchCount, totalComps || 1, coverageColor);
    document.getElementById('xdoc-doc-count').textContent = matchCount + '/' + totalComps;
    document.getElementById('xdoc-doc-count').style.color = coverageColor;
    document.getElementById('xdoc-coverage-label').textContent =
        coveragePct >= 70 ? 'Strong field alignment' : coveragePct >= 40 ? 'Partial alignment' : 'Low alignment — review needed';

    // ── Row 2: Key Metrics chips (5 chips now) ───────────────────────────
    document.getElementById('xdoc-metric-docs').textContent = data.document_count || docs.length || '—';
    document.getElementById('xdoc-metric-issues').textContent = data.total_issues || 0;
    document.getElementById('xdoc-metric-pairs').textContent = pairwise.length;
    document.getElementById('xdoc-metric-fields').textContent = totalComps;
    document.getElementById('xdoc-metric-matches').textContent = matchCount;

    // Token usage & model tags
    const xdocTokens = data.token_usage || {};
    const xdocTotalTokens = xdocTokens.total_tokens || ((xdocTokens.total_prompt_tokens || 0) + (xdocTokens.total_completion_tokens || 0));
    document.getElementById('xdoc-metric-tokens').textContent = xdocTotalTokens > 0 ? xdocTotalTokens.toLocaleString() : '—';

    const tagModel = document.getElementById('xdoc-tag-model');
    const tagTime = document.getElementById('xdoc-tag-time');
    if (data.demo_mode) {
        tagModel.textContent = '\u26A0 Demo Mode';
        tagModel.style.color = 'var(--clinical-amber)';
    } else if (xdocTokens.source === 'llm') {
        tagModel.textContent = 'Model: ' + (xdocTokens.model_used || 'unknown') + ' \u00b7 ' + (xdocTokens.calls || 0) + ' calls';
    } else if (xdocTokens.source === 'cache') {
        tagModel.textContent = 'Cached responses';
    } else {
        tagModel.textContent = '';
    }
    if (analysisStartTime) {
        const elapsed = (performance.now() - analysisStartTime) / 1000;
        tagTime.textContent = elapsed < 60
            ? '\u23F1 ' + elapsed.toFixed(1) + 's'
            : '\u23F1 ' + Math.floor(elapsed / 60) + 'm ' + (elapsed % 60).toFixed(0) + 's';
    }

    // ── Row 2c: Visual Charts ────────────────────────────────────────────

    // Consistency Breakdown — horizontal stacked bar
    const consCtx = document.getElementById('xdoc-chart-consistency').getContext('2d');
    xdocChartConsistency = new Chart(consCtx, {
        type: 'bar',
        data: {
            labels: ['Fields'],
            datasets: [
                { label: 'Match', data: [matchCount], backgroundColor: getCSSVar('--clinical-green'), borderRadius: 4, barThickness: 40 },
                { label: 'Minor Diff', data: [minorCount], backgroundColor: getCSSVar('--clinical-amber'), borderRadius: 4, barThickness: 40 },
                { label: 'Mismatch/Missing', data: [mismatchCount], backgroundColor: getCSSVar('--clinical-red'), borderRadius: 4, barThickness: 40 },
            ]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: chartTooltipConfig() },
            scales: { x: { ...chartAxisConfig(true), stacked: true, beginAtZero: true }, y: { ...chartAxisConfig(false), stacked: true, display: false } },
            animation: { duration: 1000 }
        }
    });
    const matchPct = totalComps > 0 ? Math.round((matchCount / totalComps) * 100) : 0;
    const minorPct = totalComps > 0 ? Math.round((minorCount / totalComps) * 100) : 0;
    const mismatchPct = totalComps > 0 ? Math.round((mismatchCount / totalComps) * 100) : 0;
    document.getElementById('xdoc-consistency-legend').innerHTML = `
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-green);"></span>Match: ${matchCount} (${matchPct}%)</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-amber);"></span>Minor: ${minorCount} (${minorPct}%)</span>
        <span class="flex items-center gap-1.5 text-xs" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full" style="background:var(--clinical-red);"></span>Mismatch: ${mismatchCount} (${mismatchPct}%)</span>`;

    // Pairwise Similarity — pie chart
    const pairLabels = [];
    const pairMatchPcts = [];
    const pairColors = [getCSSVar('--clinical-teal'), getCSSVar('--clinical-blue'), '#6366f1', getCSSVar('--clinical-green'), getCSSVar('--clinical-amber')];
    pairwise.forEach((pair, pi) => {
        const comps = pair.field_comparisons || [];
        const pMatches = comps.filter(c => c.status === 'match').length;
        const pTotal = comps.length || 1;
        const pPct = Math.round((pMatches / pTotal) * 100);
        const shortLabel = (pair.doc_a_type || '').replace('Clinical ', '').substring(0, 8) + ' vs ' + (pair.doc_b_type || '').replace('Clinical ', '').substring(0, 8);
        pairLabels.push(shortLabel);
        pairMatchPcts.push(pPct);
    });
    const pieCtx = document.getElementById('xdoc-chart-pair-pie').getContext('2d');
    xdocChartPairPie = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: pairLabels,
            datasets: [{ data: pairMatchPcts, backgroundColor: pairColors.slice(0, pairLabels.length), borderWidth: 0, borderRadius: 4, spacing: 3 }]
        },
        options: {
            cutout: '55%', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { ...chartTooltipConfig(), callbacks: { label: (ctx) => ctx.label + ': ' + ctx.parsed + '% match' } } },
            animation: { animateRotate: true, duration: 1200 }
        }
    });
    document.getElementById('xdoc-pair-legend').innerHTML = pairLabels.map((lbl, i) =>
        `<span class="flex items-center gap-1.5 text-[11px]" style="color:var(--text-secondary);"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${pairColors[i] || '#888'};"></span>${escapeHtml(lbl)}: ${pairMatchPcts[i]}%</span>`
    ).join('');

    // ── Row 3: Per-document summary cards ────────────────────────────────
    document.getElementById('xdoc-doc-badge').textContent = docs.length + ' docs';
    window._crossDocDocs = docs;
    document.getElementById('xdoc-summaries-grid').innerHTML = docs.map((d, idx) => {
        const qScore = d.quality_score || 0;
        const qColorVar = qScore >= 80 ? '--clinical-green' : qScore >= 60 ? '--clinical-blue' : qScore >= 40 ? '--clinical-amber' : '--clinical-red';
        const fc = d.finding_counts || {};
        const typeIcon = (d.doc_type || '').toLowerCase().includes('protocol') ? '📄' : (d.doc_type || '').toLowerCase().includes('report') ? '📊' : '📋';
        return `<div class="rounded-xl border p-5 transition-all hover:shadow-md cursor-pointer" style="background:var(--bg-input);border-color:var(--border-input);" onclick="openDocDetailModal(${idx})" title="Click to view details">
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                    <span class="text-lg">${typeIcon}</span>
                    <div class="text-xs font-bold truncate" style="color:var(--text-heading);max-width:140px;" title="${escapeHtml(d.filename || '')}">${escapeHtml(d.filename || '')}</div>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold" style="background:color-mix(in srgb, #6366f1 10%, var(--bg-card));color:#6366f1;">${escapeHtml(d.doc_type || '')}</span>
            </div>
            <div class="flex items-center gap-3 mb-3">
                <div class="text-2xl font-black" style="color:var(${qColorVar});">${qScore}<span class="text-xs font-normal">/100</span></div>
                <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:color-mix(in srgb, var(${qColorVar}) 10%, var(--bg-card));color:var(${qColorVar});">${d.quality_grade || '\u2014'}</span>
            </div>
            <div class="flex gap-2 mb-3">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:rgba(239,68,68,0.1);color:var(--clinical-red);">${fc.high || 0} HIGH</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:rgba(217,119,6,0.1);color:var(--clinical-amber);">${fc.medium || 0} MED</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:rgba(2,132,199,0.1);color:var(--clinical-blue);">${fc.low || 0} LOW</span>
            </div>
            <div class="text-[11px] leading-relaxed" style="color:var(--text-muted);">${escapeHtml((d.summary || '').substring(0, 200))}${(d.summary || '').length > 200 ? '...' : ''}</div>
        </div>`;
    }).join('');

    // ── Row 4: Unified Cross-Document Comparison Table ───────────────────
    renderUnifiedComparisonTable(unifiedFields, docs, 'all');

    // ── Row 5: Pairwise comparison detail (collapsible) ──────────────────
    const pairBadge = document.getElementById('xdoc-pair-badge');
    if (pairBadge) pairBadge.textContent = pairwise.length + ' pairs';
    document.getElementById('xdoc-pairwise').innerHTML = pairwise.map((pair, pi) => {
        const issues = pair.issues || [];
        const comparisons = pair.field_comparisons || [];
        const issueCount = issues.length;

        return `<div class="rounded-xl border p-5" style="background:var(--bg-input);border-color:var(--border-input);">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style="background:rgba(99,102,241,0.08);color:#6366f1;">&#x1F4C4;</div>
                    <h3 class="text-sm font-bold" style="color:var(--text-heading);">
                        ${escapeHtml(pair.doc_a_type || pair.doc_a || '')} vs ${escapeHtml(pair.doc_b_type || pair.doc_b || '')}
                    </h3>
                </div>
                <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${issueCount > 0 ? 'color-mix(in srgb, var(--clinical-red) 10%, var(--bg-card))' : 'color-mix(in srgb, var(--clinical-green) 10%, var(--bg-card))'};color:${issueCount > 0 ? 'var(--clinical-red)' : 'var(--clinical-green)'};">
                    ${issueCount > 0 ? issueCount + ' issue' + (issueCount > 1 ? 's' : '') : '\u2705 All clear'}
                </span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-xs" style="border-collapse:separate;border-spacing:0;">
                    <thead>
                        <tr>
                            <th class="text-left py-2 px-3 font-semibold" style="color:var(--text-muted);border-bottom:1px solid var(--border-card);width:130px;">Field</th>
                            <th class="text-center py-2 px-3 font-semibold" style="color:var(--text-muted);border-bottom:1px solid var(--border-card);width:80px;">Status</th>
                            <th class="text-left py-2 px-3 font-semibold" style="color:var(--text-heading);border-bottom:1px solid var(--border-card);">${escapeHtml(pair.doc_a_type || 'Doc A')}</th>
                            <th class="text-left py-2 px-3 font-semibold" style="color:var(--text-heading);border-bottom:1px solid var(--border-card);">${escapeHtml(pair.doc_b_type || 'Doc B')}</th>
                            <th class="text-left py-2 px-3 font-semibold" style="color:var(--text-muted);border-bottom:1px solid var(--border-card);">Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${comparisons.map((c, ci) => {
                            const statusMap = {
                                match: { bg: 'var(--clinical-green)', icon: '\u2713', label: 'Match' },
                                minor_diff: { bg: 'var(--clinical-amber)', icon: '~', label: 'Minor' },
                                mismatch: { bg: 'var(--clinical-red)', icon: '\u2717', label: 'Mismatch' },
                                missing: { bg: 'var(--clinical-red)', icon: '!', label: 'Missing' },
                            };
                            const st = statusMap[c.status] || statusMap.mismatch;
                            const rowBg = ci % 2 === 1 ? 'background:var(--bg-card);' : '';
                            return `<tr style="${rowBg}">
                                <td class="py-2 px-3 font-semibold" style="color:var(--text-secondary);">${escapeHtml((c.field || '').replace(/_/g, ' '))}</td>
                                <td class="text-center py-2 px-3"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style="background:${st.bg};">${st.icon} ${st.label}</span></td>
                                <td class="py-2 px-3 text-[11px]" style="color:var(--text-secondary);max-width:180px;word-wrap:break-word;">${escapeHtml(String(c.doc_a_value || '\u2014').substring(0, 80))}</td>
                                <td class="py-2 px-3 text-[11px]" style="color:var(--text-secondary);max-width:180px;word-wrap:break-word;">${escapeHtml(String(c.doc_b_value || '\u2014').substring(0, 80))}</td>
                                <td class="py-2 px-3 text-[11px]" style="color:var(--text-muted);">${escapeHtml(c.detail || '')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }).join('');

    // ── Row 6: All Issues — expandable cards with severity filter ─────────
    const allIssues = [];
    pairwise.forEach(pair => {
        (pair.issues || []).forEach(iss => {
            allIssues.push({ ...iss, pair: `${pair.doc_a_type || pair.doc_a || ''} vs ${pair.doc_b_type || pair.doc_b || ''}` });
        });
    });
    window._allXdocIssues = allIssues;

    document.getElementById('xdoc-issues-badge').textContent = allIssues.length + ' issue' + (allIssues.length !== 1 ? 's' : '');

    const xdocSevCounts = { high: 0, medium: 0, low: 0 };
    for (const iss of allIssues) {
        const sev = (iss.severity || 'low').toLowerCase();
        if (sev in xdocSevCounts) xdocSevCounts[sev]++;
        else xdocSevCounts.low++;
    }
    const filterEl = document.getElementById('xdoc-issues-filter');
    if (filterEl) {
        const tabs = [
            { key: 'all', label: 'All', count: allIssues.length, dot: '' },
            { key: 'high', label: 'High', count: xdocSevCounts.high, dot: 'var(--clinical-red)' },
            { key: 'medium', label: 'Medium', count: xdocSevCounts.medium, dot: 'var(--clinical-amber)' },
            { key: 'low', label: 'Low', count: xdocSevCounts.low, dot: 'var(--clinical-blue)' },
        ];
        filterEl.innerHTML = tabs.map(t =>
            `<button onclick="filterXdocIssues('${t.key}')" data-xdoc-filter="${t.key}" class="xdoc-filter-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all" style="color:var(--text-muted);">${t.dot ? `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${t.dot};"></span>` : ''}${t.label} <span class="opacity-60">${t.count}</span></button>`
        ).join('');
        filterEl.style.display = allIssues.length > 0 ? 'inline-flex' : 'none';
        const allBtn = filterEl.querySelector('[data-xdoc-filter="all"]');
        if (allBtn) { allBtn.style.background = 'var(--bg-card)'; allBtn.style.color = 'var(--text-heading)'; allBtn.style.boxShadow = 'var(--shadow-card)'; }
    }

    renderXdocIssueCards(allIssues, document.getElementById('xdoc-issues-list'));

    // ── Multi-Agent Analysis Panel ───────────────────────────────────────
    const xdocAgentPanel = document.getElementById('xdoc-agent-panel');
    const xdocAgentCards = document.getElementById('xdoc-agent-cards');
    const xdocAgentResults = data.agent_results || {};
    const hasXdocAgents = Object.keys(xdocAgentResults).length > 0;

    if (hasXdocAgents && xdocAgentPanel && xdocAgentCards) {
        xdocAgentPanel.classList.remove('hidden');
        const agentIcons = {
            shield: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
            chart: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>',
            clipboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
        };
        const agentColors = { red: '--clinical-red', blue: '--clinical-blue', green: '--clinical-green' };
        xdocAgentCards.innerHTML = '';
        for (const [name, info] of Object.entries(xdocAgentResults)) {
            const colorKey = name === 'safety' ? 'red' : name === 'statistics' ? 'blue' : 'green';
            const colorVar = agentColors[colorKey] || '--clinical-teal';
            const iconKey = name === 'safety' ? 'shield' : name === 'statistics' ? 'chart' : 'clipboard';
            const confPct = Math.round((info.confidence || 0) * 100);
            xdocAgentCards.innerHTML += `
                <div class="rounded-xl p-4 transition-all hover:shadow-md" style="background:color-mix(in srgb, var(${colorVar}) 5%, var(--bg-card));border:1px solid color-mix(in srgb, var(${colorVar}) 20%, transparent);">
                    <div class="flex items-center gap-2.5 mb-2.5">
                        <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:color-mix(in srgb, var(${colorVar}) 12%, transparent);color:var(${colorVar});">
                            ${agentIcons[iconKey] || ''}
                        </div>
                        <div>
                            <div class="text-sm font-bold" style="color:var(--text-heading);">${escapeHtml(info.label || name)}</div>
                            <div class="text-[10px]" style="color:var(--text-muted);">${escapeHtml(info.role || '')}</div>
                        </div>
                    </div>
                    <div class="flex items-center justify-between mt-2">
                        <span class="text-xs font-semibold" style="color:var(${colorVar});">${info.finding_count || 0} findings</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:color-mix(in srgb, var(${colorVar}) 12%, transparent);color:var(${colorVar});">${confPct}% confidence</span>
                    </div>
                </div>`;
        }
    } else if (xdocAgentPanel) {
        xdocAgentPanel.classList.add('hidden');
    }

    // Scroll to top
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Render cross-doc issue cards (matches single-doc finding card design) */
function renderXdocIssueCards(issues, container) {
    container.innerHTML = '';
    if (issues.length === 0) {
        container.innerHTML = `<div class="text-center py-8">
            <div class="text-3xl mb-2">\u2705</div>
            <div class="text-sm font-semibold" style="color:var(--clinical-green);">No issues found</div>
            <div class="text-xs mt-1" style="color:var(--text-muted);">All documents are consistent</div>
        </div>`;
        return;
    }
    issues.forEach((iss, idx) => {
        const severity = (iss.severity || 'low').toLowerCase();
        const sevVar = severity === 'high' ? '--clinical-red' : severity === 'medium' ? '--clinical-amber' : '--clinical-blue';
        const sevIcon = severity === 'high' ? '\u26A0' : severity === 'medium' ? '\u25B2' : '\u25CF';
        const cardId = 'xdoc-issue-' + idx;
        const statusMap = {
            match: { label: 'Match', color: '--clinical-green' },
            minor_diff: { label: 'Minor Diff', color: '--clinical-amber' },
            mismatch: { label: 'Mismatch', color: '--clinical-red' },
            missing: { label: 'Missing', color: '--clinical-red' },
        };
        const st = statusMap[iss.status] || { label: iss.status || '', color: '--clinical-amber' };
        const hasDetails = iss.doc_a_value || iss.doc_b_value || iss.pair;

        container.innerHTML += `
            <div class="finding-card rounded-xl transition-all" style="background:var(--bg-card-hover);border:1px solid var(--border-card);border-left:4px solid var(${sevVar});overflow:hidden;">
                <div class="p-4 cursor-pointer" onclick="toggleFindingDetail('${cardId}')">
                    <div class="flex items-start gap-3">
                        <div class="flex-shrink-0 flex flex-col items-center gap-1 mt-0.5" style="min-width:48px;">
                            <span class="inline-flex items-center justify-center w-full px-2 py-1 text-[10px] font-bold rounded-md uppercase tracking-wide" style="background:color-mix(in srgb, var(${sevVar}) 15%, transparent);color:var(${sevVar});">${sevIcon} ${severity}</span>
                            <span class="text-[9px] font-mono" style="color:var(--text-muted);">#${idx + 1}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-semibold leading-snug" style="color:var(--text-heading);">${escapeHtml((iss.field || '').replace(/_/g, ' '))}</p>
                            <p class="text-xs mt-1.5 leading-relaxed" style="color:var(--text-secondary);">${escapeHtml(iss.detail || '')}</p>
                            <div class="flex flex-wrap gap-1.5 mt-2">
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold" style="background:color-mix(in srgb, var(${st.color}) 12%, transparent);color:var(${st.color});">${escapeHtml(st.label)}</span>
                                ${iss.pair ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style="background:color-mix(in srgb, #6366f1 10%, transparent);color:#6366f1;">\uD83D\uDCC4 ${escapeHtml(iss.pair)}</span>` : ''}
                            </div>
                        </div>
                        ${hasDetails ? `<svg class="w-4 h-4 flex-shrink-0 mt-1 transition-transform finding-chevron" style="color:var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>` : ''}
                    </div>
                </div>
                ${hasDetails ? `
                <div id="${cardId}" class="finding-detail hidden" style="border-top:1px solid var(--border-card);">
                    <div class="p-4 space-y-3" style="background:color-mix(in srgb, var(${sevVar}) 3%, var(--bg-card));">
                        ${iss.doc_a_value ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">Document A Value</div>
                            <div class="text-xs leading-relaxed p-3 rounded-lg" style="background:var(--bg-input);color:var(--text-secondary);border-left:2px solid var(--clinical-teal);">${escapeHtml(String(iss.doc_a_value))}</div>
                        </div>` : ''}
                        ${iss.doc_b_value ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">Document B Value</div>
                            <div class="text-xs leading-relaxed p-3 rounded-lg" style="background:var(--bg-input);color:var(--text-secondary);border-left:2px solid var(--clinical-amber);">${escapeHtml(String(iss.doc_b_value))}</div>
                        </div>` : ''}
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5" style="color:var(--clinical-teal);">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                Recommendation
                            </div>
                            <div class="text-xs leading-relaxed" style="color:var(--text-secondary);">
                                ${iss.status === 'mismatch' || iss.status === 'missing'
                                    ? 'Align this field across all documents. Review the source document and ensure consistency before regulatory submission.'
                                    : 'Minor difference noted. Verify this is acceptable (e.g. lay language simplification) and document the rationale.'}
                            </div>
                        </div>
                        ${iss.pair ? `
                        <div class="flex items-center gap-2 text-[10px]" style="color:var(--text-muted);">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"/></svg>
                            Pair: ${escapeHtml(iss.pair)}
                        </div>` : ''}
                    </div>
                </div>` : ''}
            </div>`;
    });
}

/** Filter cross-doc issues by severity */
function filterXdocIssues(severity) {
    const all = window._allXdocIssues || [];
    const filtered = severity === 'all' ? all : all.filter(iss => (iss.severity || 'low').toLowerCase() === severity);
    renderXdocIssueCards(filtered, document.getElementById('xdoc-issues-list'));
    document.querySelectorAll('.xdoc-filter-btn').forEach(btn => {
        const isActive = btn.dataset.xdocFilter === severity;
        btn.style.background = isActive ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isActive ? 'var(--shadow-card)' : 'none';
    });
}

/** Download cross-doc comparison report as PDF or JSON */
function downloadCrossDocReport(format) {
    if (!lastCrossDocData) { showToast('Run a comparison first.', 'error'); return; }
    if (format === 'json') {
        const blob = new Blob([JSON.stringify(lastCrossDocData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cross_doc_comparison.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('JSON downloaded!', 'success');
    } else {
        // PDF — send to server endpoint (same pattern as single-doc)
        const d = lastCrossDocData;
        const form = new FormData();
        form.append('filename', 'cross_doc_comparison');
        form.append('summary', 'Cross-document comparison of ' + (d.document_count || 0) + ' documents');
        form.append('entities', JSON.stringify({}));
        form.append('risk', JSON.stringify({ findings: [], total_findings: d.total_issues || 0 }));
        form.append('rule', JSON.stringify({}));
        form.append('quality', JSON.stringify(d.risk_score || {}));
        fetch('/api/analysis/download/pdf', { method: 'POST', body: form })
            .then(res => {
                if (!res.ok) throw new Error('Download failed');
                return res.blob();
            })
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'cross_doc_comparison_report.pdf';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast('PDF downloaded!', 'success');
            })
            .catch(() => showToast('PDF download failed', 'error'));
    }
}

/** Build the unified comparison table with color coding, status badges, and drill-down */
function renderUnifiedComparisonTable(fields, docs, filter) {
    const container = document.getElementById('xdoc-fields-table');
    const countEl = document.getElementById('xdoc-table-count');
    if (!container) return;

    const filtered = filter === 'issues'
        ? fields.filter(f => f.worstStatus !== 'match')
        : fields;

    if (countEl) countEl.textContent = filtered.length + ' field' + (filtered.length !== 1 ? 's' : '');

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-8"><div class="text-3xl mb-2">\u2705</div><div class="text-sm font-semibold" style="color:var(--clinical-green);">All fields match</div><div class="text-xs mt-1" style="color:var(--text-muted);">No inconsistencies found across documents</div></div>`;
        return;
    }

    // Build doc type headers from documents array
    const docHeaders = docs.map(d => d.doc_type || d.filename || '');
    const docTypeIcons = { 'Clinical Protocol': '\uD83D\uDCC4', 'Clinical Study Report': '\uD83D\uDCCA', 'Consent Form': '\uD83D\uDCCB' };

    const statusConfig = {
        match: { bg: 'var(--clinical-green)', icon: '\u2713', label: 'Match', rowTint: 'color-mix(in srgb, var(--clinical-green) 4%, transparent)' },
        minor_diff: { bg: 'var(--clinical-amber)', icon: '~', label: 'Minor Diff', rowTint: 'color-mix(in srgb, var(--clinical-amber) 4%, transparent)' },
        mismatch: { bg: 'var(--clinical-red)', icon: '\u2717', label: 'Mismatch', rowTint: 'color-mix(in srgb, var(--clinical-red) 4%, transparent)' },
        missing: { bg: 'var(--clinical-red)', icon: '!', label: 'Missing', rowTint: 'color-mix(in srgb, var(--clinical-red) 4%, transparent)' },
    };
    const sevConfig = {
        HIGH: { color: 'var(--clinical-red)', bg: 'rgba(239,68,68,0.1)' },
        MEDIUM: { color: 'var(--clinical-amber)', bg: 'rgba(217,119,6,0.1)' },
        LOW: { color: 'var(--clinical-blue)', bg: 'rgba(2,132,199,0.1)' },
    };

    let tableHtml = `<table class="w-full text-xs" style="border-collapse:separate;border-spacing:0;">
        <thead>
            <tr>
                <th class="text-left py-2.5 px-3 font-semibold sticky left-0 z-10" style="color:var(--text-muted);border-bottom:2px solid var(--border-card);background:var(--bg-card);min-width:130px;">Field</th>
                ${docHeaders.map(h => `<th class="text-left py-2.5 px-3 font-semibold" style="color:var(--text-heading);border-bottom:2px solid var(--border-card);min-width:150px;">${docTypeIcons[h] || '\uD83D\uDCC4'} ${escapeHtml(h)}</th>`).join('')}
                <th class="text-center py-2.5 px-3 font-semibold" style="color:var(--text-muted);border-bottom:2px solid var(--border-card);min-width:90px;">Status</th>
                <th class="text-center py-2.5 px-3 font-semibold" style="color:var(--text-muted);border-bottom:2px solid var(--border-card);min-width:80px;">Severity</th>
            </tr>
        </thead>
        <tbody>`;

    filtered.forEach((fieldObj, fi) => {
        const st = statusConfig[fieldObj.worstStatus] || statusConfig.match;
        const sev = sevConfig[fieldObj.worstSeverity] || sevConfig.LOW;
        const rowBg = fieldObj.worstStatus !== 'match' ? st.rowTint : (fi % 2 === 1 ? 'var(--bg-input)' : 'transparent');
        const drillId = 'drill-' + fi;

        // Get values per doc from extracted_fields
        const fieldName = fieldObj.field;
        const cellValues = docs.map(d => {
            // Try extracted_fields first
            const ef = d.extracted_fields || {};
            // Find matching key (case insensitive, underscore/space tolerant)
            const normalizedField = fieldName.toLowerCase().replace(/[_ ]/g, '');
            for (const [k, v] of Object.entries(ef)) {
                if (k.toLowerCase().replace(/[_ ]/g, '') === normalizedField) {
                    if (v === null || v === undefined) return '\u2014';
                    if (Array.isArray(v)) return v.join('; ');
                    return String(v);
                }
            }
            // Try from pairwise comparison values
            for (const entry of fieldObj.entries) {
                const docType = d.doc_type || d.filename || '';
                if (entry.doc_a_type === docType) return String(entry.doc_a_value || '\u2014');
                if (entry.doc_b_type === docType) return String(entry.doc_b_value || '\u2014');
            }
            return '\u2014';
        });

        const hasDetail = fieldObj.entries.some(e => e.detail && e.status !== 'match');

        tableHtml += `<tr style="background:${rowBg};cursor:${hasDetail ? 'pointer' : 'default'};" ${hasDetail ? `onclick="toggleDrillDown('${drillId}')"` : ''} class="transition hover:opacity-90">
            <td class="py-2.5 px-3 font-semibold sticky left-0 z-10" style="color:var(--text-heading);background:${rowBg};">${escapeHtml(fieldName)}${hasDetail ? ' <svg class="w-3 h-3 inline-block ml-1 drill-chevron-' + fi + ' transition-transform" style="color:var(--text-muted);vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' : ''}</td>
            ${cellValues.map(val => `<td class="py-2.5 px-3" style="color:var(--text-secondary);max-width:200px;word-wrap:break-word;">${escapeHtml(val.substring(0, 100))}${val.length > 100 ? '...' : ''}</td>`).join('')}
            <td class="text-center py-2.5 px-3"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-white" style="background:${st.bg};">${st.icon} ${st.label}</span></td>
            <td class="text-center py-2.5 px-3">${fieldObj.worstStatus !== 'match' ? `<span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:${sev.bg};color:${sev.color};">${fieldObj.worstSeverity}</span>` : '<span class="text-[10px]" style="color:var(--text-muted);">—</span>'}</td>
        </tr>`;

        // Drill-down row (hidden by default)
        if (hasDetail) {
            const detailEntries = fieldObj.entries.filter(e => e.status !== 'match');
            tableHtml += `<tr id="${drillId}" class="hidden">
                <td colspan="${docs.length + 3}" style="padding:0;border:none;">
                    <div class="p-4 space-y-3" style="background:color-mix(in srgb, ${st.bg} 3%, var(--bg-card));border-top:1px dashed var(--border-card);border-bottom:1px dashed var(--border-card);">
                        ${detailEntries.map(entry => `
                            <div class="flex flex-col gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:rgba(99,102,241,0.1);color:#6366f1;">${escapeHtml(entry.pair_label || '')}</span>
                                    <span class="text-[10px] font-medium" style="color:var(--text-muted);">${escapeHtml(entry.detail || '')}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div class="p-2.5 rounded-lg" style="background:var(--bg-input);border-left:3px solid var(--clinical-teal);">
                                        <div class="text-[9px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">${escapeHtml(entry.doc_a_type || 'Doc A')}</div>
                                        <div class="text-xs" style="color:var(--text-secondary);">${escapeHtml(String(entry.doc_a_value || '\u2014'))}</div>
                                    </div>
                                    <div class="p-2.5 rounded-lg" style="background:var(--bg-input);border-left:3px solid var(--clinical-amber);">
                                        <div class="text-[9px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted);">${escapeHtml(entry.doc_b_type || 'Doc B')}</div>
                                        <div class="text-xs" style="color:var(--text-secondary);">${escapeHtml(String(entry.doc_b_value || '\u2014'))}</div>
                                    </div>
                                </div>
                                <div class="flex items-start gap-2 mt-1">
                                    <svg class="w-3 h-3 flex-shrink-0 mt-0.5" style="color:var(--clinical-teal);" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                    <div class="text-[11px]" style="color:var(--text-secondary);">
                                        <span class="font-bold" style="color:var(--clinical-teal);">Recommendation:</span>
                                        ${entry.status === 'mismatch' || entry.status === 'missing'
                                            ? 'Align this field across all documents. Review source and ensure consistency before submission.'
                                            : 'Minor difference noted. Verify this is acceptable and document rationale.'}
                                    </div>
                                </div>
                            </div>
                        `).join('<hr style="border-color:var(--border-card);margin:4px 0;">')
                        }
                    </div>
                </td>
            </tr>`;
        }
    });

    tableHtml += '</tbody></table>';
    container.innerHTML = tableHtml;
    document.getElementById('xdoc-fields-section').classList.remove('hidden');
}

/** Toggle drill-down row in comparison table */
function toggleDrillDown(id) {
    const row = document.getElementById(id);
    if (!row) return;
    row.classList.toggle('hidden');
    // Find the chevron index from the id
    const idx = id.replace('drill-', '');
    const chevron = document.querySelector('.drill-chevron-' + idx);
    if (chevron) chevron.style.transform = row.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

/** Open per-document detail modal */
function openDocDetailModal(idx) {
    const docs = window._crossDocDocs || [];
    const d = docs[idx];
    if (!d) return;

    const qScore = d.quality_score || 0;
    const qColorVar = qScore >= 80 ? '--clinical-green' : qScore >= 60 ? '--clinical-blue' : qScore >= 40 ? '--clinical-amber' : '--clinical-red';
    const fc = d.finding_counts || {};
    const typeIcon = (d.doc_type || '').toLowerCase().includes('protocol') ? '📄' : (d.doc_type || '').toLowerCase().includes('report') ? '📊' : '📋';

    document.getElementById('ddm-icon').textContent = typeIcon;
    document.getElementById('ddm-filename').textContent = d.filename || '';
    document.getElementById('ddm-doctype').textContent = d.doc_type || '';
    document.getElementById('ddm-score').innerHTML = `<span style="color:var(${qColorVar})">${qScore}</span><span class="text-xs font-normal" style="color:var(--text-muted)">/100</span>`;
    document.getElementById('ddm-grade').innerHTML = `<span style="color:var(${qColorVar})">${d.quality_grade || '—'}</span>`;
    document.getElementById('ddm-findings-total').textContent = fc.total || (fc.high||0)+(fc.medium||0)+(fc.low||0);
    document.getElementById('ddm-sev-high').textContent = (fc.high||0) + ' H';
    document.getElementById('ddm-sev-med').textContent = (fc.medium||0) + ' M';
    document.getElementById('ddm-sev-low').textContent = (fc.low||0) + ' L';

    // Summary
    document.getElementById('ddm-summary').textContent = d.full_summary || d.summary || 'No summary available.';

    // Agent cards
    const agentMeta = {
        safety:     { icon: '🛡️', color: '--clinical-red',   label: 'Safety Agent' },
        statistics: { icon: '📊', color: '--clinical-blue',  label: 'Statistics Agent' },
        regulatory: { icon: '📋', color: '--clinical-green', label: 'Regulatory Agent' },
    };
    const agents = d.agent_results || {};
    const agentKeys = Object.keys(agents);
    const agentSection = document.getElementById('ddm-agents');
    if (agentKeys.length) {
        agentSection.classList.remove('hidden');
        document.getElementById('ddm-agent-cards').innerHTML = agentKeys.map(k => {
            const a = agents[k];
            const m = agentMeta[k] || { icon: '🔍', color: '--clinical-blue', label: k };
            const conf = Math.round((a.confidence || 0) * 100);
            return `<div class="p-3 rounded-xl border" style="background:var(--bg-input);border-color:color-mix(in srgb, var(${m.color}) 20%, var(--border-input));">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-base">${m.icon}</span>
                    <span class="text-xs font-bold" style="color:var(${m.color});">${a.label || m.label}</span>
                </div>
                <div class="text-[10px]" style="color:var(--text-muted);">${a.role || ''}</div>
                <div class="flex items-center justify-between mt-2">
                    <span class="text-xs font-bold" style="color:var(--text-heading);">${a.finding_count || 0} findings</span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold" style="background:color-mix(in srgb, var(${m.color}) 10%, var(--bg-card));color:var(${m.color});">${conf}% conf</span>
                </div>
            </div>`;
        }).join('');
    } else {
        agentSection.classList.add('hidden');
    }

    // Entities
    const ent = d.entities || {};
    const entKeys = Object.keys(ent).filter(k => !['study_phase','sample_size','study_design'].includes(k));
    const entSection = document.getElementById('ddm-entities-section');
    if (entKeys.length) {
        entSection.classList.remove('hidden');
        document.getElementById('ddm-entities').innerHTML = entKeys.map(k => {
            const val = ent[k];
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            let chips = '';
            if (Array.isArray(val)) {
                chips = val.map(v => {
                    const text = typeof v === 'object' ? (v.name || v.event || JSON.stringify(v)) : v;
                    const sevColor = v && v.severity === 'HIGH' ? 'rgba(239,68,68,0.1)' : v && v.severity === 'MEDIUM' ? 'rgba(217,119,6,0.1)' : 'rgba(99,102,241,0.08)';
                    const sevText = v && v.severity === 'HIGH' ? 'var(--clinical-red)' : v && v.severity === 'MEDIUM' ? 'var(--clinical-amber)' : 'var(--text-secondary)';
                    return `<span class="inline-block text-[11px] px-2 py-0.5 rounded-full mr-1 mb-1" style="background:${sevColor};color:${sevText};">${escapeHtml(String(text))}</span>`;
                }).join('');
            } else if (typeof val === 'object') {
                chips = Object.entries(val).map(([sk, sv]) => `<span class="inline-block text-[11px] px-2 py-0.5 rounded-full mr-1 mb-1" style="background:rgba(99,102,241,0.08);color:var(--text-secondary);">${escapeHtml(sk)}: ${escapeHtml(String(sv))}</span>`).join('');
            } else {
                chips = `<span class="text-[11px]" style="color:var(--text-secondary);">${escapeHtml(String(val))}</span>`;
            }
            return `<div class="p-3 rounded-xl" style="background:var(--bg-input);">
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-1" style="color:var(--text-muted);">${escapeHtml(label)}</div>
                <div>${chips}</div>
            </div>`;
        }).join('');
    } else {
        entSection.classList.add('hidden');
    }

    // Risk Findings
    const findings = d.risk_findings || [];
    const findingsSection = document.getElementById('ddm-findings-section');
    if (findings.length) {
        findingsSection.classList.remove('hidden');
        document.getElementById('ddm-findings').innerHTML = findings.map(f => {
            const sevBg = f.severity === 'HIGH' ? 'rgba(239,68,68,0.08)' : f.severity === 'MEDIUM' ? 'rgba(217,119,6,0.08)' : 'rgba(2,132,199,0.08)';
            const sevColor = f.severity === 'HIGH' ? 'var(--clinical-red)' : f.severity === 'MEDIUM' ? 'var(--clinical-amber)' : 'var(--clinical-blue)';
            return `<div class="p-3 rounded-xl border-l-4" style="background:${sevBg};border-color:${sevColor};">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold" style="color:var(--text-heading);">${escapeHtml(f.title || '')}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:${sevBg};color:${sevColor};">${f.severity || ''}</span>
                        ${f.agent_label ? `<span class="text-[10px] px-2 py-0.5 rounded-full" style="background:rgba(99,102,241,0.08);color:#6366f1;">${escapeHtml(f.agent_label)}</span>` : ''}
                    </div>
                </div>
                <div class="text-[11px]" style="color:var(--text-muted);">${escapeHtml(f.description || '')}</div>
            </div>`;
        }).join('');
    } else {
        findingsSection.classList.add('hidden');
    }

    document.getElementById('doc-detail-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

/** Close per-document detail modal */
function closeDocDetailModal() {
    document.getElementById('doc-detail-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

/** Filter unified comparison table: 'all' or 'issues' */
function filterComparisonTable(filter) {
    const fields = window._allUnifiedFields || [];
    const docs = (lastCrossDocData || {}).documents || [];
    renderUnifiedComparisonTable(fields, docs, filter);
    document.querySelectorAll('.table-filter-btn').forEach(btn => {
        const isActive = btn.dataset.tableFilter === filter;
        btn.style.background = isActive ? 'var(--bg-card)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-heading)' : 'var(--text-muted)';
        btn.style.boxShadow = isActive ? 'var(--shadow-card)' : 'none';
    });
}



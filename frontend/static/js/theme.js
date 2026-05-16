// ClinDoc AI — Theme Toggle (persisted in localStorage)

(function() {
    const STORAGE_KEY = 'clindoc_theme';

    // Apply saved theme immediately (before paint) to prevent flash
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
    } else {
        // Default to dark for clinical dashboard
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    window.toggleTheme = function() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(STORAGE_KEY, next);
        // Dispatch event so charts can re-render with new colors
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    };

    window.getTheme = function() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    };

    // Helper: get CSS variable value
    window.getCSSVar = function(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    };

    // Helper: get theme-aware chart tooltip config
    window.chartTooltipConfig = function() {
        return {
            backgroundColor: getCSSVar('--chart-tooltip-bg'),
            titleColor: getCSSVar('--chart-tooltip-title'),
            bodyColor: getCSSVar('--chart-tooltip-body'),
            borderColor: getCSSVar('--chart-tooltip-border'),
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10
        };
    };

    // Helper: get theme-aware axis config
    window.chartAxisConfig = function(showGrid) {
        return {
            grid: showGrid ? { color: getCSSVar('--chart-grid') } : { display: false },
            ticks: { color: getCSSVar('--chart-tick'), font: { size: 11, weight: '600' } },
            border: { display: false }
        };
    };
})();

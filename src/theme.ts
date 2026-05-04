import type { UITheme } from './configuration'

const THEME_STYLE_ID = 'ui-theme-style'

const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null

function resolveAutoTheme(): 'light' | 'dark' {
    return darkModeQuery.matches ? 'dark' : 'light'
}

function setThemeAttribute(resolved: 'classic' | 'light' | 'dark') {
    if (resolved === 'classic') {
        document.documentElement.removeAttribute('data-theme')
    } else {
        document.documentElement.setAttribute('data-theme', resolved)
    }
}

export function applyTheme(theme: UITheme) {
    // Clean up previous matchMedia listener
    if (mediaQueryListener) {
        darkModeQuery.removeEventListener('change', mediaQueryListener)
        mediaQueryListener = null
    }

    // Inject theme style element if not present
    injectThemeStyles()

    if (theme === 'auto') {
        setThemeAttribute(resolveAutoTheme())
        mediaQueryListener = () => setThemeAttribute(resolveAutoTheme())
        darkModeQuery.addEventListener('change', mediaQueryListener)
    } else {
        setThemeAttribute(theme)
    }
}

function injectThemeStyles() {
    if (document.getElementById(THEME_STYLE_ID)) return

    const style = document.createElement('style')
    style.id = THEME_STYLE_ID
    style.textContent = `
/* ===== Light Theme ===== */
html[data-theme="light"] {
    --theme-bg: #f8f9fa;
    --theme-surface: #ffffff;
    --theme-surface-variant: #e8e8f0;
    --theme-text: #1a1a2e;
    --theme-text-secondary: #5a5a7a;
    --theme-border: #e0e0e8;
    --theme-accent: #4361ee;
    --theme-error: #e53935;
    --theme-success: #2e7d32;
    --theme-warning: #f57c00;
    --theme-hover: #f0f0f8;
    --theme-input-bg: #f4f4fa;
    --theme-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    --theme-recording: #e53935;
    --theme-link: #4361ee;
    --theme-notice-bg: #f0f2ff;
    --theme-notice-text: #5a5a7a;
    --theme-divider: #e8e8f0;
    --theme-chip-bg: #eef0ff;
    --theme-dialog-bg: #ffffff;
    --theme-preview-bg: #e8e8f0;
    --theme-overlay-dim: rgba(0, 0, 0, 0.35);
    --theme-crop-border: #4361ee;
    --theme-crop-bg: rgba(67, 97, 238, 0.08);
    --theme-crop-handle: #4361ee;
    --theme-crop-handle-border: #ffffff;
    --theme-crop-disabled: #999;
    --theme-preview-message: #888;
    color-scheme: light;
}

/* ===== Dark Theme ===== */
html[data-theme="dark"] {
    --theme-bg: #121218;
    --theme-surface: #1e1e2a;
    --theme-surface-variant: #28283a;
    --theme-text: #e8e8f0;
    --theme-text-secondary: #a0a0b8;
    --theme-border: #2e2e40;
    --theme-accent: #7b8cff;
    --theme-error: #ff6b6b;
    --theme-success: #66bb6a;
    --theme-warning: #ffa726;
    --theme-hover: #28283a;
    --theme-input-bg: #1a1a28;
    --theme-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    --theme-recording: #ff6b6b;
    --theme-link: #7b8cff;
    --theme-notice-bg: #1a1a28;
    --theme-notice-text: #a0a0b8;
    --theme-divider: #2e2e40;
    --theme-chip-bg: #28283a;
    --theme-dialog-bg: #1e1e2a;
    --theme-preview-bg: #121218;
    --theme-overlay-dim: rgba(0, 0, 0, 0.6);
    --theme-crop-border: #7b8cff;
    --theme-crop-bg: rgba(123, 140, 255, 0.1);
    --theme-crop-handle: #7b8cff;
    --theme-crop-handle-border: #1e1e2a;
    --theme-crop-disabled: #555;
    --theme-preview-message: #888;
    color-scheme: dark;
}

/* ===== Global themed styles (Light & Dark) ===== */
html[data-theme="light"] body,
html[data-theme="dark"] body {
    background-color: var(--theme-bg);
    color: var(--theme-text);
    transition: background-color 0.2s ease, color 0.2s ease;
}

html[data-theme="light"] .container,
html[data-theme="dark"] .container {
    background-color: var(--theme-surface);
    border-radius: 12px;
    box-shadow: var(--theme-shadow);
    padding: 0 24px 24px;
    margin-top: 16px;
}

html[data-theme="light"] a,
html[data-theme="dark"] a {
    color: var(--theme-link);
}

/* Material Web component theming */
html[data-theme="light"],
html[data-theme="dark"] {
    --md-sys-color-surface-container-highest: var(--theme-input-bg);
    --md-sys-color-on-surface: var(--theme-text);
    --md-sys-color-on-surface-variant: var(--theme-text-secondary);
    --md-sys-color-outline: var(--theme-border);
    --md-sys-color-outline-variant: var(--theme-border);
    --md-sys-color-primary: var(--theme-accent);
    --md-sys-color-on-primary: #ffffff;
    --md-sys-color-secondary-container: var(--theme-chip-bg);
    --md-sys-color-on-secondary-container: var(--theme-text);
    --md-sys-color-surface: var(--theme-surface);
    --md-sys-color-surface-container: var(--theme-surface);
    --md-sys-color-surface-container-low: var(--theme-bg);
    --md-filled-text-field-container-color: var(--theme-input-bg);
    --md-filled-text-field-label-text-color: var(--theme-text-secondary);
    --md-filled-text-field-input-text-color: var(--theme-text);
    --md-filled-select-text-field-container-color: var(--theme-input-bg);
    --md-filled-select-text-field-label-text-color: var(--theme-text-secondary);
    --md-filled-select-text-field-input-text-color: var(--theme-text);
    --md-dialog-container-color: var(--theme-dialog-bg);
    --md-dialog-headline-color: var(--theme-text);
    --md-dialog-supporting-text-color: var(--theme-text-secondary);
}
`
    document.head.appendChild(style)
}

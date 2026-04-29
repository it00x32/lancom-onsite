import { q } from './lib/helpers.js';

export function initTheme() {
  const saved = localStorage.getItem('onsite_theme') || 'light';
  applyTheme(saved);
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('theme-toggle-btn').textContent = '🌙';
  } else {
    delete document.documentElement.dataset.theme;
    document.getElementById('theme-toggle-btn').textContent = '☀️';
  }
  localStorage.setItem('onsite_theme', theme);
  // Re-render topology SVG so theme-aware colours take effect immediately
  if (document.getElementById('panel-topology')?.classList.contains('active')) {
    if (typeof window.renderTopoSvg === 'function') window.renderTopoSvg();
  }
}

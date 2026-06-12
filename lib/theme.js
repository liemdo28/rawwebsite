/**
 * lib/theme.js — Theme manager for colors, fonts, navigation, header/footer.
 *
 * Theme settings are stored as a single row in `site_settings` with key='theme'.
 * This module provides CRUD helpers for each section.
 *
 * Navigation is a structured array; header/footer are free-form HTML strings.
 */

import { record } from './auditLog.js';

const THEME_KEY = 'theme';

/** Default theme configuration */
export const DEFAULT_THEME = {
  colors: {
    primary: '#c41e3a',
    secondary: '#1a1a2e',
    accent: '#e8c547',
    background: '#ffffff',
    surface: '#f7f7f7',
    text: '#1a1a1a',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    error: '#dc2626',
    success: '#16a34a',
  },
  fonts: {
    heading: 'Playfair Display, Georgia, serif',
    body: 'Inter, system-ui, sans-serif',
    mono: 'JetBrains Mono, monospace',
 },
  navigation: [
    { label: 'Home', href: '/', location: 'header', order: 0, active: true },
    { label: 'Menu', href: '/menu-stockton.html', location: 'header', order: 1, active: true },
    { label: 'Blog', href: '/blog-posts.html', location: 'header', order: 2, active: true },
    { label: 'Order Online', href: '/order-sushi-stockton.html', location: 'header', order: 3, active: true },
    { label: 'Contact', href: '/contact', location: 'header', order: 4, active: true },
  ],
  header: '',
  footer: '',
  logo_url: '',
  favicon_url: '',
};

/**
 * Get the current theme from the store.
 * @param {any} store
 */
export async function getTheme(store) {
  const rows = await store.list('site_settings');
  const themeRow = rows.find(r => r.key === THEME_KEY);
  if (!themeRow) return { ...DEFAULT_THEME };
  return { ...DEFAULT_THEME, ...(themeRow.value || {}) };
}

/**
 * Save theme settings to the store.
 * @param {any} store
 * @param {Record<string, unknown>} theme
 * @param {{ actor?: string }} [opts]
 */
export async function saveTheme(store, theme, opts = {}) {
  const merged = deepMerge(await getTheme(store), theme);
  const row = {
    key: THEME_KEY,
    value: merged,
    updated_at: new Date().toISOString(),
  };
  await store.upsert('site_settings', row);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'theme.update',
    target_type: 'site_setting',
    target_id: THEME_KEY,
    meta: { changed_keys: Object.keys(theme) },
  });
  return merged;
}

/**
 * Update only the colors section.
 * @param {any} store
 * @param {Record<string, string>} colors
 * @param {{ actor?: string }} [opts]
 */
export async function updateColors(store, colors, opts = {}) {
  const theme = await getTheme(store);
  return saveTheme(store, { ...theme, colors: { ...theme.colors, ...colors } }, opts);
}

/**
 * Update only the fonts section.
 * @param {any} store
 * @param {Record<string, string>} fonts
 * @param {{ actor?: string }} [opts]
 */
export async function updateFonts(store, fonts, opts = {}) {
  const theme = await getTheme(store);
  return saveTheme(store, { ...theme, fonts: { ...theme.fonts, ...fonts } }, opts);
}

/**
 * Update navigation items.
 * @param {any} store
 * @param {unknown[]} navItems
 * @param {{ actor?: string }} [opts]
 */
export async function updateNavigation(store, navItems, opts = {}) {
  if (!Array.isArray(navItems)) throw new Error('navigation_must_be_array');
  const theme = await getTheme(store);
  return saveTheme(store, { ...theme, navigation: navItems }, opts);
}

/**
 * Update header or footer HTML.
 * @param {any} store
 * @param {'header'|'footer'} section
 * @param {string} html
 * @param {{ actor?: string }} [opts]
 */
export async function updateSection(store, section, html, opts = {}) {
  if (section !== 'header' && section !== 'footer') {
    throw new Error('section_must_be_header_or_footer');
  }
  const theme = await getTheme(store);
  return saveTheme(store, { ...theme, [section]: html }, opts);
}

/**
 * Generate CSS variables from theme for injection into pages.
 * @param {Record<string, unknown>} theme
 */
export function themeToCSSVars(theme) {
  const colors = theme.colors || {};
  const fonts = theme.fonts || {};
  const vars = [];
  for (const [k, v] of Object.entries(colors)) {
    vars.push(`--color-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(fonts)) {
    vars.push(`--font-${k}: ${v};`);
  }
  return `:root {\n  ${vars.join('\n  ')}\n}`;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

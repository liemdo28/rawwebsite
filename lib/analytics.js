/**
 * lib/analytics.js — Analytics manager for GA4, GSC, and Cloudflare Analytics.
 *
 * Analytics settings are stored in `site_settings` with key='analytics'.
 * This module provides read/write helpers and configuration builders.
 */

import { record } from './auditLog.js';

const ANALYTICS_KEY = 'analytics';

/** Default analytics configuration */
export const DEFAULT_ANALYTICS = {
  google_analytics: {
    enabled: false,
    measurement_id: '',
    api_secret: '',
    enabled_for: ['production'],
  },
  google_tag_manager: {
    enabled: false,
    container_id: '',
  },
  google_search_console: {
    enabled: false,
    site_url: '',
    verification_meta: '',
  },
  cloudflare_analytics: {
    enabled: true,
    token: '',
  },
  facebook_pixel: {
    enabled: false,
    pixel_id: '',
  },
};

/**
 * Get current analytics settings from the store.
 * @param {any} store
 */
export async function getAnalytics(store) {
  const rows = await store.list('site_settings');
  const row = rows.find(r => r.key === ANALYTICS_KEY);
  if (!row) return { ...DEFAULT_ANALYTICS };
  return { ...DEFAULT_ANALYTICS, ...(row.value || {}) };
}

/**
 * Save analytics settings to the store.
 * @param {any} store
 * @param {Record<string, unknown>} analytics
 * @param {{ actor?: string }} [opts]
 */
export async function saveAnalytics(store, analytics, opts = {}) {
  const merged = deepMerge(await getAnalytics(store), analytics);
  const row = {
    key: ANALYTICS_KEY,
    value: merged,
    updated_at: new Date().toISOString(),
  };
  await store.upsert('site_settings', row);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'analytics.update',
    target_type: 'site_setting',
    target_id: ANALYTICS_KEY,
    meta: { changed_keys: Object.keys(analytics) },
  });
  return merged;
}

/**
 * Build GA4 script tag.
 * @param {Record<string, unknown>} analytics
 * @param {'production'|'preview'|'development'} [env]
 */
export function buildGAScript(analytics, env = 'production') {
  const ga = analytics.google_analytics || {};
  if (!ga.enabled || !ga.measurement_id) return '';
  if (!ga.enabled_for || !ga.enabled_for.includes(env)) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga.measurement_id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${ga.measurement_id}'${ga.api_secret ? `, {'api_secret': '${ga.api_secret}'}` : ''});
</script>`;
}

/**
 * Build GTM script tag.
 * @param {Record<string, unknown>} analytics
 */
export function buildGTMScript(analytics) {
  const gtm = analytics.google_tag_manager || {};
  if (!gtm.enabled || !gtm.container_id) return '';
  return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtm.container_id}');</script>`;
}

/**
 * Build Cloudflare Web Analytics script.
 * @param {Record<string, unknown>} analytics
 */
export function buildCFAnalyticsScript(analytics) {
  const cf = analytics.cloudflare_analytics || {};
  if (!cf.enabled) return '';
  if (cf.token) {
    return `<script defer src='https://static.cloudflareinsights.com/beacon.min.js'
 data-cf-beacon='{"token": "${cf.token}"}'></script>`;
  }
  return '';
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

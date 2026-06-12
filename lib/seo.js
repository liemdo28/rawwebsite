/**
 * lib/seo.js — SEO manager for meta tags, OG images, and structured data.
 *
 * SEO settings are stored in `site_settings` with key='seo'.
 * This module provides helpers to read/write individual fields.
 */

import { record } from './auditLog.js';

const SEO_KEY = 'seo';

/** Default SEO configuration */
export const DEFAULT_SEO = {
  site_name: 'Raw Sushi Bar',
  site_description: 'Authentic Japanese sushi in Stockton and Modesto, California.',
  site_url: 'https://www.rawsushibar.com',
  meta_title: '',
  meta_description: '',
  og_image: '',
  og_type: 'website',
  twitter_card: 'summary_large_image',
  canonical_url: '',
  schema_type: 'Restaurant',
  schema_local_business: {
    '@type': 'Restaurant',
    name: 'Raw Sushi Bar',
    url: 'https://www.rawsushibar.com',
    telephone: '',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '',
      addressLocality: '',
      addressRegion: 'CA',
      postalCode: '',
      addressCountry: 'US',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: '',
      longitude: '',
    },
    openingHoursSpecification: [],
    priceRange: '$$',
 },
  google_analytics_id: '',
  google_tag_manager_id: '',
  google_search_console_verification: '',
  robots: {
    index: true,
    follow: true,
    sitemap: true,
  },
};

/**
 * Get current SEO settings from the store.
 * @param {any} store
 */
export async function getSeo(store) {
  const rows = await store.list('site_settings');
  const row = rows.find(r => r.key === SEO_KEY);
  if (!row) return { ...DEFAULT_SEO };
  return { ...DEFAULT_SEO, ...(row.value || {}) };
}

/**
 * Save SEO settings to the store.
 * @param {any} store
 * @param {Record<string, unknown>} seo
 * @param {{ actor?: string }} [opts]
 */
export async function saveSeo(store, seo, opts = {}) {
  const merged = deepMerge(await getSeo(store), seo);
  const row = {
    key: SEO_KEY,
    value: merged,
    updated_at: new Date().toISOString(),
  };
  await store.upsert('site_settings', row);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'seo.update',
    target_type: 'site_setting',
    target_id: SEO_KEY,
    meta: { changed_keys: Object.keys(seo) },
  });
  return merged;
}

/**
 * Update a single SEO field.
 * @param {any} store
 * @param {string} field
 * @param {unknown} value
 * @param {{ actor?: string }} [opts]
 */
export async function updateSeoField(store, field, value, opts = {}) {
  const seo = await getSeo(store);
  return saveSeo(store, { ...seo, [field]: value }, opts);
}

/**
 * Build a JSON-LD Restaurant schema from SEO settings.
 * @param {Record<string, unknown>} seo
 */
export function buildRestaurantSchema(seo) {
  const lb = seo.schema_local_business || {};
  return {
    '@context': 'https://schema.org',
    '@type': lb['@type'] || 'Restaurant',
    name: lb.name || seo.site_name || '',
    url: lb.url || seo.site_url || '',
    telephone: lb.telephone || '',
    address: lb.address ? {
      '@type': 'PostalAddress',
      streetAddress: lb.address.streetAddress || '',
      addressLocality: lb.address.addressLocality || '',
      addressRegion: lb.address.addressRegion || 'CA',
      postalCode: lb.address.postalCode || '',
      addressCountry: 'US',
    } : undefined,
    geo: lb.geo ? {
      '@type': 'GeoCoordinates',
      latitude: lb.geo.latitude || '',
      longitude: lb.geo.longitude || '',
    } : undefined,
    openingHoursSpecification: lb.openingHoursSpecification || [],
    priceRange: lb.priceRange || '$$',
    image: seo.og_image || '',
  };
}

/**
 * Build a JSON-LD WebSite schema for the home page.
 * @param {Record<string, unknown>} seo
 */
export function buildWebSiteSchema(seo) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: seo.site_name || '',
    url: seo.site_url || '',
    description: seo.meta_description || seo.site_description || '',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${seo.site_url || ''}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Build robots.txt content from SEO settings.
 * @param {Record<string, unknown>} seo
 */
export function buildRobotsTxt(seo) {
  const robots = seo.robots || {};
  const base = seo.site_url || 'https://www.rawsushibar.com';
  const lines = [
    'User-agent: *',
  ];
  if (!robots.index) lines.push('Disallow: /');
  else if (!robots.follow) lines.push('Disallow:');
  if (robots.sitemap) lines.push(`Sitemap: ${base}/sitemap.xml`);
  lines.push('');
  return lines.join('\n');
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

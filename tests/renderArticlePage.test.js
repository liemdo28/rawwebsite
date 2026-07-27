/**
 * tests/renderArticlePage.test.js — Unit tests for the static article page
 * renderer that closes the "published post has no real URL" gap in the
 * scheduler → gitPublish pipeline (see lib/gitPublish.js).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArticlePage, addUrlToSitemap, buildSitemapEntry } from '../lib/renderArticlePage.js';

const POST = {
  slug: 'test-article-slug',
  title: 'A Test Article Title',
  meta_description: 'A short meta description for the test article.',
  primary_keyword: 'test keyword',
  secondary_keywords: ['second keyword', 'third keyword'],
  image: 'campaign/test-hero.webp',
  image_alt: 'A descriptive alt text for the hero image',
  body: '<p>Body paragraph one.</p><h2>A Heading</h2><p>Body paragraph two.</p>',
  publish_at: '2026-08-01T18:30:00.000Z',
};

test('renderArticlePage: includes correct canonical, title, and meta description', () => {
  const html = renderArticlePage(POST);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.rawsushibar\.com\/test-article-slug\.html">/);
  assert.match(html, /<title>A Test Article Title \| Raw Sushi Bar<\/title>/);
  assert.match(html, /<meta name="description" content="A short meta description for the test article\.">/);
});

test('renderArticlePage: includes og:image and twitter card pointing at the hero image', () => {
  const html = renderArticlePage(POST);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.rawsushibar\.com\/images\/campaign\/test-hero\.webp">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/www\.rawsushibar\.com\/images\/campaign\/test-hero\.webp">/);
  assert.match(html, /<img src="\/images\/campaign\/test-hero\.webp" width="1200" height="630" alt="A descriptive alt text for the hero image"/);
});

test('renderArticlePage: embeds valid Article JSON-LD matching visible content', () => {
  const html = renderArticlePage(POST);
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(match, 'expected a JSON-LD script tag');
  const ld = JSON.parse(match[1]);
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.headline, POST.title);
  assert.equal(ld.mainEntityOfPage, 'https://www.rawsushibar.com/test-article-slug.html');
  assert.equal(ld.datePublished, POST.publish_at);
});

test('renderArticlePage: includes the post body verbatim', () => {
  const html = renderArticlePage(POST);
  assert.match(html, /<h2>A Heading<\/h2>/);
  assert.match(html, /Body paragraph two\./);
});

test('renderArticlePage: adds FAQPage JSON-LD only when schema_type is FAQPage and faq[] is present', () => {
  const withFaq = renderArticlePage({
    ...POST,
    schema_type: 'FAQPage',
    faq: [{ q: 'Do you take reservations?', a: 'Yes, call ahead.' }],
  });
  assert.match(withFaq, /"@type":"FAQPage"/);
  assert.match(withFaq, /Do you take reservations\?/);

  const withoutFaq = renderArticlePage(POST);
  assert.doesNotMatch(withoutFaq, /FAQPage/);
});

test('renderArticlePage: escapes HTML-unsafe characters in title and description', () => {
  const html = renderArticlePage({
    ...POST,
    title: 'Rolls, "Sauce" & <Spice>',
    meta_description: 'A & B "quoted"',
  });
  assert.doesNotMatch(html, /<title>Rolls, "Sauce" & <Spice><\/title>/);
  assert.match(html, /Rolls, &quot;Sauce&quot; &amp; &lt;Spice&gt;/);
});

test('buildSitemapEntry: produces a <url> block with the post URL and lastmod date', () => {
  const entry = buildSitemapEntry(POST);
  assert.match(entry, /<loc>https:\/\/www\.rawsushibar\.com\/test-article-slug\.html<\/loc>/);
  assert.match(entry, /<lastmod>2026-08-01<\/lastmod>/);
});

test('addUrlToSitemap: inserts a new entry before </urlset>', () => {
  const base = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://www.rawsushibar.com/</loc></url>\n</urlset>\n';
  const updated = addUrlToSitemap(base, POST);
  assert.match(updated, /<loc>https:\/\/www\.rawsushibar\.com\/<\/loc>/, 'existing entry preserved');
  assert.match(updated, /<loc>https:\/\/www\.rawsushibar\.com\/test-article-slug\.html<\/loc>/, 'new entry added');
});

test('addUrlToSitemap: is idempotent — running twice does not duplicate the entry', () => {
  const base = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
  const once = addUrlToSitemap(base, POST);
  const twice = addUrlToSitemap(once, POST);
  const count = (twice.match(/test-article-slug\.html/g) || []).length;
  assert.equal(count, 1, 'URL should appear exactly once after re-running');
});

test('addUrlToSitemap: creates a minimal valid sitemap when none exists', () => {
  const created = addUrlToSitemap('', POST);
  assert.match(created, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(created, /test-article-slug\.html/);
});

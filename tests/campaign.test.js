/**
 * tests/campaign.test.js — Validates the 30-article SEO campaign dataset
 * itself (content/campaign/seo-30-article-campaign.mjs) against the schema
 * and invariants the brief requires, using the project's own validatePost()
 * and scoreAgainstPolicy() rather than a hand-rolled duplicate check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePost, scoreAgainstPolicy } from '../lib/posts.js';
import { campaign } from '../content/campaign/seo-30-article-campaign.mjs';
import { toKvRecord } from '../scripts/seed-campaign-kv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

test('campaign: contains exactly 30 articles', () => {
  assert.equal(campaign.length, 30);
});

test('campaign: every slug is unique', () => {
  const slugs = campaign.map(a => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('campaign: publish_at values are strictly increasing with an exact 2-day cadence', () => {
  for (let i = 1; i < campaign.length; i++) {
    const prev = new Date(campaign[i - 1].publish_at);
    const cur = new Date(campaign[i].publish_at);
    const diffDays = (cur - prev) / 86_400_000;
    assert.equal(diffDays, 2, `article ${i} is ${diffDays} days after article ${i - 1}, expected exactly 2`);
  }
});

test('campaign: every publish_at is a valid, parseable ISO timestamp', () => {
  for (const a of campaign) {
    assert.ok(!Number.isNaN(Date.parse(a.publish_at)), `${a.slug} has an invalid publish_at`);
  }
});

test('campaign: every article, once mapped to a KV record, passes validatePost()', () => {
  for (const a of campaign) {
    const record = toKvRecord(a);
    const result = validatePost(record);
    assert.ok(result.ok, `${a.slug} failed validatePost: ${JSON.stringify(result.errors)}`);
  }
});

test('campaign: every article passes the content policy with no hard blocks', () => {
  for (const a of campaign) {
    const record = toKvRecord(a);
    const score = scoreAgainstPolicy(null, record);
    assert.deepEqual(score.hard_blocks, [], `${a.slug} was hard-blocked: ${score.hard_blocks.join(', ')}`);
  }
});

test('campaign: no two articles share the same canonical URL (slug doubles as the canonical path)', () => {
  const canonicals = campaign.map(a => `https://www.rawsushibar.com/${a.slug}.html`);
  assert.equal(new Set(canonicals).size, canonicals.length);
});

test('campaign: every referenced hero image exists on disk as a generated file', () => {
  for (const a of campaign) {
    const p = join(ROOT, 'public', 'images', a.image);
    assert.ok(existsSync(p), `${a.slug} references missing image: public/images/${a.image}`);
    assert.ok(statSync(p).size > 0, `${a.slug} image file is empty: public/images/${a.image}`);
  }
});

test('campaign: every article has a documented cannibalization rationale ("avoids")', () => {
  for (const a of campaign) {
    assert.ok(typeof a.avoids === 'string' && a.avoids.length > 20, `${a.slug} is missing an "avoids" rationale`);
  }
});

test('campaign: internal links only point to slugs that exist either in this campaign or in the pre-existing site', () => {
  const campaignSlugs = new Set(campaign.map(a => `/${a.slug}.html`));
  const linkPattern = /href="(\/[a-z0-9/-]+(?:\.html)?\/?)"/g;
  for (const a of campaign) {
    let m;
    linkPattern.lastIndex = 0;
    while ((m = linkPattern.exec(a.body))) {
      const href = m[1];
      if (href === '/') continue;
      const existsAsCampaignArticle = campaignSlugs.has(href);
      const relPath = href.replace(/^\//, '');
      const existsAsLegacyHtmlPage = existsSync(join(ROOT, 'public', relPath));
      const existsAsLegacyDirPage = existsSync(join(ROOT, 'public', relPath, 'index.html'));
      assert.ok(
        existsAsCampaignArticle || existsAsLegacyHtmlPage || existsAsLegacyDirPage,
        `${a.slug} links to ${href}, which is neither another campaign article nor an existing public/ page`,
      );
    }
  }
});

/**
 * Publication-aware link validation (added after the 2026-07-28 soft-404
 * incident): a source article must never link to a campaign article whose
 * publish_at is later than the source's own publish_at. A reader following
 * a link from an already-live article must always land on real, live
 * content — never a not-yet-published slug. Legacy (pre-existing) pages are
 * always fine to link to, since they're live for the whole campaign window.
 */
test('campaign: no article links to a campaign article scheduled to publish after it (no forward links)', () => {
  const campaignBySlug = new Map(campaign.map(a => [a.slug, a]));
  const linkPattern = /href="\/([a-z0-9-]+)\.html"/g;
  const violations = [];
  for (const a of campaign) {
    let m;
    linkPattern.lastIndex = 0;
    while ((m = linkPattern.exec(a.body))) {
      const targetSlug = m[1];
      const target = campaignBySlug.get(targetSlug);
      if (!target) continue; // legacy page, not subject to this rule
      if (new Date(target.publish_at) > new Date(a.publish_at)) {
        violations.push(`${a.slug} (due ${a.publish_at}) links to ${targetSlug} (due ${target.publish_at}), which is not yet published at that time`);
      }
    }
  }
  assert.deepEqual(violations, [], `Forward links found:\n${violations.join('\n')}`);
});

test('campaign: every campaign-to-campaign link points backward in time or is a same-article self-reference', () => {
  const campaignBySlug = new Map(campaign.map(a => [a.slug, a]));
  const linkPattern = /href="\/([a-z0-9-]+)\.html"/g;
  let checkedAtLeastOne = false;
  for (const a of campaign) {
    let m;
    linkPattern.lastIndex = 0;
    while ((m = linkPattern.exec(a.body))) {
      const target = campaignBySlug.get(m[1]);
      if (!target) continue;
      checkedAtLeastOne = true;
      assert.ok(
        new Date(target.publish_at).getTime() <= new Date(a.publish_at).getTime(),
        `${a.slug} -> ${target.slug}: target publishes after source`,
      );
    }
  }
  assert.ok(checkedAtLeastOne, 'sanity check: expected at least one campaign-to-campaign link to exist and be checked');
});

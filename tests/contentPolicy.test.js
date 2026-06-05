/**
 * tests/contentPolicy.test.js — Unit tests for the content policy scorer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { scorePost, setPolicy, resetPolicyCache } = await import('../lib/contentPolicy.js');

// Inline policy for tests (mirrors config/content_policy.json)
const POLICY = {
  stores: {
    raw_stockton: { city: 'Stockton' },
    raw_modesto: { city: 'Modesto' },
  },
  tone: {},
  safety: {
    strict_block: true,
    blocked_terms: [
      'kill', 'murder', 'shoot', 'bomb', 'attack',
      'weed', 'marijuana', 'cannabis', 'cocaine', 'drug',
      'cure cancer', 'prevent disease', 'treat diabetes',
    ],
    fake_claim_terms: [
      'best in the world',
      'only place',
      'guaranteed',
    ],
  },
  seo: {
    rules: {
      min_body_chars: 50,
      max_body_chars: 280,
      max_keyword_repeat: 3,
    },
  },
  scoring: {
    pass_threshold: 60,
    weights: {
      has_location: 20,
      has_primary_keyword: 20,
      has_cta: 15,
      brand_tone_ok: 15,
      readable_length: 10,
      no_keyword_stuffing: 10,
      no_fake_claims: 10,
    },
  },
};

function goodPost() {
  return {
    title: 'Best Sushi in Stockton Tonight',
    body: 'Looking for the best sushi in Stockton tonight? Visit us at 10742 Trinity Parkway. Order online for pickup or delivery. We use only the freshest fish and our chefs have over 20 years of experience. Call (209) 954-9729 today.',
    cta: 'Order now',
    cta_url: 'https://order.toasttab.com/online/raw-sushi-bistro-10742-trinity-pkwy-ste-d',
    primary_keyword: 'sushi in Stockton',
    slug: 'best-sushi-in-stockton',
    location_slug: 'raw_stockton',
  };
}

// Setup: inject policy before tests run
setPolicy(POLICY);

test('scorePost: clean Stockton post passes', () => {
  resetPolicyCache();
  setPolicy(POLICY);
  const r = scorePost(null, goodPost());
  assert.equal(r.hard_blocks.length, 0);
  assert.ok(r.score >= 60, 'expected score >= 60, got ' + r.score);
  assert.equal(r.passed, true);
});

test('scorePost: hard block on banned term', () => {
  resetPolicyCache();
  setPolicy(POLICY);
  const p = goodPost();
  p.body = p.body + ' Our chef will kill the competition!';
  const r = scorePost(null, p);
  assert.ok(r.hard_blocks.length > 0, 'expected hard block');
  assert.equal(r.score, 0);
  assert.equal(r.passed, false);
});

test('scorePost: hard block on fake claim', () => {
  resetPolicyCache();
  setPolicy(POLICY);
  const p = goodPost();
  p.body = p.body + ' Guaranteed freshness every time!';
  const r = scorePost(null, p);
  assert.ok(r.hard_blocks.length > 0, 'expected hard block on fake_claim term');
  assert.equal(r.score, 0);
});

test('scorePost: missing location lowers score', () => {
  resetPolicyCache();
  setPolicy(POLICY);
  const p = {
    title: 'A generic post with no city',
    body: 'A generic sushi post with no city name and no clear CTA in it anywhere today friends.',
    cta: '',
    cta_url: '',
    primary_keyword: 'sushi somewhere',
    slug: 'generic-post',
    location_slug: 'raw_stockton',
  };
  const r = scorePost(null, p);
  assert.ok(r.soft_failures.includes('missing_location'),
    'expected missing_location, got: ' + JSON.stringify(r.soft_failures));
});

test('scorePost: body length outside [50,280] lowers score', () => {
  resetPolicyCache();
  setPolicy(POLICY);
  const p = goodPost();
  p.body = 'Short.';
  const r = scorePost(null, p);
  assert.ok(r.soft_failures.some(s => s.startsWith('bad_length:')),
    'expected bad_length soft failure, got: ' + JSON.stringify(r.soft_failures));
});

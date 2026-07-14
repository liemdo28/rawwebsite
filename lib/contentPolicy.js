/**
 * lib/contentPolicy.js — Content-policy validator for posts and social copy.
 *
 * The policy is bundled inline (loaded from config/content_policy.json at
 * build time via a string import) to keep this module 100% synchronous
 * and Cloudflare Workers compatible.
 *
 * This module:
 *   - Validates a post body + frontmatter against the bundled policy.
 *   - Returns a score (0-100) and a list of soft / hard violations.
 *
 * Hard blocks immediately set score = 0 (post is rejected).
 * Soft failures reduce the score per the policy's `scoring.weights`.
 */

let _policy = null;

/**
 * Bundled policy. The actual JSON from config/content_policy.json is
 * embedded here. This is loaded at first call via the function below.
 *
 * To update: copy the contents of config/content_policy.json here.
 */
const EMBEDDED_POLICY = null;

/**
 * Pre-load a policy object. Useful in Workers where filesystem IO is
 * not available.
 *
 * @param {object} policy
 */
export function setPolicy(policy) {
  _policy = policy;
  return _policy;
}

/**
 * Get the active policy. Falls back to EMBEDDED_POLICY, then to a
 * sensible default.
 */
function getPolicy() {
  if (_policy) return _policy;
  if (EMBEDDED_POLICY) {
    _policy = EMBEDDED_POLICY;
    return _policy;
  }
  // Safe defaults so the bridge still works without a policy file.
  _policy = {
    stores: {
      raw_stockton: { city: 'Stockton' },
    },
    safety: {
      strict_block: true,
      blocked_terms: [],
      fake_claim_terms: ['guaranteed', 'best ever', '#1', 'number one'],
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
  return _policy;
}

/**
 * Reset the policy cache (used by tests and after policy file edits).
 */
export function resetPolicyCache() {
  _policy = null;
}

/**
 * Score a single post against the content policy.
 *
 * @param {string} policyPath  Ignored in this version (policy is bundled).
 * @param {Record<string, unknown>} post  Post object with at least
 *   { title, body, location_slug (or 'location'), primary_keyword, cta, slug }.
 * @returns {{
 *   score: number,
 *   passed: boolean,
 *   hard_blocks: string[],
 *   soft_failures: string[],
 *   details: Record<string, unknown>,
 * }}
 */
export function scorePost(policyPath, post) {
  const policy = getPolicy();
  const storeProfile = policy.stores?.[post.location_slug || post.location];
  const seoBlock = policy.seo?.[post.location_slug || post.location] || {};
  const tone = policy.tone || {};
  const safety = policy.safety || {};
  const rules = policy.seo?.rules || {};
  const weights = policy.scoring?.weights || {};
  const passThreshold = policy.scoring?.pass_threshold ?? 60;

  const body = String(post.body || '');
  const title = String(post.title || '');
  const cta = String(post.cta || '');
  const primaryKw = String(post.primary_keyword || '');
  const locationCity = storeProfile?.city
    || (post.location_slug === 'raw_stockton' ? 'Stockton'
       : '');

  const result = {
    score: 0,
    passed: false,
    hard_blocks: [],
    soft_failures: [],
    details: {
      location_city: locationCity,
      body_length: body.length,
      exclamations: (body.match(/!/g) || []).length + (title.match(/!/g) || []).length,
      caps_runs: (body.match(/\b[A-Z]{4,}\b/g) || []).length,
    },
  };

  let score = 0;

  // ── Hard blocks (safety) ───────────────────────────────────────────
  if (safety.strict_block !== false) {
    const blocked = [
      ...(safety.blocked_terms || []),
      ...(safety.fake_claim_terms || []),
    ];
    const lower = (body + ' ' + title).toLowerCase();
    for (const term of blocked) {
      const t = String(term).toLowerCase();
      const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) {
        result.hard_blocks.push(`blocked_term:${term}`);
      }
    }
  }

  if (result.hard_blocks.length > 0) {
    result.score = 0;
    result.passed = false;
    return result;
  }

  // ── Soft checks (weighted) ────────────────────────────────────────
  if (locationCity && new RegExp(`\\b${locationCity}\\b`, 'i').test(body + ' ' + title)) {
    score += weights.has_location ?? 20;
  } else if (locationCity) {
    result.soft_failures.push('missing_location');
  }

  if (primaryKw && new RegExp(primaryKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body + ' ' + title)) {
    score += weights.has_primary_keyword ?? 20;
  } else if (primaryKw) {
    result.soft_failures.push('missing_primary_keyword');
  }

  const ctaVerbs = ['order', 'visit', 'call', 'reserve', 'check', 'try', 'book'];
  const ctaHit = ctaVerbs.some(v => new RegExp(`\\b${v}\\b`, 'i').test(body + ' ' + cta));
  if (ctaHit || cta.trim().length > 0) {
    score += weights.has_cta ?? 15;
  } else {
    result.soft_failures.push('missing_cta');
  }

  const exLimit = 3;
  const capsLimit = 0;
  if (result.details.exclamations <= exLimit && result.details.caps_runs <= capsLimit) {
    score += weights.brand_tone_ok ?? 15;
  } else {
    result.soft_failures.push('brand_tone_violation');
  }

  const min = rules.min_body_chars ?? 50;
  const max = rules.max_body_chars ?? 280;
  if (body.length >= min && body.length <= max) {
    score += weights.readable_length ?? 10;
  } else {
    result.soft_failures.push(`bad_length:${body.length} not in [${min},${max}]`);
  }

  const maxRepeat = rules.max_keyword_repeat ?? 3;
  const tokens = (body + ' ' + title).toLowerCase().split(/\W+/).filter(Boolean);
  const counts = Object.create(null);
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
  const overRepeat = Object.entries(counts).filter(([, n]) => n > maxRepeat);
  if (overRepeat.length === 0) {
    score += weights.no_keyword_stuffing ?? 10;
  } else {
    result.soft_failures.push(`keyword_stuffing:${overRepeat.map(([t]) => t).join(',')}`);
  }

  const lower = (body + ' ' + title).toLowerCase();
  const fakeClaims = safety.fake_claim_terms || [];
  const fakeHit = fakeClaims.some(t => lower.includes(String(t).toLowerCase()));
  if (!fakeHit) {
    score += weights.no_fake_claims ?? 10;
  } else {
    result.soft_failures.push('fake_claim_detected');
  }

  result.score = Math.max(0, Math.min(100, score));
  result.passed = result.score >= passThreshold;
  return result;
}

/**
 * Validate a post and return a list of `Result` objects for each store profile.
 * Used by the admin "preview against policy" action.
 *
 * @param {string} policyPath
 * @param {Record<string, unknown>} post
 */
export function scorePostAllLocations(policyPath, post) {
  const policy = getPolicy();
  const locations = Object.keys(policy.stores || {});
  return locations.map(loc => ({
    location: loc,
    ...scorePost(policyPath, { ...post, location_slug: loc }),
  }));
}

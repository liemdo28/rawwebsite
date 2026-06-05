/**
 * lib/schedulerAuth.js — service-token auth for scheduler calls.
 */

import { timingSafeEqual } from './config.js';

/**
 * Verify scheduler Bearer token.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @returns {string|null}
 */
export function verifyScheduler(request, env = {}) {
  const expected = env.RAWWEBSITE_SCHEDULER_TOKEN
    || env.SCHEDULER_TOKEN
    || (typeof process !== 'undefined' ? process.env.RAWWEBSITE_SCHEDULER_TOKEN : '');
  if (!expected || typeof expected !== 'string') return null;
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  return timingSafeEqual(token, expected) ? 'scheduler:github-actions' : null;
}

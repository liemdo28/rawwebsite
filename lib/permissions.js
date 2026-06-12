/**
 * lib/permissions.js — Role-based permission system.
 *
 * Roles:
 *   - admin: Full access to everything
 *   - editor: Create, edit, delete content; cannot publish
 *   - reviewer: Can approve/reject content
 *   - publisher: Can publish approved content
 *   - readonly: Read-only access to all content
 *
 * Permission matrix:
 *   - posts.read, posts.create, posts.update, posts.delete
 *   - posts.submit_review, posts.approve, posts.reject, posts.publish
 *   - pages.read, pages.create, pages.update, pages.delete
 *   - pages.submit_review, pages.approve, pages.reject, pages.publish
 *   - media.read, media.upload, media.delete
 *   - menu.read, menu.create, menu.update, menu.delete
 *   - theme.read, theme.update
 *   - seo.read, seo.update
 *   - redirects.read, redirects.create, redirects.update, redirects.delete
 *   - analytics.read, analytics.update
 *   - audit.read
 *   - scheduler.run
 */

export const ROLES = ['admin', 'editor', 'reviewer', 'publisher', 'readonly'];

export const PERMISSION_MATRIX = {
  admin: {
    // Posts
    'posts.read': true,
    'posts.create': true,
    'posts.update': true,
    'posts.delete': true,
    'posts.submit_review': true,
    'posts.approve': true,
    'posts.reject': true,
    'posts.publish': true,
    'posts.rollback': true,
    // Pages
    'pages.read': true,
    'pages.create': true,
    'pages.update': true,
    'pages.delete': true,
    'pages.submit_review': true,
    'pages.approve': true,
    'pages.reject': true,
    'pages.publish': true,
    'pages.rollback': true,
    // Media
    'media.read': true,
    'media.upload': true,
    'media.delete': true,
    // Menu
    'menu.read': true,
    'menu.create': true,
    'menu.update': true,
    'menu.delete': true,
    // Theme
    'theme.read': true,
    'theme.update': true,
    // SEO
    'seo.read': true,
    'seo.update': true,
    // Redirects
    'redirects.read': true,
    'redirects.create': true,
    'redirects.update': true,
    'redirects.delete': true,
    'redirects.import': true,
    // Analytics
    'analytics.read': true,
    'analytics.update': true,
    // Audit
    'audit.read': true,
    // System
    'scheduler.run': true,
    'system.export': true,
    'system.import': true,
  },
  editor: {
    'posts.read': true,
    'posts.create': true,
    'posts.update': true,
    'posts.delete': true,
    'posts.submit_review': true,
    'posts.approve': false,
    'posts.reject': false,
    'posts.publish': false,
    'posts.rollback': false,
    'pages.read': true,
    'pages.create': true,
    'pages.update': true,
    'pages.delete': true,
    'pages.submit_review': true,
    'pages.approve': false,
    'pages.reject': false,
    'pages.publish': false,
    'pages.rollback': false,
    'media.read': true,
    'media.upload': true,
    'media.delete': false,
    'menu.read': true,
    'menu.create': true,
    'menu.update': true,
    'menu.delete': false,
    'theme.read': true,
    'theme.update': false,
    'seo.read': true,
    'seo.update': false,
    'redirects.read': true,
    'redirects.create': false,
    'redirects.update': false,
    'redirects.delete': false,
    'redirects.import': false,
    'analytics.read': true,
    'analytics.update': false,
    'audit.read': false,
    'scheduler.run': false,
    'system.export': false,
    'system.import': false,
  },
  reviewer: {
    'posts.read': true,
    'posts.create': false,
    'posts.update': false,
    'posts.delete': false,
    'posts.submit_review': false,
    'posts.approve': true,
    'posts.reject': true,
    'posts.publish': false,
    'posts.rollback': false,
    'pages.read': true,
    'pages.create': false,
    'pages.update': false,
    'pages.delete': false,
    'pages.submit_review': false,
    'pages.approve': true,
    'pages.reject': true,
    'pages.publish': false,
    'pages.rollback': false,
    'media.read': true,
    'media.upload': false,
    'media.delete': false,
    'menu.read': true,
    'menu.create': false,
    'menu.update': false,
    'menu.delete': false,
    'theme.read': true,
    'theme.update': false,
    'seo.read': true,
    'seo.update': false,
    'redirects.read': true,
    'redirects.create': false,
    'redirects.update': false,
    'redirects.delete': false,
    'redirects.import': false,
    'analytics.read': false,
    'analytics.update': false,
    'audit.read': true,
    'scheduler.run': false,
    'system.export': false,
    'system.import': false,
  },
  publisher: {
    'posts.read': true,
    'posts.create': false,
    'posts.update': false,
    'posts.delete': false,
    'posts.submit_review': false,
    'posts.approve': false,
    'posts.reject': false,
    'posts.publish': true,
    'posts.rollback': true,
    'pages.read': true,
    'pages.create': false,
    'pages.update': false,
    'pages.delete': false,
    'pages.submit_review': false,
    'pages.approve': false,
    'pages.reject': false,
    'pages.publish': true,
    'pages.rollback': true,
    'media.read': true,
    'media.upload': false,
    'media.delete': false,
    'menu.read': true,
    'menu.create': false,
    'menu.update': false,
    'menu.delete': false,
    'theme.read': true,
    'theme.update': false,
    'seo.read': true,
    'seo.update': false,
    'redirects.read': true,
    'redirects.create': false,
    'redirects.update': false,
    'redirects.delete': false,
    'redirects.import': false,
    'analytics.read': false,
    'analytics.update': false,
    'audit.read': false,
    'scheduler.run': true,
    'system.export': false,
    'system.import': false,
  },
  readonly: {
    'posts.read': true,
    'posts.create': false,
    'posts.update': false,
    'posts.delete': false,
    'posts.submit_review': false,
    'posts.approve': false,
    'posts.reject': false,
    'posts.publish': false,
    'posts.rollback': false,
    'pages.read': true,
    'pages.create': false,
    'pages.update': false,
    'pages.delete': false,
    'pages.submit_review': false,
    'pages.approve': false,
    'pages.reject': false,
    'pages.publish': false,
    'pages.rollback': false,
    'media.read': true,
    'media.upload': false,
    'media.delete': false,
    'menu.read': true,
    'menu.create': false,
    'menu.update': false,
    'menu.delete': false,
    'theme.read': true,
    'theme.update': false,
    'seo.read': true,
    'seo.update': false,
    'redirects.read': true,
    'redirects.create': false,
    'redirects.update': false,
    'redirects.delete': false,
    'redirects.import': false,
    'analytics.read': true,
    'analytics.update': false,
    'audit.read': false,
    'scheduler.run': false,
    'system.export': false,
    'system.import': false,
  },
};

/**
 * Check if a role has a specific permission.
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!ROLES.includes(role)) return false;
  const perms = PERMISSION_MATRIX[role];
  return perms && perms[permission] === true;
}

/**
 * Get all permissions for a role.
 * @param {string} role
 * @returns {string[]}
 */
export function getPermissions(role) {
  if (!ROLES.includes(role)) return [];
  const perms = PERMISSION_MATRIX[role];
  return Object.keys(perms).filter(p => perms[p] === true);
}

/**
 * Verify request has required permission.
 * Returns { allowed: true, actor } or { allowed: false, error }.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {string} permission
 */
export function verifyPermission(request, env, permission) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { allowed: false, error: 'unauthorized', status: 401 };
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return { allowed: false, error: 'token_required', status: 401 };
  }

  // Check admin token
  const adminSecret = env.RAWWEBSITE_ADMIN_SECRET || env.ADMIN_SECRET;
  if (adminSecret && token === adminSecret) {
    return { allowed: true, actor: 'admin', role: 'admin' };
  }

  // Check role-specific tokens
  for (const role of ROLES) {
    const roleKey = `RAWWEBSITE_${role.toUpperCase()}_TOKEN`;
    const roleSecret = env[roleKey];
    if (roleSecret && token === roleSecret) {
      if (hasPermission(role, permission)) {
        return { allowed: true, actor: role, role };
      } else {
        return { allowed: false, error: 'forbidden', status: 403, role };
      }
    }
  }

  return { allowed: false, error: 'invalid_token', status: 401 };
}

/**
 * Generate a permission matrix report.
 */
export function generatePermissionMatrixReport() {
  const lines = [
    '# Permission Matrix Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Roles',
    '',
  ];

  for (const role of ROLES) {
    const perms = getPermissions(role);
    lines.push(`### ${role.charAt(0).toUpperCase() + role.slice(1)}`);
    lines.push('');
    lines.push(`Total permissions: ${perms.length}`);
    lines.push('');
    lines.push('| Permission | Allowed |');
    lines.push('|------------|---------|');
    for (const [perm, allowed] of Object.entries(PERMISSION_MATRIX[role])) {
      lines.push(`| ${perm} | ${allowed ? '✅' : '❌'} |`);
    }
    lines.push('');
  }

  lines.push('## Permission Coverage Matrix');
  lines.push('');
  lines.push('| Permission | Admin | Editor | Reviewer | Publisher | ReadOnly |');
  lines.push('|------------|-------|--------|----------|-----------|----------|');

  const allPerms = Object.keys(PERMISSION_MATRIX.admin);
  for (const perm of allPerms) {
    const row = [perm];
    for (const role of ROLES) {
      row.push(PERMISSION_MATRIX[role][perm] ? '✅' : '❌');
    }
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines.join('\n');
}

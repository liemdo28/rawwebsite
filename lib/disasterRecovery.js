/**
 * lib/disasterRecovery.js — Export/import all content for backup and restore.
 *
 * Features:
 *   - Export all tables to JSON
 *   - Import from JSON backup
 *   - Validate integrity after restore
 *   - Supports incremental and full backups
 */

import { listTables } from './store.js';
import { record } from './auditLog.js';

/**
 * Export all content from the store.
 * @param {any} store
 * @param {{ actor?: string }} [opts]
 */
export async function exportAll(store, opts = {}) {
  const tables = listTables();
  const backup = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    exported_by: opts.actor || 'system',
    tables: {},
    counts: {},
    checksums: {},
  };

  for (const table of tables) {
    const rows = await store.list(table);
    backup.tables[table] = rows;
    backup.counts[table] = rows.length;
    backup.checksums[table] = simpleChecksum(JSON.stringify(rows));
  }

  // Get state
  if (store.getState) {
    backup.state = await store.getState();
  }

  await record(store, {
    actor: opts.actor || 'system',
    action: 'system.export',
    target_type: 'backup',
    target_id: 'full',
    meta: {
      tables: tables.length,
      total_rows: Object.values(backup.counts).reduce((a, b) => a + b, 0),
    },
  });

  return backup;
}

/**
 * Import content from a backup.
 * @param {any} store
 * @param {Record<string, unknown>} backup
 * @param {{ actor?: string, mode?: 'replace'|'merge' }} [opts]
 */
export async function importAll(store, backup, opts = {}) {
  const mode = opts.mode || 'replace';
  const results = {
    imported_at: new Date().toISOString(),
    imported_by: opts.actor || 'system',
    mode,
    tables: {},
    errors: [],
  };

  if (!backup.tables) {
    results.errors.push('backup_missing_tables');
    return results;
  }

  for (const [table, rows] of Object.entries(backup.tables)) {
    try {
      if (!Array.isArray(rows)) {
        results.errors.push({ table, error: 'rows_not_array' });
        continue;
      }

      if (mode === 'replace' && store.replaceAll) {
        await store.replaceAll(table, rows);
        results.tables[table] = { mode: 'replaced', count: rows.length };
      } else {
        // Merge mode: upsert each row
        let merged = 0;
        for (const row of rows) {
          if (row && row.id) {
            await store.upsert(table, row);
            merged++;
          }
        }
        results.tables[table] = { mode: 'merged', count: merged };
      }
    } catch (e) {
      results.errors.push({ table, error: e.message });
    }
  }

  // Restore state if present
  if (backup.state && store.setState) {
    try {
      await store.setState(backup.state);
      results.state_restored = true;
    } catch (e) {
      results.errors.push({ table: 'state', error: e.message });
    }
  }

  await record(store, {
    actor: opts.actor || 'system',
    action: 'system.import',
    target_type: 'backup',
    target_id: mode,
    meta: {
      tables: Object.keys(results.tables).length,
      errors: results.errors.length,
      mode,
    },
  });

  return results;
}

/**
 * Validate backup integrity against current store.
 * @param {any} store
 * @param {Record<string, unknown>} backup
 */
export async function validateIntegrity(store, backup) {
  const results = {
    validated_at: new Date().toISOString(),
    matches: {},
    mismatches: [],
    missing_tables: [],
    extra_tables: [],
  };

  const currentTables = listTables();
  const backupTables = Object.keys(backup.tables || {});

  // Check for missing tables in backup
  for (const table of currentTables) {
    if (!backupTables.includes(table)) {
      results.missing_tables.push(table);
    }
  }

  // Check for extra tables in backup
  for (const table of backupTables) {
    if (!currentTables.includes(table)) {
      results.extra_tables.push(table);
    }
  }

  // Validate each table
  for (const table of currentTables) {
    if (!backup.tables[table]) continue;

    const currentRows = await store.list(table);
    const backupRows = backup.tables[table];
    const currentChecksum = simpleChecksum(JSON.stringify(currentRows));
    const backupChecksum = backup.checksums?.[table] || simpleChecksum(JSON.stringify(backupRows));

    if (currentChecksum === backupChecksum) {
      results.matches[table] = {
        count: currentRows.length,
        checksum: currentChecksum,
      };
    } else {
      results.mismatches.push({
        table,
        current_count: currentRows.length,
        backup_count: backupRows.length,
        current_checksum: currentChecksum,
        backup_checksum: backupChecksum,
      });
    }
  }

  results.is_valid = results.mismatches.length === 0 && results.missing_tables.length === 0;
  return results;
}

/**
 * Create an incremental backup (only changed rows since last backup).
 * @param {any} store
 * @param {string} since ISO timestamp
 * @param {{ actor?: string }} [opts]
 */
export async function exportIncremental(store, since, opts = {}) {
  const tables = listTables();
  const sinceDate = new Date(since);
  const backup = {
    version: '1.0',
    type: 'incremental',
    since,
    exported_at: new Date().toISOString(),
    exported_by: opts.actor || 'system',
    tables: {},
    counts: {},
  };

  for (const table of tables) {
    const rows = await store.list(table);
    const changedRows = rows.filter(r => {
      const updated = r.updated_at || r.created_at;
      return updated && new Date(updated) > sinceDate;
    });
    if (changedRows.length > 0) {
      backup.tables[table] = changedRows;
      backup.counts[table] = changedRows.length;
    }
  }

  await record(store, {
    actor: opts.actor || 'system',
    action: 'system.export_incremental',
    target_type: 'backup',
    target_id: 'incremental',
    meta: {
      since,
      total_rows: Object.values(backup.counts).reduce((a, b) => a + b, 0),
    },
  });

  return backup;
}

/**
 * Simple checksum for integrity validation.
 * @param {string} str
 */
function simpleChecksum(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Generate disaster recovery report.
 * @param {any} store
 */
export async function generateDRReport(store) {
  const tables = listTables();
  const lines = [
    '# Disaster Recovery Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Current Data Summary',
    '',
    '| Table | Rows | Last Updated |',
    '|-------|------|--------------|',
  ];

  for (const table of tables) {
    const rows = await store.list(table);
    const lastUpdated = rows.length > 0
      ? rows.reduce((max, r) => {
          const d = r.updated_at || r.created_at || '';
          return d > max ? d : max;
        }, '')
      : 'N/A';
    lines.push(`| ${table} | ${rows.length} | ${lastUpdated || 'N/A'} |`);
  }

  lines.push('');
  lines.push('## Backup Procedures');
  lines.push('');
  lines.push('### Full Backup');
  lines.push('```bash');
  lines.push('curl -X GET https://www.rawsushibar.com/api/system/export \\');
  lines.push('  -H "Authorization: Bearer $ADMIN_TOKEN" \\');
  lines.push('  -o backup-$(date +%Y%m%d).json');
  lines.push('```');
  lines.push('');
  lines.push('### Restore from Backup');
  lines.push('```bash');
  lines.push('curl -X POST https://www.rawsushibar.com/api/system/import \\');
  lines.push('  -H "Authorization: Bearer $ADMIN_TOKEN" \\');
  lines.push('  -H "Content-Type: application/json" \\');
  lines.push('  -d @backup.json');
  lines.push('```');
  lines.push('');
  lines.push('### Validate Integrity');
  lines.push('```bash');
  lines.push('curl -X POST https://www.rawsushibar.com/api/system/validate \\');
  lines.push('  -H "Authorization: Bearer $ADMIN_TOKEN" \\');
  lines.push('  -H "Content-Type: application/json" \\');
  lines.push('  -d @backup.json');
  lines.push('```');

  return lines.join('\n');
}

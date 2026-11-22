#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup, restoreBackup, verifyBackup } from './wayline-backup.mjs';

/**
 * Rehearses the backup/restore path on synthetic files only: create, verify, detect tampering,
 * restore cleanly, and confirm the restored bytes match. Nothing here touches real credentials.
 */
function drill() {
  const root = mkdtempSync(join(tmpdir(), 'wayline-backup-drill-'));
  try {
    const source = join(root, '.wayline-private');
    mkdirSync(join(source, 'calendars'), { recursive: true });
    writeFileSync(join(source, 'token.json'), JSON.stringify({ scope: 'calendar', value: 'synthetic' }));
    writeFileSync(join(source, 'calendars', 'primary.json'), JSON.stringify({ events: 2 }));
    const expected = {
      'token.json': readFileSync(join(source, 'token.json'), 'utf8'),
      'calendars/primary.json': readFileSync(join(source, 'calendars', 'primary.json'), 'utf8'),
    };

    const { target } = createBackup(source, join(root, 'backups'), 'drill');
    const clean = verifyBackup(target);
    if (clean.problems.length || clean.manifest.files.length !== 2) throw new Error(`干净备份校验失败：${clean.problems.join('; ')}`);

    writeFileSync(join(target, 'data', 'token.json'), '{"value":"tampered"}');
    const tampered = verifyBackup(target);
    if (!tampered.problems.some(problem => problem.includes('校验和不符'))) throw new Error('篡改未被发现');
    let refused = false;
    try { restoreBackup(target, join(root, 'restored')); } catch { refused = true; }
    if (!refused) throw new Error('损坏备份仍然被恢复');

    const second = createBackup(source, join(root, 'backups'), 'drill-clean');
    const restored = restoreBackup(second.target, join(root, 'restored'));
    for (const [path, content] of Object.entries(expected)) {
      if (!existsSync(join(restored, path)) || readFileSync(join(restored, path), 'utf8') !== content)
        throw new Error(`恢复内容不一致：${path}`);
    }
    console.log('PASS: 备份、校验、篡改检测与恢复演练均通过');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  drill();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}

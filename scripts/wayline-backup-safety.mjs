#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup, verifyBackup, assertSafeRestoreTarget } from './wayline-backup.mjs';

/**
 * Exercises hostile restore inputs on synthetic fixtures inside the OS temp directory.
 * No real user directory is ever deleted or overwritten.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const throws = (fn, hint) => {
  try { fn(); } catch { return; }
  throw new Error(`预期拒绝但未拒绝：${hint}`);
};
const problemsOf = backup => verifyBackup(backup).problems.join('; ');

const root = mkdtempSync(join(tmpdir(), 'wayline-backup-safety-'));
const source = join(root, '.wayline-private');
const backups = join(root, 'backups');
mkdirSync(join(source, 'nested'), { recursive: true });
writeFileSync(join(source, 'token.json'), '{"scope":"calendar","value":"synthetic"}');
writeFileSync(join(source, 'nested', 'primary.json'), '{"events":2}');
const { target: backup } = createBackup(source, backups, 'safe');

function fork(name, mutate) {
  const copy = join(root, `fork-${name}`);
  cpSync(backup, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'));
  mutate(manifest, copy);
  writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return copy;
}

scenario('拒绝危险恢复目标', () => {
  for (const target of ['/', homedir(), PROJECT_ROOT, dirname(PROJECT_ROOT), '/etc']) {
    throws(() => assertSafeRestoreTarget(target), target);
  }
  // Even with --force the guard must still reject protected locations.
  throws(() => restoreBackup(backup, PROJECT_ROOT, { force: true }), 'force + project root');
  check(!readdirSync(PROJECT_ROOT).some(name => name.startsWith('.wayline-restore-')), '不得在项目根写入暂存目录');
});

scenario('拒绝源目录与备份目录重叠', () => {
  throws(() => createBackup(source, source), 'dest = source');
  throws(() => createBackup(source, join(source, 'inner')), 'dest inside source');
  throws(() => createBackup(source, dirname(source)), 'source inside dest');
  throws(() => restoreBackup(backup, join(backup, 'restore')), 'target inside backup');
  throws(() => restoreBackup(backup, dirname(backup)), 'target contains backup');
});

scenario('拒绝恶意 manifest 路径', () => {
  const absolute = fork('absolute', manifest => { manifest.files[0].path = '/tmp/evil'; });
  const traversal = fork('traversal', manifest => { manifest.files[0].path = '../evil'; });
  const nestedTraversal = fork('nested-traversal', manifest => { manifest.files[0].path = 'a/../../evil'; });
  const duplicate = fork('duplicate', manifest => { manifest.files[1].path = manifest.files[0].path; });
  const backslash = fork('backslash', manifest => { manifest.files[0].path = 'nested\\primary.json'; });
  const badHash = fork('bad-hash', manifest => { manifest.files[0].sha256 = 'xyz'; });
  const badBytes = fork('bad-bytes', manifest => { manifest.files[0].bytes = '12'; });
  const badType = fork('bad-type', manifest => { manifest.files[0].type = 'directory'; });
  const badTotal = fork('bad-total', manifest => { manifest.totalFiles = 99; });
  const badSource = fork('bad-source', manifest => { manifest.source = '../outside'; });
  for (const [label, path] of Object.entries({ absolute, traversal, nestedTraversal, duplicate, backslash, badHash, badBytes, badType, badTotal, badSource })) {
    throws(() => verifyBackup(path), label);
    throws(() => restoreBackup(path, join(root, `restore-${label}`)), label);
    check(!existsSync(join(root, `restore-${label}`)), `恶意 manifest 不得产生恢复目录：${label}`);
  }
});

scenario('检测字节数、额外文件与符号链接', () => {
  const bytes = fork('bytes', (manifest, copy) => { writeFileSync(join(copy, 'data', 'token.json'), '{"tampered":true}'); });
  check(problemsOf(bytes).includes('字节数不符'), '字节数不符未被发现');
  const extra = fork('extra', (manifest, copy) => { writeFileSync(join(copy, 'data', 'nested', 'extra.json'), '{}'); });
  check(problemsOf(extra).includes('多出'), '额外文件未被发现');
  const link = fork('symlink', (manifest, copy) => { symlinkSync('/etc/hosts', join(copy, 'data', 'nested', 'link.json')); });
  check(problemsOf(link).includes('符号链接'), '符号链接未被发现');
  throws(() => restoreBackup(link, join(root, 'restore-symlink')), '含符号链接的备份');
});

scenario('拒绝备份源中的符号链接与非普通文件', () => {
  const unsafe = join(root, 'unsafe-source');
  mkdirSync(unsafe, { recursive: true });
  writeFileSync(join(unsafe, 'ok.json'), '{}');
  symlinkSync('/etc/hosts', join(unsafe, 'link.json'));
  throws(() => createBackup(unsafe, join(root, 'unsafe-backups'), 'link'), '符号链接源');
  const fifo = join(root, 'unsafe-source-fifo');
  mkdirSync(fifo, { recursive: true });
  const made = spawnSync('mkfifo', [join(fifo, 'pipe')], { encoding: 'utf8' });
  if (made.status === 0) throws(() => createBackup(fifo, join(root, 'fifo-backups'), 'fifo'), 'FIFO 源');
});

scenario('force 覆盖必须通过暂存校验且保留旧数据', () => {
  const target = join(root, 'existing');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'keep.txt'), 'old');
  throws(() => restoreBackup(backup, target), '非空目标未加 --force');
  check(readFileSync(join(target, 'keep.txt'), 'utf8') === 'old', '拒绝时不得修改目标');
  restoreBackup(backup, target, { force: true });
  check(readFileSync(join(target, 'token.json'), 'utf8').includes('synthetic'), '强制恢复内容不正确');
  check(!existsSync(join(target, 'keep.txt')), '强制恢复后旧文件应被替换');
  check(!readdirSync(root).some(name => name.startsWith('.wayline-retired-')), '不应遗留 retired 目录');
});

scenario('部分失败时目标保持不变', () => {
  const broken = fork('unreadable', (manifest, copy) => { chmodSync(join(copy, 'data', 'token.json'), 0o000); });
  const target = join(root, 'preserved');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'keep.txt'), 'intact');
  throws(() => restoreBackup(broken, target, { force: true }), '不可读备份文件');
  check(readFileSync(join(target, 'keep.txt'), 'utf8') === 'intact', '失败后目标内容被破坏');
  chmodSync(join(broken, 'data', 'token.json'), 0o600);

  const readonlyParent = join(root, 'readonly');
  mkdirSync(readonlyParent, { recursive: true });
  chmodSync(readonlyParent, 0o555);
  try {
    throws(() => restoreBackup(backup, join(readonlyParent, 'restored'), { force: true }), '只读父目录');
  } finally {
    chmodSync(readonlyParent, 0o755);
  }
});

scenario('路径别名与符号链接不能绕过安全检查', () => {
  const homeLink = join(root, 'home-link');
  symlinkSync(homedir(), homeLink);
  throws(() => assertSafeRestoreTarget(homeLink), 'home alias');
  throws(() => restoreBackup(backup, homeLink, { force: true }), 'restore via home alias');
  const projectLink = join(root, 'project-link');
  symlinkSync(PROJECT_ROOT, projectLink);
  throws(() => assertSafeRestoreTarget(projectLink), 'project alias');
  throws(() => restoreBackup(backup, projectLink, { force: true }), 'restore via project alias');
  const dangling = join(root, 'target-link');
  symlinkSync(join(root, 'real-target'), dangling);
  throws(() => restoreBackup(backup, dangling), 'target itself is a symlink');

  const safeDir = join(root, 'safe-dir');
  mkdirSync(safeDir, { recursive: true });
  const safeLink = join(root, 'safe-link');
  symlinkSync(safeDir, safeLink);
  restoreBackup(backup, join(safeLink, 'restored'));
  check(existsSync(join(safeDir, 'restored', 'token.json')), '指向普通临时目录的别名应可恢复');
});

scenario('备份 label 不能构造路径穿越', () => {
  throws(() => createBackup(source, backups, '../../evil'), 'label traversal');
  throws(() => createBackup(source, backups, 'a/b'), 'label slash');
  throws(() => createBackup(source, backups, ''), 'empty label');
  check(!existsSync(join(root, 'evil')), '不得在目标目录外写入');
});

try {
  for (const item of scenarios) {
    item.fn();
    console.log(`PASS ${item.name}`);
  }
  console.log('PASS: 备份恢复安全演练全部通过');
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}

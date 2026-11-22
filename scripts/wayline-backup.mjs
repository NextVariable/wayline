#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Walks regular files only; symlinks are skipped so a backup can never follow a link outside the data dir. */
function walk(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walk(root, path));
    else if (entry.isFile()) files.push({ path: relative(root, path).split('\\').join('/'), bytes: statSync(path).size, sha256: sha256(path) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function createBackup(source, dest, label = 'manual') {
  const from = resolve(source);
  if (!existsSync(from)) throw new Error(`备份源不存在：${source}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(resolve(dest), `wayline-${label}-${stamp}`);
  mkdirSync(target, { recursive: true });
  cpSync(from, join(target, 'data'), { recursive: true });
  const manifest = { version: 1, createdAt: new Date().toISOString(), source: basename(from), files: walk(join(target, 'data')) };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { target, manifest };
}

export function verifyBackup(backup) {
  const root = resolve(backup);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`缺少 manifest.json：${backup}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = [];
  const kept = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    const path = join(root, 'data', file.path);
    if (!existsSync(path)) { problems.push(`缺失 ${file.path}`); continue; }
    if (sha256(path) !== file.sha256) problems.push(`校验和不符 ${file.path}`);
  }
  for (const file of walk(join(root, 'data'))) if (!kept.has(file.path)) problems.push(`多出 ${file.path}`);
  return { manifest, problems };
}

export function restoreBackup(backup, into, { force = false } = {}) {
  const root = resolve(backup);
  const target = resolve(into);
  const { problems } = verifyBackup(root);
  if (problems.length) throw new Error(`备份校验失败：\n${problems.join('\n')}`);
  if (existsSync(target) && !force && readdirSync(target).length) throw new Error(`目标目录非空：${into}（使用 --force 覆盖）`);
  if (existsSync(target) && force) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(root, 'data'), target, { recursive: true });
  return target;
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  try {
    if (command === 'create') {
      const source = arg('source') ?? '.wayline-private';
      const dest = arg('dest');
      if (!dest) throw new Error('请提供 --dest（建议在仓库之外）');
      const { target, manifest } = createBackup(source, dest, arg('label') ?? 'manual');
      console.log(`PASS: 已备份 ${manifest.files.length} 个文件到 ${target}`);
    } else if (command === 'verify') {
      const backup = arg('backup');
      if (!backup) throw new Error('请提供 --backup');
      const { manifest, problems } = verifyBackup(backup);
      if (problems.length) { for (const problem of problems) console.error(`FAIL ${problem}`); process.exitCode = 1; }
      else console.log(`PASS: ${manifest.files.length} 个文件校验一致（${manifest.createdAt}）`);
    } else if (command === 'restore') {
      const backup = arg('backup');
      const into = arg('into');
      if (!backup || !into) throw new Error('请提供 --backup 与 --into');
      const target = restoreBackup(backup, into, { force: process.argv.includes('--force') });
      console.log(`PASS: 已恢复到 ${target}`);
    } else {
      console.error('用法：wayline-backup.mjs create --source .wayline-private --dest <dir> | verify --backup <dir> | restore --backup <dir> --into <dir> [--force]');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

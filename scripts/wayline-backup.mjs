#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HASH = /^[0-9a-f]{64}$/i;

function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertNoOverlap(left, right, label) {
  if (inside(left, right) || inside(right, left)) throw new Error(`${label} 存在重叠：${left} ↔ ${right}`);
}

/** Rejects system or user locations where a restore could destroy unrelated data. */
export function assertSafeRestoreTarget(into) {
  const target = resolve(into);
  if (target === parse(target).root) throw new Error(`拒绝恢复到文件系统根目录：${target}`);
  if (existsSync(target) && !statSync(target).isDirectory()) throw new Error(`恢复目标不是目录：${target}`);
  const protectedPaths = [homedir(), PROJECT_ROOT, process.cwd()].map(path => resolve(path));
  for (const guarded of protectedPaths) {
    if (target === guarded) throw new Error(`拒绝恢复到受保护目录：${target}`);
    if (inside(target, guarded)) throw new Error(`拒绝恢复到受保护目录的上级：${target}`);
  }
  for (const guarded of ['/etc', '/usr', '/bin', '/sbin', '/var', '/System', '/Applications', '/Library']) {
    if (target === guarded) throw new Error(`拒绝恢复到系统目录：${target}`);
  }
  return target;
}

/** Strict POSIX path validation for manifest entries. */
function normalizeEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || !entryPath) throw new Error('manifest 路径必须是非空字符串');
  if (entryPath.includes('\0')) throw new Error(`manifest 路径包含空字符：${entryPath}`);
  if (entryPath.includes('\\')) throw new Error(`manifest 路径不能包含反斜杠：${entryPath}`);
  if (isAbsolute(entryPath) || /^[a-zA-Z]:/.test(entryPath)) throw new Error(`manifest 路径不能是绝对路径：${entryPath}`);
  const normalized = posix.normalize(entryPath);
  if (normalized !== entryPath) throw new Error(`manifest 路径未规范化：${entryPath}`);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error(`manifest 路径越界：${entryPath}`);
  if (normalized.startsWith('/')) throw new Error(`manifest 路径越界：${entryPath}`);
  return normalized;
}

/** Walks regular files and records symlinks or other special entries instead of following them. */
function inspect(root, current = root, out = { files: [], anomalies: [] }) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const name = relative(root, path).split(sep).join('/');
    if (entry.isSymbolicLink()) { out.anomalies.push(`符号链接 ${name}`); continue; }
    if (entry.isDirectory()) { inspect(root, path, out); continue; }
    if (!entry.isFile()) { out.anomalies.push(`非普通文件 ${name}`); continue; }
    out.files.push({ path: name, type: 'file', bytes: statSync(path).size, sha256: sha256(path) });
  }
  out.files.sort((left, right) => left.path.localeCompare(right.path));
  return out;
}

function validateManifest(manifest, root) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest 必须是对象');
  if (manifest.version !== 1) throw new Error(`不支持的 manifest 版本：${manifest.version}`);
  if (!Array.isArray(manifest.files)) throw new Error('manifest.files 必须是数组');
  const seen = new Set();
  for (const [index, entry] of manifest.files.entries()) {
    if (!entry || typeof entry !== 'object') throw new Error(`manifest.files[${index}] 必须是对象`);
    const path = normalizeEntryPath(entry.path);
    if (seen.has(path)) throw new Error(`manifest 存在重复路径：${path}`);
    seen.add(path);
    if (entry.type !== undefined && entry.type !== 'file') throw new Error(`manifest 条目不是普通文件：${path}`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`manifest 字节数无效：${path}`);
    if (typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) throw new Error(`manifest SHA256 无效：${path}`);
  }
  if (manifest.totalFiles !== undefined && manifest.totalFiles !== manifest.files.length) {
    throw new Error(`manifest 文件数量不一致：${manifest.totalFiles} ≠ ${manifest.files.length}`);
  }
  if (manifest.source !== undefined && typeof manifest.source !== 'string') throw new Error('manifest.source 必须是字符串');
  if (manifest.source === '..' || manifest.source?.includes('/') || manifest.source?.includes('\\')) {
    throw new Error(`manifest.source 非法：${manifest.source}`);
  }
  return manifest;
}

function readManifest(root) {
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`缺少 manifest.json：${root}`);
  if (!lstatSync(manifestPath).isFile()) throw new Error(`manifest.json 不是普通文件：${root}`);
  return validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), root);
}

function copyManifestFiles(fromData, toData, manifest) {
  for (const entry of manifest.files) {
    const source = join(fromData, entry.path);
    const target = join(toData, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

/** Creates a manifest-backed backup using only regular files; symlinks are rejected. */
export function createBackup(source, dest, label = 'manual') {
  const from = resolve(source);
  if (!existsSync(from)) throw new Error(`备份源不存在：${source}`);
  const sourceStat = lstatSync(from);
  if (sourceStat.isSymbolicLink()) throw new Error(`备份源不能是符号链接：${source}`);
  if (!sourceStat.isDirectory()) throw new Error(`备份源不是目录：${source}`);
  const destRoot = resolve(dest);
  assertNoOverlap(from, destRoot, '备份源与目标目录');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(destRoot, `wayline-${label}-${stamp}`);
  assertNoOverlap(from, target, '备份源与备份目录');
  const { files, anomalies } = inspect(from);
  if (anomalies.length) throw new Error(`备份源包含异常条目：\n${anomalies.join('\n')}`);
  if (existsSync(destRoot) && !statSync(destRoot).isDirectory()) throw new Error(`备份目标不是目录：${dest}`);
  mkdirSync(destRoot, { recursive: true });
  mkdirSync(target, { recursive: false });
  const dataDir = join(target, 'data');
  mkdirSync(dataDir, { recursive: true });
  for (const file of files) {
    const to = join(dataDir, file.path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(from, file.path), to);
  }
  const copied = inspect(dataDir);
  if (copied.anomalies.length) throw new Error(`备份包含异常条目：\n${copied.anomalies.join('\n')}`);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: basename(from),
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { target, manifest };
}

/** Verifies manifest, file count, type, byte size and SHA256 without writing anything. */
export function verifyBackup(backup) {
  const root = resolve(backup);
  if (existsSync(root) && !statSync(root).isDirectory()) throw new Error(`备份路径不是目录：${backup}`);
  const manifest = readManifest(root);
  const dataDir = join(root, 'data');
  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) throw new Error(`缺少备份数据目录：${backup}`);
  const problems = [];
  const kept = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    const path = join(dataDir, file.path);
    if (!existsSync(path)) { problems.push(`缺失 ${file.path}`); continue; }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) { problems.push(`文件类型异常 ${file.path}`); continue; }
    if (stat.size !== file.bytes) problems.push(`字节数不符 ${file.path}`);
    if (sha256(path) !== file.sha256) problems.push(`校验和不符 ${file.path}`);
  }
  const actual = inspect(dataDir);
  for (const anomaly of actual.anomalies) problems.push(`异常条目 ${anomaly}`);
  for (const file of actual.files) if (!kept.has(file.path)) problems.push(`多出 ${file.path}`);
  if (manifest.totalFiles !== undefined && actual.files.length !== manifest.totalFiles) {
    problems.push(`文件数量不符：${actual.files.length} ≠ ${manifest.totalFiles}`);
  }
  if (manifest.totalBytes !== undefined && actual.files.reduce((sum, file) => sum + file.bytes, 0) !== manifest.totalBytes) {
    problems.push('总字节数不符');
  }
  return { manifest, problems };
}

/** Restores into an isolated staging directory, verifies it, then swaps it in. */
export function restoreBackup(backup, into, { force = false } = {}) {
  const root = resolve(backup);
  const target = assertSafeRestoreTarget(into);
  assertNoOverlap(root, target, '备份目录与恢复目标');
  const { problems } = verifyBackup(root);
  if (problems.length) throw new Error(`备份校验失败：\n${problems.join('\n')}`);
  if (existsSync(target) && readdirSync(target).length && !force) throw new Error(`目标目录非空：${into}（使用 --force 覆盖）`);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, '.wayline-restore-'));
  try {
    copyManifestFiles(join(root, 'data'), stage, readManifest(root));
    const staged = inspect(stage);
    const manifest = readManifest(root);
    const expected = new Map(manifest.files.map(file => [file.path, file]));
    if (staged.anomalies.length) throw new Error(`暂存目录包含异常条目：\n${staged.anomalies.join('\n')}`);
    if (staged.files.length !== manifest.files.length) throw new Error('暂存文件数量与 manifest 不一致');
    for (const file of staged.files) {
      const want = expected.get(file.path);
      if (!want) throw new Error(`暂存目录出现未声明文件：${file.path}`);
      if (file.bytes !== want.bytes) throw new Error(`暂存字节数不一致：${file.path}`);
      if (file.sha256 !== want.sha256) throw new Error(`暂存校验和不一致：${file.path}`);
    }
    const retired = join(parent, `.wayline-retired-${randomUUID()}`);
    const hadTarget = existsSync(target);
    if (hadTarget) renameSync(target, retired);
    try {
      renameSync(stage, target);
    } catch (error) {
      if (hadTarget) renameSync(retired, target);
      throw error;
    }
    if (hadTarget) rmSync(retired, { recursive: true, force: true });
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
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

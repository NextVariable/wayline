#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** Reads a private env file without exporting anything to the shell history. */
export function parseEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

/**
 * Validates the release environment without echoing secret values. Errors block a staging start;
 * warnings allow map or mail features to stay degraded.
 */
export function checkReleaseEnv(env) {
  const errors = [], warnings = [], notes = [];
  const origin = env.PUBLIC_ORIGIN?.trim();
  let parsed;
  if (!origin) {
    (env.NODE_ENV === 'production' ? errors : warnings).push('PUBLIC_ORIGIN 未设置');
  } else {
    try { parsed = new URL(origin); } catch { errors.push('PUBLIC_ORIGIN 不是合法 URL'); }
    if (parsed) {
      if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password)
        errors.push('PUBLIC_ORIGIN 必须是纯站点根地址');
      const loopback = LOOPBACK.has(parsed.hostname);
      if (!loopback && parsed.protocol !== 'https:') errors.push('非本机 PUBLIC_ORIGIN 必须使用 https');
      if (loopback) notes.push('PUBLIC_ORIGIN 指向本机，仅用于本地验证');
    }
  }
  const host = env.HOST?.trim() || '127.0.0.1';
  if (!LOOPBACK.has(host) && !env.WEB_ACCESS_PASSWORD?.trim())
    errors.push('对外监听（HOST 非本机）时必须设置 WEB_ACCESS_PASSWORD');
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!!clientId !== !!clientSecret) errors.push('GOOGLE_CLIENT_ID 与 GOOGLE_CLIENT_SECRET 必须成对配置');
  if (clientId && clientSecret) {
    const redirect = env.GOOGLE_REDIRECT_URI?.trim();
    const expected = parsed ? `${parsed.origin}/api/calendar/google/callback` : undefined;
    if (redirect && expected && redirect !== expected) errors.push(`GOOGLE_REDIRECT_URI 必须为 ${expected}`);
    notes.push('已配置 Google OAuth，请确认上述回调地址已加入 Google 控制台');
  }
  if (!(env.AMAP_WEB_SERVICE_KEY?.trim() || env.AMAP_KEY?.trim()))
    warnings.push('未配置高德 Web 服务 Key，路线与地点搜索会降级');
  for (const key of ['API_RATE_LIMIT_PER_MINUTE', 'API_SITE_LIMIT_PER_MINUTE', 'API_FETCH_LIMIT_PER_MINUTE']) {
    const value = env[key]?.trim();
    if (value && !(Number.isInteger(Number(value)) && Number(value) > 0)) errors.push(`${key} 必须是正整数`);
  }
  return { errors, warnings, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--env-file');
  const env = index >= 0 ? parseEnvFile(process.argv[index + 1]) : process.env;
  const { errors, warnings, notes } = checkReleaseEnv(env);
  for (const note of notes) console.log(`NOTE ${note}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  for (const error of errors) console.error(`FAIL ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log(`PASS: 环境变量检查通过（${warnings.length} 项警告，${notes.length} 项提示）`);
}

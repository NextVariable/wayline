import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

it('serves account routes from the main server module', () => {
  const src = source('server/index.mjs');
  expect(src).toMatch(/from ["']\.\/accounts\.mjs["']/);
  expect(src).toMatch(/accounts\.handle\(request, ?response\)/);
  // The Google callback carries its own browser-bound state, like the calendar callback.
  expect(src).toMatch(/startsWith\("\/api\/auth\/google\/callback\?"\) && await accounts\.handle/);
});
it('documents the sign-in settings', () => {
  const env = source('.env.example');
  for (const key of ['ACCOUNT_DATA_DIR', 'GOOGLE_SIGNIN_REDIRECT_URI']) expect(env).toContain(key);
  expect(source('README.md')).toContain('/api/auth/google/callback');
});

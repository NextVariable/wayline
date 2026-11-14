import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AccountEntry} from '../components/AccountEntry';

const noop = () => {};

it('invites a guest to sign in from the workspace entry', () => {
  const html = renderToStaticMarkup(<AccountEntry status="guest" onOpen={noop} />);
  expect(html).toContain('登录');
  expect(html).toContain('aria-label="登录，资料与备份"');
});

it('shows the signed-in account initial and names the account', () => {
  const html = renderToStaticMarkup(<AccountEntry status="signed-in" email="lin@example.com" onOpen={noop} />);
  expect(html).toContain('>L<');
  expect(html).toContain('aria-label="账号 lin@example.com"');
  expect(html).not.toContain('>登录<');
});

it('keeps the plain backup entry when sign-in is unavailable or still loading', () => {
  for (const status of ['unavailable', 'loading'] as const) {
    const html = renderToStaticMarkup(<AccountEntry status={status} onOpen={noop} />);
    expect(html).toContain('aria-label="资料与备份"');
    expect(html).not.toContain('>登录<');
  }
});

import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ComponentProps} from 'react';
import {AuthPanel} from '../components/AuthPanel';
import {ToastProvider} from '../components/Toast';
import {guestUser} from '../lib/userStorage';

const noop = () => {};
const render = (patch: Partial<ComponentProps<typeof AuthPanel>>) => {
  const props: ComponentProps<typeof AuthPanel> = {
    user: guestUser, onLogin: noop, open: true, onClose: noop, getFootprints: async () => ({format: 'whereto-footprints', version: 1, tracks: [], visits: [], activeId: null} as any),
    accountStatus: 'guest', syncState: 'off', onSignIn: noop, onSignOut: noop, ...patch,
  };
  return renderToStaticMarkup(<ToastProvider><AuthPanel {...props} /></ToastProvider>);
};

it('offers Google sign-in to a guest and no local space creation', () => {
  const html = render({});
  expect(html).toContain('用 Google 登录');
  expect(html).toContain('登录后可跨设备恢复资料，并在日历来源中连接 Google 日历');
  expect(html).not.toContain('新建本地空间');
});

it('shows the account email, sync state and sign-out when signed in', () => {
  const html = render({accountStatus: 'signed-in', accountEmail: 'a@example.com', syncState: 'idle', user: {id: 'google:abc', label: 'a@example.com', method: 'google'}});
  expect(html).toContain('a@example.com');
  expect(html).toContain('已同步');
  expect(html).toContain('退出');
  expect(html).not.toContain('用 Google 登录');
  expect(html).not.toContain('资料保存在此浏览器');
});

it('names each sync state in plain words', () => {
  const user = {id: 'google:abc', label: 'a@example.com', method: 'google' as const};
  expect(render({accountStatus: 'signed-in', user, syncState: 'offline'})).toContain('未同步（离线）');
  expect(render({accountStatus: 'signed-in', user, syncState: 'syncing'})).toContain('同步中');
  expect(render({accountStatus: 'signed-in', user, syncState: 'conflict'})).toContain('同步暂停 · 本机修改已保留');
});

it('lets a signed-in user return to their account from a restored local space', () => {
  const html = render({accountStatus:'signed-in', user:{id:'local:restored',label:'恢复副本',method:'local'}, syncState:'idle', onReturnToAccount:noop});
  expect(html).toContain('当前查看本机空间');
  expect(html).toContain('返回账号空间');
  expect(html).not.toContain('已同步');
});

it('shows unavailable sign-in when Google is not configured', () => {
  const html = render({accountStatus: 'unavailable'});
  expect(html).toContain('登录暂不可用');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>登录暂不可用<\/button>/);
});

it('still offers backup export and restore', () => {
  const html = render({});
  expect(html).toContain('导出全部资料');
  expect(html).toContain('恢复备份');
  expect(html).toContain('aria-label="选择空间备份"');
});

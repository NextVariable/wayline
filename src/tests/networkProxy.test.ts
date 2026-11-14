import {it,expect,vi} from 'vitest';
// @ts-expect-error Server ESM exercised directly.
import {configureNetworkProxy} from '../../server/network-proxy.mjs';
it('uses the configured proxy while bypassing loopback and retaining existing exclusions',()=>{
  const apply=vi.fn();const env={HTTPS_PROXY:'http://127.0.0.1:7890',NO_PROXY:'internal.example,localhost'};
  expect(configureNetworkProxy(env,apply)).toBe(true);
  expect(apply.mock.calls[0][0]).toMatchObject({HTTPS_PROXY:env.HTTPS_PROXY,NO_PROXY:'internal.example,localhost,127.0.0.1,::1',no_proxy:'internal.example,localhost,127.0.0.1,::1'});
  expect(env.NO_PROXY).toBe('internal.example,localhost');
});
it('respects lowercase proxy exclusions and an explicit opt-out',()=>{
  const apply=vi.fn();configureNetworkProxy({https_proxy:'http://localhost:7890',NO_PROXY:'ignored',no_proxy:'keep.example'},apply);
  expect(apply.mock.calls[0][0].no_proxy).toContain('keep.example');expect(apply.mock.calls[0][0].no_proxy).not.toContain('ignored');
  apply.mockClear();expect(configureNetworkProxy({HTTPS_PROXY:'http://localhost:7890',NODE_USE_ENV_PROXY:'0'},apply)).toBe(false);expect(apply).not.toHaveBeenCalled();
});
it('does not override networking without an explicit proxy or a supported runtime',()=>{
  const apply=vi.fn();expect(configureNetworkProxy({},apply)).toBe(false);expect(apply).not.toHaveBeenCalled();
  expect(configureNetworkProxy({HTTPS_PROXY:'http://localhost:7890'},undefined)).toBe(false);
});

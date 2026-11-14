// Reuse an explicitly configured process proxy; never discover or change OS settings.
export function configureNetworkProxy(env, apply) {
  if (env.NODE_USE_ENV_PROXY === '0' || typeof apply !== 'function') return false;
  if (!(env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY)) return false;
  const bypass = [...new Set([
    ...(env.no_proxy || env.NO_PROXY || '').split(',').map(value => value.trim()).filter(Boolean),
    'localhost', '127.0.0.1', '::1',
  ])].join(',');
  apply({ ...env, NO_PROXY: bypass, no_proxy: bypass });
  return true;
}

/** Browser requests stay on the deployed website; development loopback URLs never ship as remote service destinations. */
export function apiEndpoint(action: string, configured?: string): string {
  const fallback = `/api/${action}`;
  if (!configured?.trim()) return fallback;
  const value = configured.trim();
  if (value.startsWith('/api/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return fallback;
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Invalid or insecure configuration falls back to the website's server. */ }
  return fallback;
}

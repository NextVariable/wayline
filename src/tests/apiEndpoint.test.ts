import { describe, expect, it } from 'vitest';
import { apiEndpoint } from '../lib/apiEndpoint';
describe('website service destinations', () => {
  it.each([undefined, '', 'http://127.0.0.1:8787/api/plan', 'http://localhost:8787/api/plan', 'https://[::1]/api/plan', 'http://remote.example/api/plan', '//evil.example/api/plan', 'https://user:password@remote.example/api/plan'])('keeps unsafe or local configuration on the website: %s', value => {
    expect(apiEndpoint('plan', value)).toBe('/api/plan');
  });
  it('allows a configured HTTPS service', () => expect(apiEndpoint('extract', 'https://api.example.com/api/extract')).toBe('https://api.example.com/api/extract'));
  it('preserves a same-origin API path', () => expect(apiEndpoint('plan', '/api/plan')).toBe('/api/plan'));
});

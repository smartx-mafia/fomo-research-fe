import {afterEach, describe, expect, it, vi} from 'vitest';
import {GET} from './route.dev';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SERIALIZED_AUDIT_API_KEY;
  delete process.env.SERIALIZED_AUDIT_ALLOW_DECOMPILE;
});

describe('Serialized Audit dev route', () => {
  it('injects the server-only key and maps the chain without exposing it in the response', async () => {
    process.env.SERIALIZED_AUDIT_API_KEY = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({audit: {isSafe: true}}));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/serialized-audit?chain=ethereum&address=0x1111111111111111111111111111111111111111'));

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get('chain')).toBe('ETH');
    expect(url.searchParams.get('allow_decompile')).toBe('true');
    expect(new Headers(init.headers).get('X-Auth-Key')).toBe('test-secret');
    expect(await response.text()).not.toContain('test-secret');
  });

  it('rejects invalid input before spending an upstream request', async () => {
    process.env.SERIALIZED_AUDIT_API_KEY = 'test-secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/serialized-audit?chain=robinhood&address=not-an-address'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

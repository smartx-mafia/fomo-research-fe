import {afterEach, describe, expect, it, vi} from 'vitest';

import {BUSINESS_API_BASE, sameBusinessEnvironment} from '../config';
import {assertNoMixedContent, call} from './envelope';

describe('business API browser-direct transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('expands a contract path to the real backend origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      msg: 'success',
      data: {identifier: 'user-1'},
    }), {status: 200, headers: {'content-type': 'application/json'}}));
    vi.stubGlobal('fetch', fetchMock);

    await call<{identifier: string}>('/v1/user/info', {bearer: 'test-jwt'});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BUSINESS_API_BASE}/v1/user/info`);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({authorization: 'Bearer test-jwt'});
  });

  it('fails loudly before an HTTPS page tries to call an HTTP API', () => {
    expect(() => assertNoMixedContent(new URL('http://api.example/v1/ping'), 'https:')).toThrow(
      /NEXT_PUBLIC_BUSINESS_API_BASE with an HTTPS origin/,
    );
    expect(() => assertNoMixedContent(new URL('http://api.example/v1/ping'), 'http:')).not.toThrow();
    expect(() => assertNoMixedContent(new URL('https://api.example/v1/ping'), 'https:')).not.toThrow();
  });

  it('treats the raw test address and its HTTPS gateway as the same JWT environment', () => {
    expect(sameBusinessEnvironment('http://35.78.100.24', 'https://sm-test-api.smartx.io/')).toBe(true);
    expect(sameBusinessEnvironment('https://api.example', 'https://other.example')).toBe(false);
  });
});

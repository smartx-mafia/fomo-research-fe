import {afterEach, describe, expect, it, vi} from 'vitest';
import {applyMedia, getMediaUpload, uploadMedia} from './profile-media';
import {ApiError} from './envelope';

afterEach(() => vi.unstubAllGlobals());
function response(data: unknown) {return new Response(JSON.stringify({code: 200, data}), {status: 200});}
describe('profile media HTTP contract', () => {
  it('sends exactly one file with stable operation ID and leaves multipart headers to the browser', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({status: 'pending', operation_id: 'operation-12345678'})));
    vi.stubGlobal('fetch', fetcher);
    const file = new File(['image'], 'background.png', {type: 'image/png'});
    await uploadMedia('jwt', 'background', file, 'operation-12345678');
    await uploadMedia('jwt', 'background', file, 'operation-12345678');
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(fetcher.mock.calls[0][0]).toMatch(/\/v1\/profile\/media\/background\/uploads$/);
    expect(options.headers).toMatchObject({'authorization': 'Bearer jwt', 'Idempotency-Key': 'operation-12345678'});
    expect(new Headers(options.headers).has('content-type')).toBe(false);
    expect(Array.from((options.body as FormData).keys())).toEqual(['file']);
    expect((options.body as FormData).get('file')).toEqual(file);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe('operation-12345678');
    expect(fetcher.mock.calls[1][1].headers['x-request-id']).not.toBe((options.headers as Record<string, string>)['x-request-id']);
  });
  it('preserves code=200 rejected results instead of treating them as saved assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({operation_id: 'operation-12345678', status: 'rejected', charged: true})));
    expect((await getMediaUpload('jwt', 'avatar', 'operation-12345678')).data.status).toBe('rejected');
  });
  it('applies only an asset ID as JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({user: {identifier: 'me'}}));
    vi.stubGlobal('fetch', fetcher);
    await applyMedia('jwt', 'avatar', 'asset');
    expect(fetcher.mock.calls[0][1].body).toBe('{"asset_id":"asset"}');
    expect(fetcher.mock.calls[0][1].headers['content-type']).toBe('application/json');
  });
  it('retains structured validation errors and the backend trace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 100138, msg: 'internal', metadata: {reason: 'too_large'}, trace_id: 'trace'}))));
    await expect(uploadMedia('jwt', 'avatar', new File(['bad'], 'a.png'), 'operation-12345678')).rejects.toMatchObject({code: 100138, metadata: {reason: 'too_large'}, traceID: 'trace'} satisfies Partial<ApiError>);
  });
});

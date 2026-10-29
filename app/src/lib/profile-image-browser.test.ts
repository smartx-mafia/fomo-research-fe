// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {exportProfileCrop, readProfileImage} from './profile-image';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it('decodes a small SVG source over 10 MiB without signature, size or pixel restrictions', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {static createObjectURL = () => 'blob:source'; static revokeObjectURL = revoke;});
  vi.stubGlobal('Image', class {
    naturalWidth = 80; naturalHeight = 40;
    onload?: () => void;
    set src(_value: string) {queueMicrotask(() => this.onload?.());}
  });
  const file = new File(['<svg/>'], 'source.svg', {type: 'image/svg+xml'});
  Object.defineProperty(file, 'size', {value: 20 * 1024 * 1024});
  const result = await readProfileImage(file);
  expect(result.image.naturalWidth).toBe(80);
  expect(revoke).not.toHaveBeenCalled();
});

it('still reports browser decode failure and releases the preview URL', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {static createObjectURL = () => 'blob:source'; static revokeObjectURL = revoke;});
  vi.stubGlobal('Image', class {
    onerror?: () => void;
    set src(_value: string) {queueMicrotask(() => this.onerror?.());}
  });
  await expect(readProfileImage(new File(['broken'], 'image'))).rejects.toThrow('Can’t read');
  expect(revoke).toHaveBeenCalledWith('blob:source');
});

it.each(['avatar', 'background'] as const)('upscales a tiny crop at 25x zoom for %s', async (purpose) => {
  const image = new Image();
  Object.defineProperties(image, {naturalWidth: {value: 80}, naturalHeight: {value: 40}});
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage: draw} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['pixels'], {type: 'image/png'})));
  const file = await exportProfileCrop(image, purpose, 25, 0.5, 0.5);
  expect(file.type).toBe('image/png');
  const args = draw.mock.calls[0];
  expect(args[3]).toBeLessThan(4);
  expect(args[4]).toBeLessThan(4);
  expect(args.slice(-2)).toEqual(purpose === 'avatar' ? [512, 512] : [1500, 500]);
});

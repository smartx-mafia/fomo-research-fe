import {describe, expect, it} from 'vitest';
import {ApiError} from '@/api/envelope';
import {cropRectangle, MAX_IMAGE_BYTES, mediaErrorMessage, staticImageType, validateImageDimensions, validateImageSize} from './profile-image';

describe('profile image validation', () => {
  it('accepts exactly 10 MiB and rejects one byte more and empty files', () => {
    expect(() => validateImageSize(MAX_IMAGE_BYTES)).not.toThrow();
    expect(() => validateImageSize(MAX_IMAGE_BYTES + 1)).toThrow('Max 10MB');
    expect(() => validateImageSize(0)).toThrow('Can’t read');
  });
  it('detects supported signatures and rejects GIF and SVG without trusting file extensions', () => {
    expect(staticImageType(Uint8Array.from([255, 216, 255]).buffer)).toBe('image/jpeg');
    expect(() => staticImageType(new TextEncoder().encode('GIF89a').buffer)).toThrow('Unsupported');
    expect(() => staticImageType(new TextEncoder().encode('<svg/>').buffer)).toThrow('Unsupported');
  });
  it('rejects APNG and animated WebP before they can be flattened by canvas', () => {
    const png = Uint8Array.from([137,80,78,71,13,10,26,10, 0,0,0,0, 97,99,84,76, 0,0,0,0]);
    expect(() => staticImageType(png.buffer)).toThrow('Unsupported');
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    webp[16] = 10; webp[20] = 2;
    expect(() => staticImageType(webp.buffer)).toThrow('Unsupported');
    webp[20] = 0;
    expect(staticImageType(webp.buffer)).toBe('image/webp');
  });
  it('checks minimum, strict ratio, side and combined pixel limits', () => {
    expect(() => validateImageDimensions('avatar', 200, 200)).not.toThrow();
    expect(() => validateImageDimensions('background', 600, 200)).not.toThrow();
    expect(() => validateImageDimensions('background', 601, 200)).toThrow('3:1');
    expect(() => validateImageDimensions('avatar', 199, 199)).toThrow('at least');
    expect(() => validateImageDimensions('avatar', 4096, 4096)).toThrow('size limits');
    expect(() => validateImageDimensions('background', 8100, 2700)).toThrow('size limits');
  });
  it('keeps the crop within the original image and obeys the fixed ratio', () => {
    expect(cropRectangle(1600, 900, 3, 1, 0.5, 0.5)).toEqual({x: 0, y: (900 - 1600 / 3) / 2, width: 1600, height: 1600 / 3});
    expect(cropRectangle(1000, 1000, 1, 2, 1, 0)).toEqual({x: 500, y: 0, width: 500, height: 500});
  });
  it('does not expose backend msg and handles unknown reasons safely', () => {
    expect(mediaErrorMessage(new ApiError('business', 100138, 'private detail', undefined, undefined, undefined, undefined, {reason: 'new_reason'}))).not.toContain('private detail');
    expect(mediaErrorMessage(new ApiError('business', 100138, 'wrong', undefined, undefined, undefined, undefined, {reason: 'read_failed'}))).toBe('Can’t read this image. Choose another.');
  });
});

import {describe, expect, it} from 'vitest';
import {ApiError} from '@/api/envelope';
import {cropRectangle, mediaErrorMessage} from './profile-image';

describe('profile image validation', () => {
  it('keeps the crop within the original image and obeys the fixed ratio', () => {
    expect(cropRectangle(1600, 900, 3, 1, 0.5, 0.5)).toEqual({x: 0, y: (900 - 1600 / 3) / 2, width: 1600, height: 1600 / 3});
    expect(cropRectangle(1000, 1000, 1, 2, 1, 0)).toEqual({x: 500, y: 0, width: 500, height: 500});
  });
  it('does not expose backend msg and handles unknown reasons safely', () => {
    expect(mediaErrorMessage(new ApiError('business', 100138, 'private detail', undefined, undefined, undefined, undefined, {reason: 'new_reason'}))).not.toContain('private detail');
    expect(mediaErrorMessage(new ApiError('business', 100138, 'wrong', undefined, undefined, undefined, undefined, {reason: 'read_failed'}))).toBe('Can’t read this image. Choose another.');
  });
});

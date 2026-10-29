import {ApiError} from '@/api/envelope';
import type {MediaPurpose} from '@/api/profile-media';

export const IMAGE_RULES = {
  avatar: {ratio: 1, width: 512, height: 512},
  background: {ratio: 3, width: 1500, height: 500},
};
export class ImageValidationError extends Error {}

export async function readProfileImage(file: File): Promise<{image: HTMLImageElement; url: string}> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {image.onload = () => resolve(); image.onerror = reject; image.src = url;});
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
    return {image, url};
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageValidationError('Can’t read this image. Choose another.');
  }
}

export function cropRectangle(width: number, height: number, ratio: number, zoom: number, x: number, y: number) {
  const cropWidth = Math.min(width, height * ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  return {x: (width - cropWidth) * x, y: (height - cropHeight) * y, width: cropWidth, height: cropHeight};
}

export async function exportProfileCrop(image: HTMLImageElement, purpose: MediaPurpose, zoom: number, x: number, y: number) {
  const rule = IMAGE_RULES[purpose];
  const rect = cropRectangle(image.naturalWidth, image.naturalHeight, rule.ratio, zoom, x, y);
  const canvas = document.createElement('canvas');
  canvas.width = rule.width; canvas.height = rule.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageValidationError('Can’t read this image. Choose another.');
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new ImageValidationError('Can’t read this image. Choose another.');
  return new File([blob], `${purpose}.png`, {type: 'image/png'});
}

export function mediaErrorMessage(error: unknown, saving = false): string {
  if (error instanceof ImageValidationError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 100138) {
      const reasons: Record<string, string> = {
        too_large: 'Image is too large. Max 10MB.', unsupported_format: 'Unsupported image format.',
        read_failed: 'Can’t read this image. Choose another.', invalid_dimensions: 'Image dimensions are not supported. Resize or choose another.',
        invalid_ratio: 'Crop the avatar to 1:1 or the background to 3:1.',
      };
      return reasons[String(error.metadata?.reason)] ?? 'Couldn’t process this image. Please try again.';
    }
    const messages: Record<number, string> = {
      420112: 'Review limit reached. Check when uploads become available.',
      420113: 'An upload is processing or uploads are temporarily limited. Check its status or try again later.',
      430138: 'Upload conflict. Check the original upload before trying again.',
      200117: 'This upload or image is unavailable. Check again or refresh recent images.',
      500097: 'Image uploads are temporarily unavailable. Please try again later.',
      400000: 'Your session expired. Please sign in again.',
    };
    if (messages[error.code]) return messages[error.code];
  }
  return saving ? 'Couldn’t save. Please try again.' : 'Upload failed. Please try again.';
}

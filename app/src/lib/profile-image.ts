import {ApiError} from '@/api/envelope';
import type {MediaPurpose} from '@/api/profile-media';

export const MAX_IMAGE_BYTES = 10_485_760;
export const IMAGE_RULES = {
  avatar: {ratio: 1, minWidth: 200, minHeight: 200, width: 512, height: 512, maxSide: 4096, maxPixels: 16_000_000},
  background: {ratio: 3, minWidth: 600, minHeight: 200, width: 1500, height: 500, maxSide: 8192, maxPixels: 20_000_000},
};
export class ImageValidationError extends Error {}
export function validateImageSize(size: number) {
  if (size > MAX_IMAGE_BYTES) throw new ImageValidationError('Image is too large. Max 10MB.');
  if (size === 0) throw new ImageValidationError('Can’t read this image. Choose another.');
}

/** Inspect chunk boundaries, not arbitrary strings in compressed image data. */
export function staticImageType(buffer: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  const unsupported = () => {throw new ImageValidationError('Unsupported image format.');};
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && text(0, 8) === '\x89PNG\r\n\x1a\n') {
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = view.getUint32(at);
      if (text(at + 4, 4) === 'acTL') unsupported();
      at += 12 + length;
    }
    return 'image/png';
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const length = view.getUint32(at + 4, true);
      const chunk = text(at, 4);
      if (chunk === 'ANIM' || chunk === 'ANMF' || (chunk === 'VP8X' && length > 0 && (bytes[at + 8] & 2))) unsupported();
      at += 8 + length + (length % 2);
    }
    return 'image/webp';
  }
  return unsupported() as never;
}

export function validateImageDimensions(purpose: MediaPurpose, width: number, height: number) {
  const rule = IMAGE_RULES[purpose];
  if (width < rule.minWidth || height < rule.minHeight || width > rule.maxSide || height > rule.maxSide || width * height > rule.maxPixels) {
    throw new ImageValidationError(`Use an image at least ${rule.minWidth} × ${rule.minHeight}, within the supported size limits.`);
  }
  if (width !== height * rule.ratio) throw new ImageValidationError(`Crop this image to ${rule.ratio}:1.`);
}

export async function readProfileImage(file: File): Promise<{image: HTMLImageElement; url: string}> {
  validateImageSize(file.size);
  let buffer: ArrayBuffer;
  try {buffer = await file.arrayBuffer();} catch {throw new ImageValidationError('Can’t read this image. Choose another.');}
  staticImageType(buffer);
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
  if (rect.width < rule.minWidth || rect.height < rule.minHeight) throw new ImageValidationError(`Crop must contain at least ${rule.minWidth} × ${rule.minHeight} pixels. Zoom out or choose a larger image.`);
  const canvas = document.createElement('canvas');
  canvas.width = rule.width; canvas.height = rule.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageValidationError('Can’t read this image. Choose another.');
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new ImageValidationError('Can’t read this image. Choose another.');
  validateImageSize(blob.size);
  validateImageDimensions(purpose, canvas.width, canvas.height);
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

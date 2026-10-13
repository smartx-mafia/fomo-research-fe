import {call} from './envelope';
import type {UserInfo} from './auth';

export type MediaPurpose = 'avatar' | 'background';
export const MEDIA_PURPOSES: MediaPurpose[] = ['avatar', 'background'];
export type MediaQuota = {
  limit: number; remaining: number; window_seconds: number | string;
  next_allowed_at: number | string; upload_enabled: boolean;
};
export type MediaOperation = {
  operation_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'failed' | 'noop';
  asset_id?: string; url?: string; charged?: boolean;
};
export type MediaHistoryItem = {asset_id?: string; url: string; used_at?: number | string};
const path = (purpose: MediaPurpose) => `/v1/profile/media/${purpose}`;

export function getMediaQuota(bearer: string, purpose: MediaPurpose, signal?: AbortSignal) {
  return call<MediaQuota>(`${path(purpose)}/quota`, {bearer, signal});
}
export function getMediaHistory(bearer: string, purpose: MediaPurpose, signal?: AbortSignal) {
  return call<{items?: MediaHistoryItem[]}>(`${path(purpose)}/history`, {bearer, signal});
}
export function uploadMedia(bearer: string, purpose: MediaPurpose, file: File, operationID: string, signal?: AbortSignal) {
  const formData = new FormData();
  formData.append('file', file);
  return call<MediaOperation>(`${path(purpose)}/uploads`, {method: 'POST', bearer, formData, idempotencyKey: operationID, signal});
}
export function getMediaUpload(bearer: string, purpose: MediaPurpose, operationID: string, signal?: AbortSignal) {
  return call<MediaOperation>(`${path(purpose)}/uploads/${encodeURIComponent(operationID)}`, {bearer, signal});
}
export function applyMedia(bearer: string, purpose: MediaPurpose, assetID: string, signal?: AbortSignal) {
  return call<{user: UserInfo}>(`${path(purpose)}/apply`, {method: 'POST', bearer, body: {asset_id: assetID}, signal});
}

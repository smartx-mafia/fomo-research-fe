'use client';

import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {getUserInfo, type UserInfo} from '@/api/auth';
import {ApiError} from '@/api/envelope';
import {applyMedia, getMediaHistory, getMediaQuota, getMediaUpload, uploadMedia, MEDIA_PURPOSES, type MediaHistoryItem, type MediaOperation, type MediaPurpose, type MediaQuota} from '@/api/profile-media';
import {setAvatar} from '@/api/settings';
import {BUSINESS_API_BASE} from '@/config';
import {mediaErrorMessage} from '@/lib/profile-image';
import {readDurableRecord, removeDurableRecord, updateSessionUser, writeDurableRecord} from '@/session/storage';

export type MediaDraft = {
  file?: File; url?: string; assetID?: string; legacyURL?: string;
  operationID?: string; status?: MediaOperation['status'] | 'uncertain' | 'saved';
  failedAt?: number; error?: string; traceID?: string; missing?: boolean;
};
type Drafts = Record<MediaPurpose, MediaDraft>;
type Resources = Record<MediaPurpose, {quota?: MediaQuota; history: MediaHistoryItem[]; error?: string}>;
const unresolved = (draft: MediaDraft) => draft.status === 'pending' || draft.status === 'uncertain';
export {unresolved as isMediaUnresolved};

export function useProfileMedia(bearer: string, identifier: string, onSaved: (user: UserInfo) => void) {
  const [drafts, setDrafts] = useState<Drafts>({avatar: {}, background: {}});
  const current = useRef(drafts);
  const [resources, setResources] = useState<Resources>({avatar: {history: []}, background: {history: []}});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const locked = useRef(false);
  const life = useRef<AbortController | null>(null);
  const previews = useRef(new Set<string>());
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const key = (purpose: MediaPurpose) => `smartx.profile-media.v1.${encodeURIComponent(BUSINESS_API_BASE)}.${identifier}.${purpose}`;
  const active = () => !!life.current && !life.current.signal.aborted;
  const patch = (purpose: MediaPurpose, value: MediaDraft) => {
    current.current = {...current.current, [purpose]: value};
    setDrafts(current.current);
  };
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const restored: Drafts = {avatar: {}, background: {}};
    for (const purpose of MEDIA_PURPOSES) {
      try {
        const record = JSON.parse(readDurableRecord(key(purpose)) ?? 'null');
        if (record && /^[A-Za-z0-9_-]{16,64}$/.test(record.operationID)) {
          restored[purpose] = {operationID: record.operationID, status: 'uncertain', failedAt: typeof record.failedAt === 'number' ? record.failedAt : undefined};
        }
      } catch { /* Bad records never trigger uploads. */ }
    }
    current.current = restored;
    setDrafts(restored);
    return () => {controller.abort(); for (const url of previews.current) URL.revokeObjectURL(url); previews.current.clear();};
    // The editor is keyed by both account and JWT, so credentials cannot cross runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearer, identifier]);

  async function request<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([life.current!.signal, AbortSignal.timeout(25_000)]);
    const result = await fn(signal);
    if (signal.aborted) throw new Error('Request cancelled');
    return result;
  }
  async function refresh() {
    if (!active()) return;
    setLoading(true);
    await Promise.all(MEDIA_PURPOSES.map(async (purpose) => {
      const [quota, history] = await Promise.allSettled([
        request((signal) => getMediaQuota(bearer, purpose, signal)),
        request((signal) => getMediaHistory(bearer, purpose, signal)),
      ]);
      if (!active()) return;
      setResources((previous) => ({...previous, [purpose]: {
        quota: quota.status === 'fulfilled' ? quota.value.data : undefined,
        history: history.status === 'fulfilled' ? history.value.data.items ?? [] : previous[purpose].history,
        error: quota.status === 'rejected' || history.status === 'rejected' ? 'Couldn’t load upload availability or recent images. Refresh to try again.' : undefined,
      }}));
    }));
    if (active()) setLoading(false);
  }
  function report(purpose: MediaPurpose, error: unknown) {
    if (!active()) return;
    const message = mediaErrorMessage(error);
    patch(purpose, {...current.current[purpose], error: message, missing: error instanceof ApiError && error.code === 200117, traceID: error instanceof ApiError ? error.traceID : undefined});
    toast.error(message, {duration: 5000});
  }
  async function accept(purpose: MediaPurpose, operation: MediaOperation) {
    if (!active()) return;
    const previous = current.current[purpose];
    if (!['pending', 'approved', 'rejected', 'failed', 'noop'].includes(operation.status) ||
      (operation.status === 'approved' && (!operation.asset_id || !operation.url))) throw new Error('Invalid upload response');
    const failedAt = operation.status === 'failed' ? previous.failedAt ?? Date.now() : undefined;
    const draft: MediaDraft = {...previous, status: operation.status, assetID: operation.asset_id || undefined,
      url: operation.url || previous.url, failedAt, error: undefined, traceID: undefined, missing: false};
    if (operation.status === 'rejected') draft.error = 'Image didn’t pass review. Choose another.';
    if (operation.status === 'failed') draft.error = 'Upload failed. Please try again after 30 seconds.';
    patch(purpose, draft);
    if (failedAt) writeDurableRecord(key(purpose), JSON.stringify({operationID: draft.operationID, failedAt}));
    if (operation.status === 'rejected') removeDurableRecord(key(purpose));
    if (draft.error) toast.error(draft.error, {duration: 5000});
    if (operation.status === 'noop') {
      // A recovered old noop must not overwrite a more recently applied picture.
      const {data: user} = await request((signal) => getUserInfo(bearer, signal));
      if (!active()) return;
      publish(user);
      patch(purpose, {status: 'saved'});
      removeDurableRecord(key(purpose));
    }
  }
  async function poll(purpose: MediaPurpose) {
    for (let attempt = 0; attempt < 8 && active(); attempt++) {
      if (attempt > 0) await new Promise<void>((resolve) => {
        const signal = life.current!.signal;
        const done = () => {clearTimeout(timer); signal.removeEventListener('abort', done); resolve();};
        const timer = setTimeout(done, 2500);
        signal.addEventListener('abort', done, {once: true});
      });
      if (!active()) return;
      const {operationID} = current.current[purpose];
      if (!operationID) return;
      const result = await request((signal) => getMediaUpload(bearer, purpose, operationID, signal));
      await accept(purpose, result.data);
      if (current.current[purpose].status !== 'pending') return;
    }
  }
  async function exclusive(fn: () => Promise<void>) {
    if (locked.current || !active()) return;
    locked.current = true; setBusy(true); setSaveError(undefined);
    try {await fn();} finally {locked.current = false; if (active()) setBusy(false);}
  }
  async function submit(purpose: MediaPurpose, file?: File, replay = false) {
    await exclusive(async () => {
      let draft = current.current[purpose];
      if (replay && (!draft.missing || !draft.operationID)) return;
      if (file && unresolved(draft)) return;
      if (!replay && !file && draft.status !== 'failed') return;
      if (draft.failedAt && Date.now() - draft.failedAt < 30_000) return;
      const selected = file ?? draft.file;
      if (!selected) return;
      const quota = resources[purpose].quota;
      if (!replay && (!quota?.upload_enabled || quota.remaining <= 0)) return;
      const operationID = replay ? draft.operationID! : crypto.randomUUID();
      const url = file ? URL.createObjectURL(file) : draft.url;
      if (file && url) previews.current.add(url);
      draft = {file: selected, url, operationID, status: 'pending'};
      patch(purpose, draft);
      if (!writeDurableRecord(key(purpose), JSON.stringify({operationID}))) {
        patch(purpose, {...draft, status: 'failed', error: 'Your browser could not save upload recovery information. Allow site storage and try again.'});
        return;
      }
      try {
        const result = await request((signal) => uploadMedia(bearer, purpose, selected, operationID, signal));
        await accept(purpose, result.data);
        if (current.current[purpose].status === 'pending') await poll(purpose);
      } catch (error) {
        if (!active()) return;
        // A definite validation/availability rejection did not start a review.
        if (error instanceof ApiError && error.kind === 'business' && [100138, 420112, 500097, 400000].includes(error.code)) {
          removeDurableRecord(key(purpose));
          patch(purpose, {...draft, status: undefined, operationID: undefined});
        } else {
          patch(purpose, {...current.current[purpose], status: 'uncertain'});
          try {await poll(purpose);} catch (recoveryError) {
            report(purpose, recoveryError);
            return; // Keep the original locator, including a same-file replay after 200117.
          }
        }
        if (current.current[purpose].status !== 'approved' && current.current[purpose].status !== 'saved') report(purpose, error);
      } finally {if (active()) await refresh();}
    });
  }
  async function check(purpose: MediaPurpose) {
    await exclusive(async () => {
      try {await poll(purpose);} catch (error) {report(purpose, error);}
      finally {if (active()) await refresh();}
    });
  }
  function choose(purpose: MediaPurpose, item: MediaHistoryItem) {
    if (locked.current || unresolved(current.current[purpose]) || (!item.asset_id && purpose !== 'avatar')) return;
    removeDurableRecord(key(purpose));
    patch(purpose, {url: item.url, assetID: item.asset_id, legacyURL: item.asset_id ? undefined : item.url, status: 'approved'});
    setSaveError(undefined);
  }
  function publish(user: UserInfo) {
    if (!active() || user.identifier !== identifier) throw new Error('Account changed');
    updateSessionUser(bearer, user);
    savedCallback.current(user);
  }
  async function save() {
    let complete = false;
    await exclusive(async () => {
      const selected = MEDIA_PURPOSES.filter((purpose) => current.current[purpose].status === 'approved');
      if (!selected.length || MEDIA_PURPOSES.some((purpose) => {
        const draft = current.current[purpose];
        return unresolved(draft) || (!!draft.file && draft.status !== 'approved' && draft.status !== 'saved');
      })) return;
      const failures: string[] = [];
      for (const purpose of selected) {
        if (!active()) return;
        const draft = current.current[purpose];
        try {
          let user: UserInfo;
          try {
            const result = draft.assetID
              ? await request((signal) => applyMedia(bearer, purpose, draft.assetID!, signal))
              : await request((signal) => setAvatar(bearer, {url: draft.legacyURL}, signal));
            user = result.data.user;
          } catch (error) {
            if (error instanceof ApiError && error.kind === 'business') throw error;
            const result = await request((signal) => getUserInfo(bearer, signal));
            if (result.data[purpose === 'avatar' ? 'avatar_url' : 'background_url'] !== draft.url) throw error;
            user = result.data;
          }
          if (!active()) return;
          publish(user);
          patch(purpose, {...draft, status: 'saved', error: undefined});
          removeDurableRecord(key(purpose));
        } catch (error) {
          if (!active()) return;
          failures.push(purpose);
          patch(purpose, {...draft, error: mediaErrorMessage(error, true), traceID: error instanceof ApiError ? error.traceID : undefined});
        }
      }
      if (!active()) return;
      if (failures.length) {
        setSaveError(`Couldn’t save ${failures.join(' and ')}. Your edits are kept; any completed changes are already saved.`);
        toast.error('Couldn’t save. Please try again.', {duration: 5000});
      } else {
        complete = true;
        toast.success('Profile updated', {duration: 3000});
      }
      await refresh();
    });
    return complete;
  }
  function discard(purpose: MediaPurpose) {
    const draft = current.current[purpose];
    if (locked.current || (unresolved(draft) && !(draft.missing && !draft.file))) return;
    removeDurableRecord(key(purpose));
    patch(purpose, {});
    setSaveError(undefined);
  }
  return {drafts, resources, busy, loading, saveError, refresh, submit, check, choose, save, discard};
}

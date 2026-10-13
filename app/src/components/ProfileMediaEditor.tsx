'use client';

import {Dialog} from 'radix-ui';
import {useEffect, useRef, useState} from 'react';
import {Camera, LoaderCircle, X} from 'lucide-react';
import {toast} from 'sonner';
import type {UserInfo} from '@/api/auth';
import {MEDIA_PURPOSES, type MediaPurpose} from '@/api/profile-media';
import {isMediaUnresolved, useProfileMedia} from '@/hooks/useProfileMedia';
import {mediaErrorMessage, readProfileImage} from '@/lib/profile-image';
import {ProfileImageCropper} from './ProfileImageCropper';

export function ProfileMediaEditor({bearer, user, onSaved}: {bearer: string; user: UserInfo; onSaved: (user: UserInfo) => void}) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [crop, setCrop] = useState<{purpose: MediaPurpose; image: HTMLImageElement; url: string}>();
  const [fileError, setFileError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const selection = useRef(0);
  const media = useProfileMedia(bearer, user.identifier, onSaved);
  useEffect(() => {if (!open) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);}, [open]);
  useEffect(() => () => {selection.current++;}, []);
  useEffect(() => () => {if (crop) URL.revokeObjectURL(crop.url);}, [crop]);
  const disabled = media.busy || reading || !!crop;
  const hasReady = MEDIA_PURPOSES.some((purpose) => media.drafts[purpose].status === 'approved');
  const hasBlocked = MEDIA_PURPOSES.some((purpose) => {
    const draft = media.drafts[purpose];
    return isMediaUnresolved(draft) || (!!draft.file && draft.status !== 'approved' && draft.status !== 'saved');
  });
  async function select(purpose: MediaPurpose, file?: File) {
    if (!file) return;
    const seq = ++selection.current;
    setReading(true); setFileError(undefined);
    let loaded: Awaited<ReturnType<typeof readProfileImage>> | undefined;
    try {
      loaded = await readProfileImage(file);
      if (seq !== selection.current) {URL.revokeObjectURL(loaded.url); return;}
      setCrop({purpose, ...loaded});
    } catch (error) {
      if (loaded) URL.revokeObjectURL(loaded.url);
      if (seq === selection.current) {const message = mediaErrorMessage(error); setFileError(message); toast.error(message, {duration: 5000});}
    } finally {if (seq === selection.current) setReading(false);}
  }
  function changeOpen(value: boolean) {
    setOpen(value);
    if (value) void media.refresh();
    else {selection.current++; setReading(false); setCrop(undefined);}
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button type="button" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent"><Camera className="size-4" />Edit images</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onInteractOutside={(event) => event.preventDefault()}>
        <div className="flex items-start justify-between border-b border-border p-5">
          <div><Dialog.Title className="text-lg font-semibold">Profile images</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted">Choose an avatar and a background for your portfolio.</Dialog.Description></div>
          <Dialog.Close aria-label="Close image editor" className="rounded p-1 text-muted hover:text-foreground"><X className="size-5" /></Dialog.Close>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <p className="text-xs text-muted">Choose an image and crop it before upload. The crop is uploaded as a still PNG. Each image has 5 reviews per rolling 24 hours. Submitting for review uses a review even if you don’t save.</p>
          {reading ? <p role="status" className="text-sm text-muted">Reading image…</p> : null}
          {fileError ? <p role="alert" className="text-sm text-down">{fileError}</p> : null}
          {crop ? <ProfileImageCropper key={crop.url} image={crop.image} purpose={crop.purpose} onCancel={() => setCrop(undefined)} onDone={(file) => {const purpose = crop.purpose; setCrop(undefined); void media.submit(purpose, file);}} /> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            {MEDIA_PURPOSES.map((purpose) => {
              const draft = media.drafts[purpose];
              const {quota, history, error} = media.resources[purpose];
              const url = draft.url ?? user[purpose === 'avatar' ? 'avatar_url' : 'background_url'];
              const waiting = isMediaUnresolved(draft);
              const cooldown = Math.max(0, Math.ceil(((draft.failedAt ?? 0) + 30_000 - now) / 1000));
              const canUpload = quota?.upload_enabled === true && quota.remaining > 0;
              return <section key={purpose} className="min-w-0 space-y-3 rounded-xl border border-border p-3" aria-label={`${purpose} editor`}>
                <h3 className="text-sm font-semibold capitalize">{purpose}</h3>
                <div className={`mx-auto flex items-center justify-center overflow-hidden bg-surface-2 ${purpose === 'avatar' ? 'size-24 rounded-full' : 'aspect-[3/1] w-full rounded-lg'}`}>
                  {url ? <img src={url} alt={`${purpose} preview`} className="size-full object-cover" /> : <Camera className="size-6 text-muted" />}
                </div>
                <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${disabled || waiting || !canUpload || cooldown > 0 ? 'cursor-not-allowed opacity-50' : 'hover:border-accent'}`}>
                  <Camera className="size-4" />Choose {purpose}
                  <input type="file" aria-label={`Choose ${purpose}`} className="sr-only" disabled={disabled || waiting || !canUpload || cooldown > 0} onChange={(event) => {const file = event.target.files?.[0]; event.target.value = ''; void select(purpose, file);}} />
                </label>
                <p className="text-xs text-muted">{purpose === 'avatar' ? 'Any aspect ratio · Crop to 1:1 before upload' : 'Any aspect ratio · Crop to 3:1 before upload'}</p>
                <p className="text-xs text-muted">{!quota ? 'Upload availability not loaded.' : !quota.upload_enabled ? 'New uploads are currently unavailable.' : quota.remaining > 0 ? `${quota.remaining} of ${quota.limit} reviews remaining` : `Review limit reached.${Number(quota.next_allowed_at) > 0 ? ` Available ${new Date(Number(quota.next_allowed_at) * 1000).toLocaleString()}.` : ''}`}</p>
                {error ? <p role="alert" className="text-xs text-down">{error}</p> : null}
                {draft.status ? <p role="status" className="text-xs text-accent">{draft.status === 'approved' ? 'Ready to save' : draft.status === 'saved' ? 'Saved' : draft.status === 'pending' ? 'Review in progress. Check again if it takes longer.' : draft.status === 'uncertain' ? 'Upload result needs confirmation. Check status before uploading again.' : draft.status === 'rejected' ? 'Review rejected' : draft.status === 'failed' ? 'Upload failed' : 'Confirming current image…'}</p> : null}
                {draft.error ? <p role="alert" className="text-xs text-down">{draft.error}{draft.traceID ? <span className="mt-1 block font-mono">Reference: {draft.traceID}</span> : null}</p> : null}
                {waiting ? <button type="button" disabled={disabled} onClick={() => void media.check(purpose)} className="text-xs text-accent disabled:opacity-50">Check upload status</button> : null}
                {waiting && draft.missing && draft.file ? <button type="button" disabled={disabled} onClick={() => void media.submit(purpose, undefined, true)} className="block text-xs text-accent disabled:opacity-50">Retry the same upload</button> : null}
                {waiting && draft.missing && !draft.file ? <button type="button" disabled={disabled} onClick={() => media.discard(purpose)} className="block text-xs text-muted underline disabled:opacity-50">Dismiss unavailable upload</button> : null}
                {draft.status === 'failed' && draft.file ? <button type="button" disabled={disabled || cooldown > 0 || !canUpload} onClick={() => void media.submit(purpose)} className="block text-xs text-accent disabled:opacity-50">{cooldown > 0 ? `Retry in ${cooldown}s` : 'Retry upload'}</button> : null}
                {!waiting && draft.status !== 'saved' && (draft.url || draft.operationID) ? <button type="button" disabled={disabled} onClick={() => media.discard(purpose)} className="block text-xs text-muted underline disabled:opacity-50">Discard this change</button> : null}
                {history.length ? <div className="border-t border-border pt-3"><p className="mb-2 text-xs text-muted">Recent images · No review needed</p><div className="flex flex-wrap gap-2">{history.map((item, index) => <button key={item.asset_id || item.url} type="button" aria-label={`Use recent ${purpose} ${index + 1}`} aria-pressed={draft.status === 'approved' && draft.url === item.url} disabled={disabled || waiting || (!item.asset_id && purpose !== 'avatar')} onClick={() => media.choose(purpose, item)} className={`overflow-hidden border-2 aria-pressed:border-accent disabled:opacity-50 ${purpose === 'avatar' ? 'size-10 rounded-full' : 'h-10 w-[120px] rounded-md'} border-transparent`}><img src={item.url} alt="" className="size-full object-cover" /></button>)}</div></div> : null}
              </section>;
            })}
          </div>
          <button type="button" disabled={media.loading || media.busy} onClick={() => void media.refresh()} className="text-xs text-accent disabled:opacity-50">{media.loading ? 'Refreshing…' : 'Refresh availability and recent images'}</button>
          {media.saveError ? <p role="alert" className="text-sm text-down">{media.saveError}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border p-5">
          <p className="text-xs text-muted">Changes appear on your profile after saving.</p>
          <button type="button" disabled={disabled || !hasReady || hasBlocked} onClick={() => void media.save().then((saved) => {if (saved) setOpen(false);})} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{media.busy ? <LoaderCircle className="size-4 animate-spin" /> : null}Save changes</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

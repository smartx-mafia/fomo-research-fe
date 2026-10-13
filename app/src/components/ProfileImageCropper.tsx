'use client';

import {useEffect, useRef, useState} from 'react';
import type {MediaPurpose} from '@/api/profile-media';
import {cropRectangle, exportProfileCrop, IMAGE_RULES, mediaErrorMessage} from '@/lib/profile-image';

export function ProfileImageCropper({image, purpose, onDone, onCancel}: {
  image: HTMLImageElement; purpose: MediaPurpose; onDone: (file: File) => void; onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const rule = IMAGE_RULES[purpose];
  const base = cropRectangle(image.naturalWidth, image.naturalHeight, rule.ratio, 1, 0.5, 0.5);
  const maxZoom = Math.max(1, Math.min(4, base.width / rule.minWidth, base.height / rule.minHeight));
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !canvas.current) return;
    const rect = cropRectangle(image.naturalWidth, image.naturalHeight, rule.ratio, zoom, x, y);
    ctx.clearRect(0, 0, canvas.current.width, canvas.current.height);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.current.width, canvas.current.height);
  }, [image, rule.ratio, zoom, x, y]);
  async function confirm() {
    setBusy(true); setError(undefined);
    try {
      const file = await exportProfileCrop(image, purpose, zoom, x, y);
      if (alive.current) onDone(file);
    } catch (cause) {if (alive.current) setError(mediaErrorMessage(cause));}
    finally {if (alive.current) setBusy(false);}
  }
  return <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-label={`Crop ${purpose}`}>
    <div><h3 className="font-semibold">Crop {purpose}</h3><p className="mt-1 text-xs text-muted">{rule.ratio}:1 · Move and zoom to frame your image.</p></div>
    <canvas ref={canvas} width={600} height={600 / rule.ratio} aria-label="Cropped image preview" className={`mx-auto w-full max-w-md bg-surface-2 ${purpose === 'avatar' ? 'rounded-full' : 'rounded-lg'}`} />
    {([{name: 'Zoom', value: zoom, set: setZoom, min: 1, max: maxZoom}, {name: 'Horizontal position', value: x, set: setX, min: 0, max: 1}, {name: 'Vertical position', value: y, set: setY, min: 0, max: 1}]).map((slider) =>
      <label key={slider.name} className="block text-xs text-muted">{slider.name}<input type="range" aria-label={slider.name} min={slider.min} max={slider.max} step="0.01" value={slider.value} disabled={busy} onChange={(event) => slider.set(Number(event.target.value))} className="mt-2 block w-full accent-accent" /></label>)}
    {error ? <p role="alert" className="text-sm text-down">{error}</p> : null}
    <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm">Cancel crop</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Upload for review'}</button></div>
  </section>;
}

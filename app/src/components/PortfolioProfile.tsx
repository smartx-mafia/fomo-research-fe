'use client';

import {useEffect, useRef, useState} from 'react';
import {UserRound} from 'lucide-react';
import type {UserInfo} from '@/api/auth';
import {getProfile} from '@/api/settings';
import {mediaErrorMessage} from '@/lib/profile-image';
import {updateSessionUser} from '@/session/storage';
import {ProfileMediaEditor} from './ProfileMediaEditor';
import {ProfileBackground} from './ProfileBackground';
import {NotificationEntry} from './NotificationEntry';

export function PortfolioProfile({bearer, initialUser}: {bearer: string; initialUser: UserInfo}) {
  const [user, setUser] = useState(initialUser);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const seq = ++generation.current;
    void getProfile(bearer, controller.signal).then(({data}) => {
      if (controller.signal.aborted || generation.current !== seq) return;
      if (data.user.identifier !== initialUser.identifier) throw new Error('Profile account mismatch');
      setUser(data.user); setError(undefined);
      updateSessionUser(bearer, data.user);
    }).catch((cause) => {if (!controller.signal.aborted && generation.current === seq) setError(mediaErrorMessage(cause, true));});
    return () => controller.abort();
  }, [bearer, revision, initialUser.identifier]);
  const name = user.nickname || user.username || 'Your portfolio';
  return <section className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface" aria-label="Portfolio profile">
    <ProfileBackground url={user.background_url} />
    <div className="relative px-5 pb-5 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="relative -mt-10 flex size-24 items-center justify-center overflow-hidden rounded-full border-4 border-surface bg-surface-2 sm:size-28">
          {user.avatar_url && failedAvatar !== user.avatar_url ? <img src={user.avatar_url} alt={`${name} avatar`} className="size-full object-cover" onError={() => setFailedAvatar(user.avatar_url)} /> : <UserRound className="size-10 text-muted" />}
        </div>
        <div className="flex items-center gap-2 pt-4"><NotificationEntry language={user.language} /><ProfileMediaEditor key={`${bearer}:${user.identifier}`} bearer={bearer} user={user} onSaved={(next) => {generation.current++; setUser(next); setError(undefined);}} /></div>
      </div>
      <h2 className="mt-3 text-xl font-semibold">{name}</h2>
      {user.username ? <p className="mt-1 text-sm text-muted">@{user.username}</p> : null}
      {user.bio ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{user.bio}</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-down">Couldn’t refresh profile. <button type="button" onClick={() => setRevision((value) => value + 1)} className="underline">Retry</button></p> : null}
    </div>
  </section>;
}

'use client';

import {useSyncExternalStore} from 'react';
import {useSession} from '@/session/storage';
import {contentLanguage, type ContentLanguage} from '@/lib/content-translation';

// A tab-local display preference. It neither edits the account nor stores credentials.
let override: ContentLanguage | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
const snapshot = () => override;
const serverSnapshot = () => null;

export function setContentLanguage(language: ContentLanguage | null) {
  if (language === override) return;
  override = language;
  listeners.forEach(listener => listener());
}

export function useContentLanguage(): ContentLanguage {
  const selected = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const session = useSession();
  return selected ?? contentLanguage(session?.user?.language) ?? 'en';
}

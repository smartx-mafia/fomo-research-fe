'use client';

import {useState} from 'react';
import type {ContentLanguage, ContentTranslation} from '@/lib/content-translation';

type Props = {
  original: string;
  translation?: ContentTranslation;
  language: ContentLanguage;
  identity: string;
  className?: string;
  onOpen?: () => void;
  openLabel?: string;
};

/** Key the local preference by content/version and target, never by polling results. */
export function TranslatedText(props: Props) {
  return <TextChoice key={JSON.stringify([props.identity, props.original, props.language])} {...props} />;
}

function TextChoice({original, translation, language, className, onOpen, openLabel}: Props) {
  const [showOriginal, setShowOriginal] = useState(false);
  const ready = translation?.status === 'ready' && translation.targetLocale === language && !!translation.translatedText;
  const text = ready && !showOriginal ? translation.translatedText! : original;
  return <div>
    {onOpen ? <button type="button" className={className} style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}} aria-label={openLabel} onClick={onOpen}>{text}</button>
      : <p className={className} style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{text}</p>}
    {ready ? <button type="button" aria-pressed={showOriginal} className="mt-1 text-xs text-accent hover:underline"
      onClick={event => {event.stopPropagation(); setShowOriginal(value => !value);}}>{showOriginal ? '查看译文' : '查看原文'}</button> : null}
  </div>;
}

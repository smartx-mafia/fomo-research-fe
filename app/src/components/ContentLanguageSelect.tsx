'use client';

import {CONTENT_LANGUAGES, type ContentLanguage} from '@/lib/content-translation';
import {setContentLanguage, useContentLanguage} from '@/hooks/useContentLanguage';

const labels: Record<ContentLanguage, string> = {en: 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', ja: '日本語', ko: '한국어', es: 'Español'};

export function ContentLanguageSelect() {
  const language = useContentLanguage();
  return <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
    翻译语言
    <select aria-label="翻译语言" value={language} onChange={event => setContentLanguage(event.target.value as ContentLanguage)}
      className="rounded-md border border-border bg-background px-2 py-1 text-foreground">
      {CONTENT_LANGUAGES.map(value => <option key={value} value={value}>{labels[value]}</option>)}
    </select>
  </label>;
}

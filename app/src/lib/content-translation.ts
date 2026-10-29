export const CONTENT_LANGUAGES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es'] as const;
export type ContentLanguage = typeof CONTENT_LANGUAGES[number];

export function contentLanguage(value?: string | null): ContentLanguage | undefined {
  const tag = value?.trim().replaceAll('_', '-').toLowerCase();
  if (!tag) return undefined;
  if (tag === 'zh' || tag.startsWith('zh-')) {
    if (tag.includes('-hans')) return 'zh-Hans';
    return tag.includes('-hant') || /^zh-(tw|hk|mo)(-|$)/.test(tag) ? 'zh-Hant' : 'zh-Hans';
  }
  const base = tag.split('-')[0];
  return ['en', 'ja', 'ko', 'es'].includes(base) ? base as ContentLanguage : undefined;
}

/** Text, not markup. Preserve whitespace and emoji; never truncate a translation. */
export function plainContent(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string' || value.length > maxBytes || !value.trim() || value.includes('\0')) return null;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      bytes += 4;
    } else if (c >= 0xdc00 && c <= 0xdfff) return null;
    else bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (bytes > maxBytes) return null;
  }
  return value;
}

export type ContentTranslation = {
  status: 'ready' | 'original' | 'pending' | 'unavailable' | 'unsupported' | 'failed' | 'stale';
  targetLocale: string;
  translatedText?: string;
  sourceLocale?: string;
  reason?: string;
  retryAfterMs?: number;
};

/** A malformed optional attachment must not discard the usable original. */
export function normalizeContentTranslation(value: unknown): ContentTranslation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (!['ready', 'original', 'pending', 'unavailable', 'unsupported', 'failed', 'stale'].includes(String(r.status))) return undefined;
  return {
    status: r.status as ContentTranslation['status'],
    targetLocale: typeof r.target_locale === 'string' ? r.target_locale : '',
    translatedText: r.status === 'ready' ? plainContent(r.translated_text, 16384) ?? undefined : undefined,
    sourceLocale: typeof r.source_locale === 'string' && r.source_locale ? r.source_locale : undefined,
    reason: typeof r.reason === 'string' ? r.reason : undefined,
    retryAfterMs: r.status === 'pending' && typeof r.retry_after_ms === 'number' && Number.isFinite(r.retry_after_ms) && r.retry_after_ms > 0 ? r.retry_after_ms : undefined,
  };
}

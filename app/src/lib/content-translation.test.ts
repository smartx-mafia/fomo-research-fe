import {describe, expect, it} from 'vitest';
import {contentLanguage, normalizeContentTranslation, plainContent} from './content-translation';

describe('content translation contract', () => {
  it('normalizes all six languages without treating unknown tags as English', () => {
    for (const [input, expected] of [['en-US','en'],['zh-CN','zh-Hans'],['zh-HK','zh-Hant'],['zh-Hans-TW','zh-Hans'],['ja-JP','ja'],['ko-KR','ko'],['es-MX','es']]) expect(contentLanguage(input)).toBe(expected);
    expect(contentLanguage('fr')).toBeUndefined();
  });
  it('preserves complete text, whitespace, emoji and literal markup within byte boundaries', () => {
    const text = ' \r\n👩🏽‍💻\tPrice < 1 <b>literal</b> 👨‍👩‍👧‍👦  ';
    expect(plainContent(text, 16384)).toBe(text);
    expect(plainContent('x'.repeat(16000), 16384)).toHaveLength(16000);
    expect(plainContent('中'.repeat(1366), 4096)).toBeNull();
    for (const invalid of ['\0', '\ud800', '\udc00', ' \n', 'x'.repeat(16385)]) expect(plainContent(invalid, 16384)).toBeNull();
  });
  it('only carries text for ready and never discards the original on a malformed attachment', () => {
    for (const status of ['pending','original','failed','unavailable','unsupported','stale']) expect(normalizeContentTranslation({status,target_locale:'en',translated_text:'old'})?.translatedText).toBeUndefined();
    expect(normalizeContentTranslation(null)).toBeUndefined();
    expect(normalizeContentTranslation({status:'unknown'})).toBeUndefined();
    expect(normalizeContentTranslation({status:'ready',target_locale:'en',translated_text:'\0'})?.translatedText).toBeUndefined();
    expect(normalizeContentTranslation({status:'ready',target_locale:'en',translated_text:' Full text\n'})).toMatchObject({status:'ready',targetLocale:'en',translatedText:' Full text\n'});
  });
});

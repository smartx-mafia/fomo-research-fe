import {expect, it} from 'vitest';
import {notificationAge, notificationLabels, notificationLanguage} from './notification-labels';

it('normalizes the account languages and rejects unsupported or inherited keys', () => {
  for (const [value, language] of [['zh', 'zh-CN'], ['zh_TW', 'zh-TW'], ['ja-JP', 'ja'], ['es-MX', 'es'], ['constructor', 'en'], ['fr', 'en']]) {
    expect(notificationLanguage(value)).toBe(language);
  }
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
    expect(Object.keys(notificationLabels(language)).sort()).toEqual(Object.keys(notificationLabels('en')).sort());
    expect(Object.values(notificationLabels(language)).every((value) => value.length > 0)).toBe(true);
  }
});

it('uses seconds and never renders a future timestamp as a negative age', () => {
  const now = 1800000000000;
  expect(notificationAge(now / 1000 + 100, 'zh', now)).toBe('刚刚');
  expect(notificationAge(now / 1000 - 480, 'en', now)).toBe('8m');
  expect(notificationAge(now / 1000 - 7200, 'en', now)).toBe('2h');
  expect(notificationAge(now / 1000 - 3 * 86400, 'en', now)).toBe('3d');
  expect(notificationLabels('zh-CN').allRead).toBe('全部已读');
});

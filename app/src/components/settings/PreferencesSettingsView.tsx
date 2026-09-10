'use client';

import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {getPreferences, setTheme, THEMES} from '@/api/settings';
import {setLanguage, LANGUAGES, LANGUAGE_LABELS, type Language} from '@/api/user';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {useSession} from '@/session/storage';

const THEME_LABELS: Record<string, string> = {system: '跟随系统', light: '浅色', dark: '深色'};

/**
 * Preferences 页（settings-integration.md §6）：language 沿用
 * POST /v1/user/language（设置域不复制该端点）；theme 走本域的
 * POST /v1/settings/preferences/theme。
 */
export function PreferencesSettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const [prefs, setPrefs] = useState<{language?: string; theme?: string} | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await getPreferences(jwt);
      setPrefs(res.data);
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * theme 同步到 <html> 的 dark class。取值以服务端归一回包为准（契约要求），
   * 视觉仅在设计令牌定义了浅色调色板（globals.css 目前只有一套深色 :root）
   * 时才会真正换肤；PoC 选浅色 = 只落库不换肤。
   */
  const applyThemeClass = (theme: string) => {
    if (typeof document === 'undefined') return;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  };

  if (!jwt) return <LoginGate />;

  const changeLanguage = (lang: Language) => {
    setBusy(true);
    setErr(null);
    void setLanguage(jwt, lang)
      .then(() => load()) // language 在偏好页读的是资料，重拉
      .catch((e: unknown) => setErr(e as ApiError))
      .finally(() => setBusy(false));
  };

  const changeTheme = (theme: (typeof THEMES)[number]) => {
    setBusy(true);
    setErr(null);
    setPrefs((p) => ({language: p?.language, theme})); // 乐观更新
    void setTheme(jwt, theme)
      .then((res) => {
        setPrefs((p) => ({language: p?.language, theme: res.data.theme ?? theme}));
        applyThemeClass(res.data.theme ?? theme);
      })
      .catch((e: unknown) => {
        setErr(e as ApiError);
        void load();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <SettingsNav active="/settings/preferences" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-muted-foreground text-sm">语言沿用用户域端点；主题是设置域自己的端点。</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Language</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <Button
                key={lang}
                size="sm"
                variant={prefs?.language === lang ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => changeLanguage(lang)}
              >
                {LANGUAGE_LABELS[lang]}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-[11px]">取值 en / zh-CN / zh-TW / ja / ko；当前 {prefs?.language ?? '—'}。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme colors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={(prefs?.theme ?? 'system') === t ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => changeTheme(t)}
              >
                {THEME_LABELS[t]}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-[11px]">system / light / dark；服务端归一后回包，以回包为准刷新 UI。</p>
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}

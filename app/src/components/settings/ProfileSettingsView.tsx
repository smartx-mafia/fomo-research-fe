'use client';

import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  getAvatarHistory,
  getAvatarPresets,
  getProfile,
  importProfileFromX,
  setAvatar,
  setBio as setBioApi,
  type AvatarHistoryItem,
  type AvatarPreset,
  type ProfileAggregate,
  type XImportField,
} from '@/api/settings';
import {getXBinding} from '@/api/ximport';
import {setNickname as setNicknameApi} from '@/api/user';
import {checkUsernameAvailable, setUsername, USERNAME_RE, validateNickname, BIO_MAX_CHARS, charLength} from '@/api/user';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {retryAfterText} from '@/components/settings/quota';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useSession} from '@/session/storage';
import {cn} from '@/lib/utils';

const X_IMPORT_FIELDS: {field: XImportField; label: string}[] = [
  {field: 'nickname', label: '昵称'},
  {field: 'username', label: '用户名 (handle)'},
  {field: 'avatar', label: '头像'},
  {field: 'bio', label: '简介'},
];

const SKIPPED_REASON_LABEL: Record<string, string> = {
  taken: '该用户名已被别人占用',
  invalid: 'X 侧内容含本站不支持的字符',
  empty: 'X 侧该字段为空（不会清空本站的值）',
};

/**
 * Profile 页（settings-integration.md §2）：进入只打一次 GET /v1/profile；
 * Save 只提交改动过的字段，各打各的接口；回包直接覆盖本地聚合。
 */
export function ProfileSettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;

  const [agg, setAgg] = useState<ProfileAggregate | null>(null);
  const [bindSource, setBindSource] = useState<1 | 2 | undefined>(undefined);
  const [err, setErr] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 三个输入框的草稿与「是否改动过」（Save 只发改动项）。
  const [nickname, setNickname] = useState('');
  const [username, setUsernameDraft] = useState('');
  const [bio, setBio] = useState('');
  const [initial, setInitial] = useState({nickname: '', username: '', bio: ''});

  // 头像选择器。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [history, setHistory] = useState<AvatarHistoryItem[]>([]);
  const [picked, setPicked] = useState<{presetId?: string; url?: string} | null>(null);

  // handle 可用性预检（防抖 350ms + 乱序丢弃，user.md §3.3 八条义务）。
  const [availText, setAvailText] = useState<string | null>(null);
  const availSeq = useRef(0);

  // X 导入。
  const [importFields, setImportFields] = useState<Set<XImportField>>(new Set(['nickname', 'avatar']));

  const load = useCallback(async () => {
    if (!jwt) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await getProfile(jwt);
      setAgg(res.data);
      const u = res.data.user;
      const init = {nickname: u.nickname ?? '', username: u.username ?? '', bio: u.bio ?? ''};
      setInitial(init);
      setNickname(init.nickname);
      setUsernameDraft(init.username);
      setBio(init.bio);
      // bind_source 只为展示渠道标注；200106 = 未绑定，不是错误。
      try {
        const b = await getXBinding(jwt);
        setBindSource(b.data.bind_source);
      } catch {
        setBindSource(undefined);
      }
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  // 用户名可用性预检：只在本地格式通过 + 与原值不同时发。
  useEffect(() => {
    if (!jwt || !username || !USERNAME_RE.test(username) || username === initial.username) {
      setAvailText(null);
      return;
    }
    const seq = ++availSeq.current;
    const t = setTimeout(() => {
      void checkUsernameAvailable(jwt, username)
        .then((res) => {
          if (seq !== availSeq.current) return; // 乱序兜底：只渲染最新一发
          setAvailText(res.status === 1 ? '✓ 可用' : '✗ 已被占用（大小写不敏感）');
        })
        .catch(() => {
          if (seq === availSeq.current) setAvailText(null);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [username, initial.username, jwt]);

  if (!jwt) return <LoginGate />;
  const user = agg?.user;
  const quota = agg?.quota;
  const nicknameDirty = nickname.trim() !== initial.nickname;
  const usernameDirty = username.trim() !== initial.username && username.trim() !== '';
  const bioDirty = bio !== initial.bio;

  /** 执行一个写操作：成功就显示提示，420104 显示倒计时，失败给 ErrorPanel。 */
  const run = async (step: string, fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await fn();
      setNotice(`${step} 成功`);
    } catch (e) {
      const apiErr = e as ApiError;
      setErr(apiErr);
      const wait = apiErr.metadata?.retry_after_seconds;
      if (apiErr.code === 420104 && wait !== undefined) {
        setNotice(`修改次数到上限，${retryAfterText(wait)}后再试`);
        setErr(null);
      }
    } finally {
      setBusy(false);
      await load(); // 写端点都回 UserInfo，但配额也要刷新，重拉聚合最省心
    }
  };

  const save = async () => {
    const jobs: Promise<unknown>[] = [];
    if (nicknameDirty) {
      const invalid = validateNickname(nickname);
      if (invalid) {
        setErr(new ApiError('business', 100111, invalid, 'BIZ_PROFILE_PARAM_INVALID'));
        return;
      }
      jobs.push(setNicknameApi(jwt, nickname.trim()));
    }
    if (usernameDirty) {
      if (!USERNAME_RE.test(username.trim())) {
        setErr(new ApiError('business', 100111, '用户名只允许 1–128 位 A-Za-z0-9_', 'BIZ_PROFILE_PARAM_INVALID'));
        return;
      }
      jobs.push(setUsername(jwt, username.trim()));
    }
    if (bioDirty) {
      // bio 必须显式出现在请求体（清空传空串）；本地按字符限长。
      if (charLength(bio) > BIO_MAX_CHARS) {
        setErr(new ApiError('business', 100111, `简介最多 ${BIO_MAX_CHARS} 个字符`, 'BIZ_PROFILE_PARAM_INVALID'));
        return;
      }
      jobs.push(setBioApi(jwt, bio));
    }
    if (jobs.length === 0) {
      setNotice('没有改动过的字段，未发请求');
      return;
    }
    await run(`保存（${jobs.length} 个字段）`, async () => {
      await Promise.all(jobs);
    });
  };

  const openPicker = async () => {
    setPickerOpen((v) => !v);
    if (!pickerOpen && presets.length === 0) {
      try {
        const [p, h] = await Promise.all([getAvatarPresets(jwt), getAvatarHistory(jwt)]);
        setPresets(p.data.presets ?? []);
        setHistory(h.data.items ?? []);
      } catch (e) {
        setErr(e as ApiError);
      }
    }
  };

  const saveAvatar = () => {
    if (!picked) return;
    void run('更换头像', async () => {
      await setAvatar(jwt, picked);
      setPicked(null);
      setPickerOpen(false);
    });
  };

  const doImport = () => {
    if (importFields.size === 0) return;
    void run('从 X 导入资料', async () => {
      const res = await importProfileFromX(jwt, [...importFields]);
      const skipped = res.data.skipped ?? [];
      setNotice(
        skipped.length
          ? `导入完成，跳过：${skipped.map((s) => `${s.field}（${SKIPPED_REASON_LABEL[s.reason] ?? s.reason}）`).join('、')}`
          : '导入完成（不占修改次数）',
      );
    });
  };

  return (
    <div className="space-y-4">
      <SettingsNav active="/settings/profile" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground text-sm">
          进入页面只打一次 GET /v1/profile；Save 只提交改动过的字段。{loading && ' （加载中…）'}
        </p>
      </header>

      {user && (
        <Card>
          <CardContent className="space-y-4">
            {/* 头像 + 展示名 */}
            <div className="flex items-center gap-4">
              <AvatarImg url={user.avatar_url} nickname={user.nickname ?? user.identifier} size={64} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.nickname || '(未设置昵称)'}</div>
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {user.username ? `@${user.username}` : '(未设置 handle)'} · {user.identifier}
                </div>
              </div>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => void openPicker()}>
                {pickerOpen ? '收起头像选择' : '更换头像'}
              </Button>
            </div>

            {pickerOpen && (
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <div>
                  <div className="mb-1.5 text-xs font-medium">预设（8 张）</div>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPicked({presetId: p.id})}
                        className={cn(
                          'overflow-hidden rounded-lg border-2 transition-colors',
                          picked?.presetId === p.id ? 'border-primary' : 'border-transparent hover:border-border',
                        )}
                      >
                        <AvatarImg url={p.url} nickname={p.id} size={48} />
                      </button>
                    ))}
                    {presets.length === 0 && <span className="text-muted-foreground text-xs">加载中…</span>}
                  </div>
                </div>
                {history.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-medium">用过的（含当前 X 头像）</div>
                    <div className="flex flex-wrap gap-2">
                      {history.map((h) => (
                        <button
                          key={h.url}
                          type="button"
                          onClick={() => setPicked({url: h.url})}
                          className={cn(
                            'overflow-hidden rounded-lg border-2 transition-colors',
                            picked?.url === h.url ? 'border-primary' : 'border-transparent hover:border-border',
                          )}
                        >
                          <AvatarImg url={h.url} nickname="历史头像" size={48} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={!picked || busy} onClick={saveAvatar}>
                    保存头像
                  </Button>
                  <span className="text-muted-foreground text-[11px]">
                    只认预设与历史里的 URL（任意外链回 100123）；本期无上传。
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 昵称 / Handle / 简介 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">资料字段</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pf-nickname">Nickname</Label>
              <span className="text-muted-foreground text-[11px]">1–64 字符 · 不限次</span>
            </div>
            <Input id="pf-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            {validateNickname(nickname) && <p className="text-xs text-red-500">{validateNickname(nickname)}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pf-username">Handle</Label>
              <span className="text-muted-foreground text-[11px]">A–Z a–z 0–9 _ · 每 30 天 1 次</span>
            </div>
            <Input
              id="pf-username"
              value={username}
              onChange={(e) => setUsernameDraft(e.target.value)}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {username && !USERNAME_RE.test(username.trim()) && (
              <p className="text-xs text-red-500">只允许字母、数字、下划线（1–128 位）</p>
            )}
            {availText && <p className={cn('text-xs', availText.startsWith('✓') ? 'text-emerald-500' : 'text-red-500')}>{availText}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pf-bio">Bio</Label>
              <span className="text-muted-foreground text-[11px]">
                ≤{BIO_MAX_CHARS} 字符 · {bioDirty ? `本次 ${charLength(bio)} 字` : `当前 ${charLength(bio)} 字`}
              </span>
            </div>
            <textarea
              id="pf-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
              placeholder="空串提交 = 清空简介"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !(nicknameDirty || usernameDirty || bioDirty)} onClick={() => void save()}>
              {busy ? '保存中…' : 'Save（只提交改动过的字段）'}
            </Button>
            {notice && <span className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</span>}
          </div>
        </CardContent>
      </Card>

      {/* X 连接 / 导入 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            X 账号
            {agg?.x?.bound ? (
              <Badge variant="default">
                已绑定 @{agg.x.username || '?'}
                {bindSource === 1 ? ' · X 授权通道' : bindSource === 2 ? ' · Privy 通道' : ''}
              </Badge>
            ) : (
              <Badge variant="secondary">未绑定</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!agg?.x?.bound ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <p className="text-muted-foreground text-xs">绑定后可一键把 X 档案导入本站资料（不占修改次数）。</p>
              <Link href="/login/x">
                <Button size="sm">Connect your X account</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {X_IMPORT_FIELDS.map(({field, label}) => {
                  const privyNoBio = bindSource === 2 && field === 'bio';
                  return (
                    <label
                      key={field}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                        privyNoBio ? 'cursor-not-allowed opacity-50' : '',
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={privyNoBio}
                        checked={importFields.has(field)}
                        onChange={(e) => {
                          setImportFields((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(field);
                            else next.delete(field);
                            return next;
                          });
                        }}
                      />
                      {label}
                      {privyNoBio && <span className="text-muted-foreground">(Privy 通道无简介)</span>}
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={busy || importFields.size === 0} onClick={doImport}>
                  从 X 导入所选字段
                </Button>
                <span className="text-muted-foreground text-[11px]">值取自服务端快照，前端不传任何 X 资料。</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}

/** 头像 <img>：X 头像会 404，onError 兜底首字母块（settings-integration.md §2.5）。 */
function AvatarImg({url, nickname, size}: {url?: string; nickname: string; size: number}) {
  const [broken, setBroken] = useState(false);
  const letter = [...(nickname.trim() || '?')][0] ?? '?';
  if (!url || broken) {
    return (
      <div
        className="bg-muted text-muted-foreground flex items-center justify-center rounded-full font-medium"
        style={{width: size, height: size, fontSize: size / 2.2}}
      >
        {letter.toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="avatar"
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="rounded-full object-cover"
      style={{width: size, height: size}}
    />
  );
}


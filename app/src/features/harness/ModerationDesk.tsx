'use client';

/**
 * 下单页的「敏感词」台：内容审查的正文试判、词条试算、词库增删与统计（与 `/dev/moderation` 同一组面板）。
 *
 * 跟着顶栏的环境开关走：本机打 `/admin/api/v1`（ADMIN_ORIGIN），测试环境打 `/test-env/admin/api/v1`
 * （TEST_ADMIN_ORIGIN，默认 sm-admin-test-api）。**管理后台是另一套身份**：管理员账号口令换来的会话，
 * 与顶栏那次 Privy 登录互不相认，所以这里有自己的登录；会话按环境分开存（两个环境是两套管理员）。
 */
import {useCallback, useEffect, useState, type CSSProperties} from 'react';

import {changePassword, configureAdmin, describeError, getToken, isPasswordChangeRequired, login, setToken} from '@/api/admin-moderation';
import {ApiError} from '@/api/envelope';
import {ModerationPanels} from '@/features/moderation/ModerationConsole';

import {API_PREFIX, CURRENT_ENV} from './envs.browser';
import {Btn, Card, Field, Info, Note} from './ui';

// 模块求值时定一次：环境整页只定一次（切换靠整页刷新，见 envs.ts）。
configureAdmin({prefix: API_PREFIX, sessionKey: CURRENT_ENV.key});

export function ModerationDesk({
  prefill,
  say,
}: {
  prefill: {text: string; nonce: number} | null;
  say: (text: string, bad?: boolean) => void;
}) {
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  // 首次登录 / 口令被重置：会话已签发，但改口令之前服务端只放行改口令本身（其余 400704）。
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  useEffect(() => setAuthed(Boolean(getToken())), []);

  const onError = useCallback(
    (e: unknown) => {
      // 会话失效：客户端已清 token，这里切回登录。
      if (e instanceof ApiError && e.code === 400700) setAuthed(false);
      if (isPasswordChangeRequired(e)) {
        setAuthed(false);
        setMustChange(true);
      }
      const text = describeError(e);
      setErr(text);
      setNotice('');
      say(`敏感词台：${text}`, true);
    },
    [say],
  );
  const onOk = useCallback(
    (text: string) => {
      setNotice(text);
      setErr('');
      say(`敏感词台：${text}`);
    },
    [say],
  );

  const doLogin = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await login(username, password);
      if (r.mustChangePassword) {
        // 口令先留在内存里当「当前口令」，改完即清。
        setMustChange(true);
        say(`敏感词台：已登录（${CURRENT_ENV.label}），首次登录须先改口令`);
        return;
      }
      setPassword('');
      setAuthed(true);
      say(`敏感词台：已登录管理后台（${CURRENT_ENV.label}）`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  // 与服务端 session.ValidatePassword 同一口径：≥ 12 位、同时含字母与数字、≤ 72 字节。
  const pwProblem =
    newPw.length < 12
      ? '至少 12 位'
      : !/[A-Za-z]/.test(newPw) || !/[0-9]/.test(newPw)
        ? '要同时含字母与数字'
        : new TextEncoder().encode(newPw).length > 72
          ? '不超过 72 字节'
          : newPw === password
            ? '不能与当前口令相同'
            : newPw !== newPw2
              ? '两次输入不一致'
              : '';

  const doChange = async () => {
    setBusy(true);
    setErr('');
    try {
      await changePassword(password, newPw);
      setPassword('');
      setNewPw('');
      setNewPw2('');
      setMustChange(false);
      setAuthed(true);
      setNotice('口令已修改，已进入管理后台');
      say(`敏感词台：口令已修改（${CURRENT_ENV.label}）`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="敏感词"
      hero
      right={
        authed ? (
          <>
            <span className="hint tight">管理后台 · {CURRENT_ENV.label}</span>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setToken('');
                setAuthed(false);
              }}
            >
              退出后台
            </Btn>
          </>
        ) : undefined
      }
    >
      {err && <Note tone="err">{err}</Note>}
      {notice && <Note tone="ok">{notice}</Note>}

      {!authed && mustChange ? (
        <>
          <Note tone="warn">
            这个账号<b>首次登录</b>（或口令被他人重置）：服务端要求先改口令，改之前除了改口令什么都会回{' '}
            <code className="code">400704 password change required</code>。
          </Note>
          <div className="form">
            <div className="f">
              <label htmlFor="mod-old">当前口令<span className="u">刚才登录用的那个</span></label>
              <input id="mod-old" className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="mod-new">新口令<span className="u">≥ 12 位，同时含字母与数字</span></label>
              <input id="mod-new" className="inp" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="mod-new2">再输一次新口令</label>
              <div className="with">
                <input
                  id="mod-new2"
                  className="inp"
                  type="password"
                  autoComplete="new-password"
                  value={newPw2}
                  onChange={(e) => setNewPw2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password && !pwProblem) void doChange();
                  }}
                />
                <Btn size="sm" variant="primary" busy={busy} disabled={busy || !password || Boolean(pwProblem)} onClick={() => void doChange()}>
                  改口令并进入
                </Btn>
              </div>
            </div>
          </div>
          {newPw && pwProblem && <p className="hint tight">新口令：{pwProblem}</p>}
        </>
      ) : !authed ? (
        <>
          <Note tone="info">
            管理后台是<b>另一套身份</b>（管理员账号，不是顶栏那次 Privy 登录）。当前环境「{CURRENT_ENV.label}」，请求走{' '}
            <code className="code">{API_PREFIX}/admin/api/v1</code>。账号需有 <code className="code">moderation:read</code>（试判、试算、统计）/
            <code className="code">moderation:write</code>（增删）。
          </Note>
          <div className="form">
            <Field label="管理员账号" value={username} onChange={setUsername} placeholder="username" />
            <div className="f">
              <label htmlFor="mod-pw">口令</label>
              <div className="with">
                <input
                  id="mod-pw"
                  className="inp"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && username && password) void doLogin();
                  }}
                />
                <Btn size="sm" variant="primary" busy={busy} disabled={busy || !username || !password} onClick={() => void doLogin()}>
                  登录后台
                </Btn>
              </div>
            </div>
          </div>
          {prefill && <p className="hint tight">登录后自动试判「观点」台带过来的那段正文。</p>}
        </>
      ) : (
        // 面板用的是 `/dev/moderation` 那一份（产品设计系统的样式），与下单页的卡片风格略有不同 ——
        // 两处共用一份实现，比各写一套、日后各改各的强。
        // harness 的 CSS 作用域把 `--muted` 定义成了**背景色**（#1B2338），而这组面板的 `text-muted`
        // 读的是同名变量 —— 不改回来，灰字会与底色融在一起看不见（2026-09-30 实测）。
        <div className="text-sm text-foreground" style={{'--muted': 'var(--muted-fg)'} as CSSProperties}>
          <ModerationPanels onError={onError} onOk={onOk} prefill={prefill} />
        </div>
      )}

      <Info label="说明 · 这张卡">
        <p className="hint">
          <b>正文试判</b>用与发帖同一份规则快照判一段正文：会不会拦、命中哪条（内嵌 / 运营动态）、原样还是字间插符号、
          命中片段在规整后的正文里的位置。只读：不写表、不计拦截统计（不会触发拦截占比告警）、不调云二审。
        </p>
        <p className="hint tight">
          多副本时试判答的是应答那个副本，看结果里的词库版本 <code className="code">basic-v3+r&lt;n&gt;</code>；
          刚加 / 刚下线的规则最迟 30 秒各副本追平。
        </p>
      </Info>
    </Card>
  );
}

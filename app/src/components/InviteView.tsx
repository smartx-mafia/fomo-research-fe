'use client';

import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  bindInvite,
  getInviteInfo,
  getInviteStatus,
  INVITE_CODE_RE,
  listInvitees,
  normalizeCode,
  type Invitee,
  type InviteInfoReply,
  type InviteStatusReply,
} from '@/api/invite';
import {CopyButton} from '@/components/CopyButton';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {useSession} from '@/session/storage';

/** 关系来源的分文案（invite.md §3.6）：1 冻结名单导入单列，其余归「其它」。 */
function sourceLabel(source: number | undefined): string {
  if (source === 1) return '名单导入';
  if (source === 3) return '注册时用码';
  if (source === 4) return '无码挂默认';
  if (source === 6) return '存量回填';
  if (source === 7) return '事后绑定';
  return '其它';
}

function fmtTime(unix: number | string | undefined): string {
  if (unix === undefined || unix === '') return '—';
  return new Date(Number(unix) * 1000).toLocaleString();
}

/**
 * 邀请页（invite.md §3）：准入状态机 + 我的邀请码 + 我邀请的人。
 *
 * 两个「不是错误」的状态要显式处理：
 * - `/info` 回 430114：码在准入时才生成 —— 先看 /status 再决定要不要请求它，
 *   这里的 430114 = 「还没绑」（不强制准入时），引导去 bind，不当报错页。
 * - `inviter` / 列表项的 handle 与头像可能缺席（对方没设置）：卡片兜底展示，
 *   「没 handle」≠「没上级」。
 */
export function InviteView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;

  const [status, setStatus] = useState<InviteStatusReply | null>(null);
  const [info, setInfo] = useState<InviteInfoReply | null>(null);
  const [infoBlocked, setInfoBlocked] = useState(false); // 430114：还没绑，不是错误
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  const loadPage = useCallback(
    async (cursor?: string) => {
      if (!jwt) return;
      setLoading(true);
      setErr(null);
      try {
        const [st, list] = await Promise.all([
          getInviteStatus(jwt),
          listInvitees(jwt, cursor, 20),
        ]);
        setStatus(st.data);
        setInvitees((prev) => (cursor ? [...prev, ...(list.data.items ?? [])] : (list.data.items ?? [])));
        setNextCursor(list.data.next_cursor ?? null);
        // info 只在准入后请求；430114 在这里 = 还没绑（引导 bind），不是故障。
        try {
          const inf = await getInviteInfo(jwt);
          setInfo(inf.data);
          setInfoBlocked(false);
        } catch (e) {
          const apiErr = e as ApiError;
          if (apiErr.kind === 'business' && apiErr.code === 430114) {
            setInfo(null);
            setInfoBlocked(true);
          } else {
            throw apiErr;
          }
        }
      } catch (e) {
        setErr(e as ApiError);
      } finally {
        setLoading(false);
      }
    },
    [jwt],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  if (!jwt) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p>邀请信息需要登录后查看。</p>
          <Link href="/login">
            <Button size="sm">去登录</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const normalized = normalizeCode(code);
  const formatOk = INVITE_CODE_RE.test(normalized);

  /** 分享链接由前端拼（invite.md §8 第 3 条：回包没有 invite_link）。 */
  const shareLink =
    info && typeof window !== 'undefined'
      ? `${window.location.origin}/login?invite_code=${info.invite_code}`
      : '';

  const doBind = async (withCode: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await bindInvite(jwt, withCode && normalized ? normalized : undefined);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
      await loadPage();
    }
  };

  const admitted = !!status?.admitted;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">邀请</h1>
        <p className="text-muted-foreground text-sm">
          准入状态、我的邀请码与我邀请的人（GET /v1/invite/{'{status,info,list}'}）。
        </p>
      </header>

      {/* 准入状态机 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            准入状态
            {status && (
              <>
                <Badge variant="secondary">阶段 {status.phase}</Badge>
                {status.admission_optional && <Badge variant="outline">不强制准入</Badge>}
                <Badge variant={admitted ? 'default' : 'destructive'}>
                  {admitted ? `已准入（${status.origin ?? 'app'}）` : '未准入'}
                </Badge>
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {status?.inviter ? (
            <p className="text-muted-foreground text-xs">
              我的上级：
              {status.inviter.pending
                ? '等待加入（名单里未认领）'
                : `@${status.inviter.handle || '(未设置用户名)'}`}
              （绑定一次确定、永不改变）
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {status?.admission_optional
                ? '当前未绑上级 —— 不强制准入时可以直接用；想绑随时在下面绑。'
                : '暂无上级信息。'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 我的邀请码（准入后才有） */}
      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">我的邀请码</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-lg tracking-widest">
                {info.invite_code}
              </code>
              <CopyButton value={info.invite_code} label="复制邀请码" />
              {shareLink && <CopyButton value={shareLink} label="复制邀请链接" />}
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>
                已邀请 {info.invitee_count ?? 0} 人（含名单里还没认领的）
                {info.invitee_quota !== undefined && ` · 还能邀 ${info.invitee_quota} 人`}
                {info.level_name && ` · 等级 ${info.level_name}`}
              </span>
              <span>准入于 {fmtTime(info.admitted_at)} · 链接由前端拼、后端只认码</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 未准入 / 未绑：bind 入口（正常路径不需要，这里是兜底 + 不强制期间的主动绑定） */}
      {!admitted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">绑定邀请码（准入）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {infoBlocked && (
              <p className="text-muted-foreground text-xs">
                还没有邀请码 —— 码在准入（bind）时生成。绑定一次即准入。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="邀请码（8 位，留空走默认绑定）"
                className="max-w-xs font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button size="sm" disabled={busy || (code.trim() !== '' && !formatOk)} onClick={() => void doBind(true)}>
                {busy ? '绑定中…' : '绑定'}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void doBind(false)}>
                无码准入（跳过）
              </Button>
            </div>
            {code.trim() !== '' && !formatOk && (
              <p className="text-xs text-red-500">邀请码是 8 位小写字母数字，不收 @handle</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 我邀请的人 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            我邀请的人
            {loading && <span className="text-muted-foreground text-xs">加载中…</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invitees.length === 0 && !loading ? (
            <p className="text-muted-foreground text-xs">还没有人绑到你名下。</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {invitees.map((it, i) => (
                <li key={`${it.bound_at}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-32 shrink-0 truncate">
                    {it.pending ? '（等待认领）' : it.handle ? `@${it.handle}` : '（未设置用户名）'}
                  </span>
                  <Badge variant="outline">{sourceLabel(it.source)}</Badge>
                  <span className="text-muted-foreground text-xs">绑定于 {fmtTime(it.bound_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {nextCursor && (
            <Button className="mt-3" size="sm" variant="outline" disabled={loading} onClick={() => void loadPage(nextCursor)}>
              加载更多
            </Button>
          )}
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}

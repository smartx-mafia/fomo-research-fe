'use client';

import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  getInviteInfo,
  getInviteStatus,
  listInvitees,
  normalizeNextAction,
  type Invitee,
  type InviteInfoReply,
  type InviteStatusReply,
} from '@/api/invite';
import {BindInviteCard} from '@/components/BindInviteCard';
import {CopyButton} from '@/components/CopyButton';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {useSession} from '@/session/storage';

/**
 * 关系来源分文案（invite.md §3.5 的 source 字段）：1 名单导入 / 6 存量回填 /
 * 7 登录后 bind 带码 / 8 登录后 bind 无码挂默认；3 / 4 是 2026-09-11 之前
 * 登录期绑定的历史值（新行不再产生，但旧数据里还在）；2 / 5 是空号。
 * 读到任何新值一律「其它」—— 不猜语义。
 */
export function sourceLabel(source: number | undefined): string {
  if (source === 1) return '名单导入';
  if (source === 6) return '存量回填';
  if (source === 7) return '登录后带码绑定';
  if (source === 8) return '无码挂默认';
  if (source === 3 || source === 4) return '历史值（登录期绑定）';
  return '其它';
}

function fmtTime(unix: number | string | undefined): string {
  if (unix === undefined || unix === '') return '—';
  return new Date(Number(unix) * 1000).toLocaleString();
}

/** 等待页倒计时（invite.md §4.6）：粒度到分，超过一天只看天。 */
function fmtCountdown(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${sec % 60} 秒`;
}

/** 准入来源（invite.md §3.1 origin）：waitlist=名单认领 / app=自主绑定 / 空串=未准入。 */
function originLabel(origin: InviteStatusReply['origin']): string {
  if (origin === 'waitlist') return '名单认领';
  if (origin === 'app') return '自主绑定';
  return '';
}

/**
 * 邀请页（invite.md §2 / §3 / §4，2026-09-11 BREAKING 后的形态）。
 *
 * 状态机只认一件事：GET /v1/invite/status 的 `next_action`
 * （normalizeNextAction 归一，不认识的值按 wait，落在不放行的一侧）——
 * 不自己从 admitted + phase 推导，phase 只作展示（invite.md §2.2）。分支：
 * - `enter`：已准入 → 此时才请求 /info 与 /list，展示邀请码与我邀请的人；
 * - `bind`：宿主 BindInviteCard（§4 的输入框 / 防抖预检 / Skip 门控 /
 *   逐码处置全在卡里），绑定成功（含 430111 并发）回 /status 重判；
 * - `wait`：等待页（§4.6）—— 按 bind_opens_at 倒计时，到点 / 回到前台 /
 *   手动按钮都重新调 /status，**不直接调 bind**；行情可看、写动作会吃 430114。
 *
 * 两个「不是错误」的信号就地消化（invite.md §4.7 / §3.5）：
 * - 任何端点回 430114（未准入）→ 回 /status 重判，不当报错页、不清 token；
 * - /list 的坏 cursor 100124 → 丢弃 cursor 重拉首页。
 *
 * 登录（2026-09-11 起）不再绑定邀请关系、不再收码 —— 绑定只发生在本页的
 * bind 分支；分享链接由前端拼（§0：回包没有 invite_link）。
 */
export function InviteView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;

  // ── /status：唯一分支依据。每次冷启动 / 每次疑似状态变化都回到它。 ──
  const [status, setStatus] = useState<InviteStatusReply | null>(null);
  const [statusErr, setStatusErr] = useState<ApiError | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // ── enter 态的邀请页数据（/info /list 只在准入后请求，invite.md §3.4）──
  const [info, setInfo] = useState<InviteInfoReply | null>(null);
  const [infoErr, setInfoErr] = useState<ApiError | null>(null);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listErr, setListErr] = useState<ApiError | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // 邀请链接 ?invite_code= 预填（与 LoginBench 同一套读取方式：
  // 静态导出没有可用的 SSR 查询参数，挂载后读 window.location.search）。
  const [initialCode, setInitialCode] = useState('');

  // wait 态倒计时（invite.md §4.6）。
  const [waitLeft, setWaitLeft] = useState(0);
  /** 已对哪个 opensAt 做过「到点自动重查」：防止 /status 仍回 wait 时无限重查。 */
  const autoRecheckedRef = useRef(0);

  const nextAction = status ? normalizeNextAction(status.next_action) : null;
  const admitted = !!status?.admitted;
  /** 只在 wait 时非零（invite.md §3.1：其余恒 0）。字符串 / 缺席都按 0 兜底。 */
  const opensAt = Number(status?.bind_opens_at ?? 0) || 0;

  /** GET /v1/invite/status —— 一切分支的总入口；430114 的唯一出口也是它。 */
  const refreshStatus = useCallback(async () => {
    if (!jwt) return;
    setStatusLoading(true);
    setStatusErr(null);
    try {
      const res = await getInviteStatus(jwt);
      setStatus(res.data);
    } catch (e) {
      setStatusErr(e as ApiError);
    } finally {
      setStatusLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // 邀请链接（/login?invite_code=… 的码也可能被带到 /invite）：挂载后读一次，
  // 归一后预填绑定卡。BindInviteCard 只取初始值，必须在它挂载前就绪。
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('invite_code');
    if (fromLink) setInitialCode(fromLink.trim().toLowerCase());
  }, []);

  /**
   * enter 态拉邀请页数据。/info 只有 enter 才请求（未准入回 430114，
   * invite.md §3.4）；万一仍收到 430114（竞态），回 /status 重判而不是报错。
   */
  const loadEnterData = useCallback(async () => {
    if (!jwt) return;
    setInfoErr(null);
    setListErr(null);
    try {
      const inf = await getInviteInfo(jwt);
      setInfo(inf.data);
    } catch (e) {
      const apiErr = e as ApiError;
      if (apiErr.kind === 'business' && apiErr.code === 430114) {
        setInfo(null);
        void refreshStatus();
        return;
      }
      setInfoErr(apiErr);
    }
    setListLoading(true);
    try {
      const list = await listInvitees(jwt, undefined, 20);
      setInvitees(list.data.items ?? []);
      setNextCursor(list.data.next_cursor || null);
    } catch (e) {
      setListErr(e as ApiError);
    } finally {
      setListLoading(false);
    }
  }, [jwt, refreshStatus]);

  useEffect(() => {
    if (nextAction === 'enter') void loadEnterData();
  }, [nextAction, loadEnterData]);

  /** 翻页；坏 / 过期 cursor（100124）的处置是丢弃重拉首页（invite.md §3.5）。 */
  const loadMore = useCallback(async () => {
    if (!jwt || !nextCursor || listLoading) return;
    setListLoading(true);
    setListErr(null);
    try {
      try {
        const list = await listInvitees(jwt, nextCursor, 20);
        setInvitees((prev) => [...prev, ...(list.data.items ?? [])]);
        setNextCursor(list.data.next_cursor || null);
      } catch (e) {
        const apiErr = e as ApiError;
        if (apiErr.kind !== 'business' || apiErr.code !== 100124) throw apiErr;
        const list = await listInvitees(jwt, undefined, 20);
        setInvitees(list.data.items ?? []);
        setNextCursor(list.data.next_cursor || null);
      }
    } catch (e) {
      setListErr(e as ApiError);
    } finally {
      setListLoading(false);
    }
  }, [jwt, nextCursor, listLoading]);

  /**
   * 绑定成功（含 430111 并发已绑好）：回 /status 重判（invite.md §4.4，会是
   * enter）。bind 的回包与 /info 同形，顺手缓存；enter 分支再拉一次权威数据。
   */
  const handleBound = useCallback(
    (bound: InviteInfoReply | null) => {
      if (bound) setInfo(bound);
      void refreshStatus();
    },
    [refreshStatus],
  );

  // wait 态倒计时：每秒重算到 bind_opens_at 的剩余秒；到点自动重新调 /status
  //（窗口由运营控制、本地倒计时不会跟着变，**不要直接调 bind**，invite.md §4.6）。
  useEffect(() => {
    if (nextAction !== 'wait' || !opensAt) {
      setWaitLeft(0);
      return;
    }
    const left = () => Math.max(0, opensAt - Math.floor(Date.now() / 1000));
    setWaitLeft(left());
    const iv = setInterval(() => {
      const rest = left();
      setWaitLeft(rest);
      if (rest === 0) {
        clearInterval(iv);
        // 只对这个窗口自动查一次；/status 仍回 wait（同一个 opensAt）就停，
        // 留给手动按钮，别打满限流。
        if (autoRecheckedRef.current !== opensAt) {
          autoRecheckedRef.current = opensAt;
          void refreshStatus();
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [nextAction, opensAt, refreshStatus]);

  // 回到前台重新判定（invite.md §4.6 的「App 回到前台」）。
  useEffect(() => {
    if (nextAction !== 'wait') return;
    const onFocus = () => void refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [nextAction, refreshStatus]);

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

  /** 分享链接由前端拼（invite.md §0 第 9 条：回包没有 invite_link）。 */
  const shareLink =
    info && typeof window !== 'undefined'
      ? `${window.location.origin}/login?invite_code=${info.invite_code}`
      : '';

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">邀请</h1>
        <p className="text-muted-foreground text-sm">
          准入状态（只看 next_action）· 我的邀请码 · 我邀请的人
          （GET /v1/invite/{'{status,info,list}'}）。
        </p>
      </header>

      {/* /status 失败：分支不了，后面的卡片都不该出现。400000 见 ErrorPanel 指引。 */}
      {statusErr && (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm">准入状态判定失败 —— 后面的分支都取决于它。</p>
            <ErrorPanel err={statusErr} />
            <Button size="sm" variant="outline" disabled={statusLoading} onClick={() => void refreshStatus()}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}
      {!status && !statusErr && (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">正在判定准入状态…</CardContent>
        </Card>
      )}

      {/* 准入状态卡：phase 只作展示；inviter 只在 admitted 时读（invite.md §3.6）。 */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              准入状态
              {status.phase && <Badge variant="secondary">阶段 {status.phase}</Badge>}
              <Badge variant={admitted ? 'default' : 'destructive'}>
                {admitted
                  ? originLabel(status.origin)
                    ? `已准入（${originLabel(status.origin)}）`
                    : '已准入'
                  : '未准入'}
              </Badge>
              {statusLoading && <span className="text-muted-foreground text-xs">重新判定中…</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {admitted && status.inviter ? (
              <p className="text-muted-foreground text-xs">
                我的上级：
                {status.inviter.pending
                  ? '等待加入（名单里未认领）'
                  : status.inviter.handle
                    ? `@${status.inviter.handle}`
                    : '（未设置用户名）'}
                （上级一次绑定、永不改变）
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {nextAction === 'bind'
                  ? '还差绑定上级这一步 —— 绑定完成即准入。'
                  : nextAction === 'wait'
                    ? '当前不在绑定窗口 —— 到点后重新判定，不要直接重试绑定。'
                    : '暂无上级信息。'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* wait：等待页（invite.md §4.6）—— 到点 / 回前台 / 手动都重新调 /status。 */}
      {nextAction === 'wait' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">准入绑定暂未开放</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {opensAt > 0 && waitLeft > 0
                ? `绑定窗口将在约 ${fmtCountdown(waitLeft)} 后开放（到点自动重新判定）。`
                : '窗口应已开放 —— 点击下方按钮重新判定（不要直接重试绑定）。'}
            </p>
            <p className="text-muted-foreground text-xs">
              等待期间行情浏览与搜索不受影响；但任何写操作在准入前都会收到 430114（未准入）。
            </p>
            <Button size="sm" variant="outline" disabled={statusLoading} onClick={() => void refreshStatus()}>
              重新判定准入
            </Button>
          </CardContent>
        </Card>
      )}

      {/* bind：绑定页宿主（invite.md §4）。输入框 / 预检 / Skip / 逐码处置都在卡里。 */}
      {nextAction === 'bind' && (
        <BindInviteCard
          bearer={jwt}
          defaultBindEnabled={status?.default_bind_enabled ?? null}
          onBound={handleBound}
          onWait={() => void refreshStatus()}
          initialCode={initialCode}
          busy={statusLoading}
          heading="还差一步：绑定邀请码（准入）"
        />
      )}

      {/* enter：我的邀请码（/info 只在准入后请求）。 */}
      {nextAction === 'enter' && info && (
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
              <span>已邀请 {info.invitee_count ?? 0} 人（含名单里还没认领的）</span>
              {/* invitee_quota=0 = 不限 / 服务端没开人数限制（invite.md §3.4），不是「还能邀 0 人」。 */}
              {typeof info.invitee_quota === 'number' && (
                <span>{info.invitee_quota > 0 ? `还能邀 ${info.invitee_quota} 人` : '邀请名额不限'}</span>
              )}
              {info.level_name ? <span>等级 {info.level_name}</span> : null}
              <span>准入于 {fmtTime(info.admitted_at)} · 分享链接由前端拼（/login?invite_code=…），后端只认码</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* enter：我邀请的人（/list 在豁免表里，但只在准入后展示）。 */}
      {nextAction === 'enter' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              我邀请的人
              {listLoading && <span className="text-muted-foreground text-xs">加载中…</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitees.length === 0 && !listLoading ? (
              <p className="text-muted-foreground text-xs">还没有人绑到你名下。</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {invitees.map((it, i) => (
                  <li key={`${it.bound_at ?? 'na'}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-36 shrink-0 truncate">
                      {it.pending ? '（等待认领）' : it.handle ? `@${it.handle}` : '（未设置用户名）'}
                    </span>
                    <Badge variant="outline">{sourceLabel(it.source)}</Badge>
                    <span className="text-muted-foreground text-xs">绑定于 {fmtTime(it.bound_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor && (
              <Button className="mt-3" size="sm" variant="outline" disabled={listLoading} onClick={() => void loadMore()}>
                加载更多
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* enter 态的局部失败：不影响分支，就地报错。 */}
      {infoErr && <ErrorPanel err={infoErr} />}
      {listErr && <ErrorPanel err={listErr} />}
    </div>
  );
}

import {CheckCircle2, CircleDashed} from 'lucide-react';

import {CopyButton} from '@/components/CopyButton';
import {SecretField} from '@/components/SecretField';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {BUSINESS_ORIGIN_LABEL, sameBusinessEnvironment} from '@/config';
import {decodeJwtPayload, humanDuration, secondsLeft} from '@/lib/jwt';
import type {SiteSession} from '@/session/storage';

/**
 * 本站会话（localStorage）。与 Privy 卡片并列但**完全独立**。
 *
 * 特别注意「Privy 匿名 + 本站有效」是**合法组合**，不是 bug：
 * 本站 JWT 有 3 天寿命，与 Privy 会话（约 1 小时）互不相干。
 * 所以这里没有任何 "Privy 掉线就清本站 token" 的逻辑 ——
 * 那会让一个还有两天寿命的 JWT 被连坐清掉。
 */
export function SessionCard({
  session,
  onClear,
  onFetchInfo,
  fetching,
}: {
  session: SiteSession | null;
  onClear: () => void;
  onFetchInfo: () => void;
  fetching: boolean;
}) {
  const payload = session ? decodeJwtPayload(session.jwt) : null;
  const left = secondsLeft(payload);
  const expired = left !== null && left <= 0;
  const originMismatch =
    session?.meta?.origin !== undefined && !sameBusinessEnvironment(session.meta.origin, BUSINESS_ORIGIN_LABEL);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {session ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <CircleDashed className="text-muted-foreground size-4" />
          )}
          本站会话（SmartX）
          <Badge variant={session ? (expired ? 'destructive' : 'default') : 'secondary'}>
            {!session ? '未换取' : expired ? '已过期' : `剩余 ${humanDuration(left)}`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!session && (
          <p className="text-muted-foreground text-xs">
            还没有本站 JWT。先在 Privy 侧登录，再用下面的「换取本站 token」。
          </p>
        )}

        {session && (
          <>
            <div className="grid gap-1.5 text-xs">
              <Row label="identifier" value={session.user?.identifier ?? '-'} copyable />
              <Row
                label="is_new"
                value={
                  session.meta?.is_new === undefined ? '-' : session.meta.is_new ? 'true（本次新建）' : 'false（已存在，按 DID 归位）'
                }
              />
              <Row label="auth_method" value={session.meta?.auth_method ?? '-'} />
              <Row label="language" value={session.user?.language || '(空)'} />
              <Row
                label="created_at"
                value={
                  session.user?.created_at
                    ? `${session.user.created_at} → ${new Date(
                        Number(session.user.created_at) * 1000,
                      ).toLocaleString()}`
                    : '-'
                }
              />
              <Row label="签发后端" value={session.meta?.origin ?? '(未记录)'} />
              <Row label="登录 trace_id" value={session.meta?.trace_id ?? '-'} copyable />
            </div>

            {originMismatch && (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <strong>这个 token 不是当前后端签的。</strong>
                <br />
                签发于 <code className="font-mono">{session.meta?.origin}</code>，
                你现在打的是 <code className="font-mono">{BUSINESS_ORIGIN_LABEL}</code>。
                跨后端的 JWT 必然 400000 —— 重新换取即可，不用去查验签。
              </p>
            )}

            <p className="text-muted-foreground text-[11px]">
              有效期由本地解码 JWT 的 exp 得出，<strong>未验签</strong>；
              真判据永远是打一次 /v1/user/info。后端<strong>没有 refresh 机制</strong>，
              过期就得重走一次登录。
            </p>

            <SecretField label="本站 JWT" value={session.jwt} />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onFetchInfo} disabled={fetching}>
                {fetching ? '拉取中…' : '验证：GET /v1/user/info'}
              </Button>
              <CopyButton
                value={JSON.stringify({jwt: session.jwt, user: session.user, meta: session.meta}, null, 2)}
                label="复制整个会话 JSON"
              />
              <Button variant="outline" size="sm" onClick={onClear}>
                清除本站 token
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({label, value, copyable}: {label: string; value: string; copyable?: boolean}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <code className="font-mono text-[11px] break-all">{value}</code>
      {copyable && value !== '-' && <CopyButton value={value} />}
    </div>
  );
}

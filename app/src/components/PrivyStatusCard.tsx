import {CheckCircle2, CircleDashed} from 'lucide-react';

import {CopyButton} from '@/components/CopyButton';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {PRIVY_APP_ID} from '@/config';
import {decodeJwtPayload, humanDuration, secondsLeft} from '@/lib/jwt';

/**
 * Privy 侧的会话状态。与本站会话**刻意分开显示** —— 把两者并成一个
 * "已登录"会造出最难查的状态：Privy 已登录、本站没登录，页面显示已登录
 * 但每个接口都 401。
 */
export function PrivyStatusCard({
  ready,
  authenticated,
  did,
  linkedTypes,
  identityToken,
  onLogout,
}: {
  ready: boolean;
  authenticated: boolean;
  did?: string;
  linkedTypes: string[];
  identityToken: string | null;
  onLogout: () => void;
}) {
  const payload = identityToken ? decodeJwtPayload(identityToken) : null;
  const left = secondsLeft(payload);
  const aud = Array.isArray(payload?.aud) ? payload?.aud[0] : payload?.aud;

  // 这三项对上，就意味着后端一定验得过（后端的验签公钥已确认与 Privy 一致）。
  // 把这个判断提前到浏览器里，省掉一整轮"后端为什么 400100"的日志排查。
  const checks = payload
    ? [
        {label: 'iss = privy.io', ok: payload.iss === 'privy.io', got: String(payload.iss)},
        {label: `aud = ${PRIVY_APP_ID}`, ok: aud === PRIVY_APP_ID, got: String(aud)},
        {
          label: 'sub 以 did:privy: 开头',
          ok: typeof payload.sub === 'string' && payload.sub.startsWith('did:privy:'),
          got: String(payload.sub),
        },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {authenticated ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <CircleDashed className="text-muted-foreground size-4" />
          )}
          Privy 会话
          <Badge variant={authenticated ? 'default' : 'secondary'}>
            {!ready ? '加载中' : authenticated ? '已登录' : '未登录'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!authenticated && (
          <p className="text-muted-foreground text-xs">
            用下面的邮箱验证码登录。这一步完全在 Privy 侧，还没有碰到我们的后端。
          </p>
        )}

        {authenticated && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">DID</span>
              <code className="font-mono text-[11px] break-all">{did ?? '-'}</code>
              {did && <CopyButton value={did} />}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">绑定</span>
              {linkedTypes.length === 0 ? (
                <span className="text-xs">(空)</span>
              ) : (
                linkedTypes.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-[10px]">
                    {t}
                  </Badge>
                ))
              )}
            </div>

            <div className="text-xs">
              <span className="text-muted-foreground">identity token </span>
              {identityToken ? (
                <span>
                  已取得，剩余 <strong>{humanDuration(left)}</strong>
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">尚未取得</span>
              )}
            </div>

            {/* 已登录却没有 identity token = 这个 Privy app 没开这项功能。
                不写出来的话，这一格只是「尚未取得」，看起来像还没轮询到。 */}
            {authenticated && !identityToken && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
                Privy 已登录却没有 identity token —— 这个 app 的
                <strong>「Return user data in an identity token」是关的</strong>
                （Dashboard → User management → Authentication → Advanced）。
                开之前换取一定失败：access token 有，但它没有 linked_accounts，后端用不了。
              </p>
            )}

            {checks.length > 0 && (
              <div className="space-y-1 rounded-md border p-2">
                <p className="text-muted-foreground text-[11px]">
                  identity token 自检（仅本地解码，<strong>未验签</strong>）。
                  三项全绿 = 后端一定验得过。
                </p>
                {checks.map((c) => (
                  <div key={c.label} className="flex items-start gap-1.5 font-mono text-[11px]">
                    <span className={c.ok ? 'text-emerald-500' : 'text-red-500'}>
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <span className={c.ok ? '' : 'text-red-500'}>
                      {c.label}
                      {!c.ok && <> —— 实际 {c.got}</>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={onLogout}>
              退出 Privy
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

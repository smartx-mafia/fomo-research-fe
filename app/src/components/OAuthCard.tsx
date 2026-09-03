import {RefreshCw} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {PRIVY_APP_ID} from '@/config';
import type {OAuthAvail} from '@/hooks/useOAuthAvail';

/**
 * Google / Apple 的入口。
 *
 * **线通着、闸断着、闸上写清楚为什么断。** 代码路径是完整的
 * （见 App.tsx 的 useLoginWithOAuth 接线），dashboard 一开、env 一置，
 * 刷新本页就能用，不需要改任何代码 —— 留个 TODO 不算预留。
 *
 * 按钮禁用时必须把原因写在旁边：否则「点不亮」会被当成本页的 bug。
 */
export function OAuthCard({
  avail,
  onStart,
  busy,
}: {
  avail: OAuthAvail;
  onStart: (provider: 'google' | 'apple') => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1b · 第三方登录（预留）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['google', 'apple'] as const).map((p) => {
            const enabled = avail[p] && !busy;
            return (
              <Button
                key={p}
                variant="outline"
                disabled={!enabled}
                aria-disabled={!enabled}
                title={
                  avail[p]
                    ? `使用 ${p} 登录`
                    : 'Privy 控制台未开启此登录方式（不是本页的 bug）'
                }
                onClick={() => onStart(p)}
              >
                {p === 'google' ? 'Google' : 'Apple'} 登录
                {!avail[p] && <span className="ml-1.5 text-[10px] opacity-70">未启用</span>}
              </Button>
            );
          })}
          <Button variant="ghost" size="sm" onClick={avail.recheck} disabled={avail.loading}>
            <RefreshCw className={`size-3.5 ${avail.loading ? 'animate-spin' : ''}`} />
            重新探测
          </Button>
        </div>

        <p className="text-muted-foreground text-xs">
          {avail.loading
            ? '正在读取 Privy 控制台配置…'
            : avail.error
              ? `无法读取 Privy 配置（${avail.error}），按「未开启」保守处理。`
              : `按钮状态读取于 ${new Date(avail.checkedAt!).toLocaleTimeString()}。`}
        </p>

        {(!avail.google || !avail.apple) && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs underline underline-offset-4">
              为什么点不亮？怎么开？
            </CollapsibleTrigger>
            <CollapsibleContent className="text-muted-foreground mt-2 space-y-1.5 rounded-md border p-3 text-xs">
              <p>
                <strong>前端代码已经接好了</strong>，两道闸都合上才可用：
              </p>
              <p>
                ① <strong>Privy 控制台</strong>：Dashboard → app{' '}
                <code className="font-mono">{PRIVY_APP_ID}</code>（名为 gege） → Login
                methods → 打开 Google / Apple → 保存。
                <br />
                实测当前 <code className="font-mono">google_oauth=false</code>、
                <code className="font-mono">apple_oauth=false</code>。
              </p>
              <p>
                ② <strong>本地硬闸</strong>：在 <code className="font-mono">.env.local</code> 里置{' '}
                <code className="font-mono">VITE_ENABLE_GOOGLE=true</code> /{' '}
                <code className="font-mono">VITE_ENABLE_APPLE=true</code>，然后重启 dev server。
              </p>
              <p>
                两道都合上后刷新本页即可用。之所以默认按「关」渲染：探测不到就放行的话，
                点下去会跳到 Privy 的报错页，回来后整页 state 全丢 ——
                那个症状看起来完全像是本页坏了。
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

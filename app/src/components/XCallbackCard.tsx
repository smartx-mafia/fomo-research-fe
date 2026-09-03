import {ExternalLink} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';

import {CopyButton} from '@/components/CopyButton';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {parseCallbackParams} from '@/lib/xcallback';
import {PENDING_TTL_MS, type XCapture, type XPending} from '@/session/xpending';

/**
 * 第 2 步（发起）与第 ③④ 步（回调 → 提交）。两条回调路径都在这张卡片上：
 *
 *   **自动路径**：redirect_uri 指回 `http://13.52.177.63:7500/x/callback` 时，
 *   页面自己从 URL query 读 code+state 并提交。
 *
 *   **手工兜底**：把地址栏里的**整个回调 URL** 粘进下面的框。
 *   这条路必须有，而且不是"以防万一" —— X 官方文档没写明是否允许
 *   `http://localhost` 作为 Callback URI，这一点**尚未实测**。真不允许的话，
 *   redirect_uri 只能指向别处，用户点完授权会落到一个 404 页面，
 *   但地址栏里那串 `?code=…&state=…` 是完整的，粘回来照样能绑成。
 *   没有这条路的话，整个联调会卡死在一个我们控制不了的第三方登记规则上。
 */
export function XCallbackCard({
  hasJwt,
  busy,
  pending,
  capture,
  onStart,
  onSubmit,
}: {
  hasJwt: boolean;
  busy: boolean;
  pending: XPending | null;
  /** 自动路径抓到的东西（URL query 或本标签页上一次抓到还没提交的）。 */
  capture: XCapture | null;
  onStart: () => void;
  onSubmit: (code: string, state: string) => void;
}) {
  /**
   * `null` = 还没人动过这个框，显示由 capture **派生**出来的值。
   *
   * 不用 useEffect 把 capture 灌进 state：capture 是在页面挂载后的 effect 里
   * 才从地址栏读出来的，"先渲染一次空框、再补上"会让人看到框子闪一下 ——
   * 在一个专门用来看清每一步的调试台上，闪一下就是噪音。
   */
  const [edited, setEdited] = useState<string | null>(null);

  // 抓到回调就填进手工框：即使自动路径已经提交过，人也能一眼看到
  // 「送出去的到底是哪一串」，而不用去翻已经被洗掉的地址栏。
  const derived = useMemo(() => {
    if (!capture) return '';
    const q = new URLSearchParams();
    if (capture.code) q.set('code', capture.code);
    if (capture.state) q.set('state', capture.state);
    if (capture.error) q.set('error', capture.error);
    return `?${q.toString()}`;
  }, [capture]);

  const pasted = edited ?? derived;
  const parsed = useMemo(() => parseCallbackParams(pasted), [pasted]);
  const submittable = Boolean(parsed.code && parsed.state && hasJwt && !busy);
  // 粘进来的 state 与本地发起的那次对不上 —— 后端一定回 400103。
  // 提前说出来，省得人对着"state mismatch"去怀疑后端。
  const stateMismatch =
    parsed.state !== undefined && pending !== null && parsed.state !== pending.state;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">2 · 发起绑定 &amp; 处理回调</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          <Button size="sm" onClick={onStart} disabled={!hasJwt || busy}>
            {busy ? '请求中…' : '发起绑定（POST /v1/user/x/bind/start）'}
          </Button>
          <p className="text-muted-foreground text-xs">
            这一步<strong>不外呼 X、不产生费用</strong>，可以安全重试；
            真正花钱的是下一步的换 token。已绑定时回 430106。
          </p>
        </div>

        {pending && <PendingBlock pending={pending} />}

        <div className="space-y-2">
          <Label htmlFor="x-callback-url">回调 URL（手工兜底）</Label>
          <textarea
            id="x-callback-url"
            rows={3}
            spellCheck={false}
            placeholder="把浏览器地址栏里的整个回调 URL 粘这里，例如 http://13.52.177.63:7500/x/callback?code=…&state=…"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input/30 w-full rounded-lg border bg-transparent px-2.5 py-1.5 font-mono text-[11px] break-all transition-colors outline-none focus-visible:ring-3"
            value={pasted}
            onChange={(e) => setEdited(e.currentTarget.value)}
          />
          <p className="text-muted-foreground text-xs">
            <strong>回调页 404 也没关系</strong> —— 302 之后地址栏里就有 code 与 state，
            整串粘进来即可。这条路在任何 redirect_uri 配置下都能用。
          </p>

          {pasted.trim() !== '' && (
            <div className="space-y-1 rounded-md border p-2 font-mono text-[11px]">
              <div>code = {parsed.code ?? <span className="text-red-500">(没解析到)</span>}</div>
              <div>state = {parsed.state ?? <span className="text-red-500">(没解析到)</span>}</div>
              {parsed.error && (
                <div className="text-amber-600 dark:text-amber-400">
                  error = {parsed.error}
                  {parsed.errorDescription ? ` — ${parsed.errorDescription}` : ''}
                </div>
              )}
            </div>
          )}

          {stateMismatch && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <strong>粘进来的 state 与本地这次发起的不一致。</strong>
              后端会回 <code className="font-mono">400103</code>，
              这不是后端的问题：多半是这串 URL 来自更早的一次发起，或者中途又点了一次「发起绑定」
              （每点一次都换一个新 state，旧的当场作废）。重新走一遍第 2 步。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!submittable}
              onClick={() => onSubmit(parsed.code!, parsed.state!)}
              title={
                hasJwt
                  ? submittable
                    ? '提交给 POST /v1/user/x/bind'
                    : '需要同时解析出 code 与 state'
                  : '没有本站 JWT，四个端点全部会回 400000'
              }
            >
              解析并提交绑定（POST /v1/user/x/bind）
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdited('')} disabled={pasted === ''}>
              清空
            </Button>
          </div>

          <p className="text-muted-foreground text-[11px]">
            <strong>同一份 {'{code, state}'} 只能提交一次。</strong>
            第二次回 <code className="font-mono">400103</code>（不是 100113）——
            state 在第一次提交时就被消费掉了，连换 token 那步都走不到。
            两种情况都要从第 2 步重新发起。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingBlock({pending}: {pending: XPending}) {
  // 秒级刷新只在有 pending 时开着：state 只活 10 分钟，而"还剩多久"正是
  // 这一步唯一会出问题的变量（人在授权页停留太久回来就是 400103）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const leftMs = pending.at + PENDING_TTL_MS - now;
  const expired = leftMs <= 0;
  const left = `${Math.floor(Math.max(leftMs, 0) / 60000)}分${Math.floor((Math.max(leftMs, 0) % 60000) / 1000)}秒`;

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">授权地址已就绪</span>
        <span className={expired ? 'text-red-500' : 'text-muted-foreground'}>
          {expired ? 'state 已过期（再提交必回 400103），重新发起' : `state 剩余 ${left}`}
        </span>
      </div>

      <p className="bg-muted/50 max-h-24 overflow-auto rounded border p-2 font-mono text-[10px] break-all">
        {pending.authorizeUrl}
      </p>

      <div className="flex flex-wrap gap-2">
        {/* **同标签页跳转，故意不开新标签页。** state 存在本标签页的
            sessionStorage 里，新标签页读不到 —— 那边跳回来会显示"没有发起中的绑定"，
            而人明明刚点过。真在新标签页里完成了授权也不算废：手工兜底那条路
            仍然能把地址栏里的 URL 粘回本页。 */}
        <Button size="sm" asChild>
          <a href={pending.authorizeUrl}>
            <ExternalLink className="size-3.5" />
            跳转到 X 授权页（当前标签页）
          </a>
        </Button>
        <CopyButton value={pending.authorizeUrl} label="复制 authorize_url" />
        <CopyButton value={pending.state} label="复制 state" />
      </div>

      <p className="text-muted-foreground font-mono text-[10px] break-all">state={pending.state}</p>
    </div>
  );
}

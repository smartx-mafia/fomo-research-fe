import {BadgeCheck, CheckCircle2, CircleDashed, RefreshCw} from 'lucide-react';
import {useState} from 'react';

import {
  FOLLOW_IMPORT,
  FOLLOW_IMPORT_LABEL,
  type XFollowImport,
  type XProfile,
} from '@/api/ximport';
import {CopyButton} from '@/components/CopyButton';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import type {XBindState} from '@/hooks/useXBind';

/**
 * 当前绑定态 + X 档案 + 关注导入进度。
 *
 * 这张卡片的全部难点都在「零值缺席」上：`count` 为 0、`truncated` 为 false、
 * `synced_at` 为空时这些 key **根本不出现**。所以这里一律用
 * `!count` / `?? '(缺席)'` 判断，并且**把"缺席"当成一个要显示的事实**
 * 打在界面上 —— 联调时最需要看见的就是"后端到底给没给这个字段"。
 */
export function XBindingCard({
  state,
  loading,
  busy,
  polling,
  pollTimedOut,
  onRefresh,
  onUnbind,
  onResumePolling,
}: {
  state: XBindState;
  loading: boolean;
  busy: boolean;
  polling: boolean;
  pollTimedOut: boolean;
  onRefresh: () => void;
  onUnbind: () => void;
  onResumePolling: () => void;
}) {
  const bound = state.kind === 'bound';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {bound ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <CircleDashed className="text-muted-foreground size-4" />
          )}
          1 · 当前绑定状态
          <Badge variant={bound ? 'default' : 'secondary'}>
            {state.kind === 'idle' ? '未查询' : bound ? '已绑定' : '未绑定（200104）'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            GET /v1/user/x/binding
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state.kind === 'idle' && (
          <p className="text-muted-foreground text-xs">还没查过。点右上角拉一次。</p>
        )}

        {state.kind === 'unbound' && (
          <p className="text-muted-foreground text-xs">
            后端明确回了 <code className="font-mono">200104 / BIZ_X_BINDING_NOT_FOUND</code>。
            <strong>这是正常状态，不是错误</strong> —— 这套契约里"没绑定"是一个六位码而不是空数据。
            往下走第 2 步发起绑定。
          </p>
        )}

        {bound && (
          <>
            <ProfileBlock profile={state.binding.profile} />
            <FollowImportBlock
              fi={state.binding.follow_import}
              polling={polling}
              pollTimedOut={pollTimedOut}
              onResumePolling={onResumePolling}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="destructive" size="sm" onClick={onUnbind} disabled={busy}>
                解绑（POST /v1/user/x/unbind）
              </Button>
              <CopyButton value={JSON.stringify(state.binding, null, 2)} label="复制原始回包" />
              <span className="text-muted-foreground text-[11px]">
                拉取于 {new Date(state.at).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-muted-foreground text-[11px]">
              解绑是<strong>逻辑删除</strong>：绑定关系失效，之后查询回 200104；
              可以重新绑定（同一个或另一个 X 账号），重绑会重新导入一次关注列表。
            </p>
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">原始回包 JSON</summary>
              <pre className="bg-muted/50 mt-1.5 max-h-56 overflow-auto rounded-md border p-2 font-mono text-[11px]">
                {JSON.stringify(state.binding, null, 2)}
              </pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileBlock({profile}: {profile?: XProfile}) {
  if (!profile) {
    return (
      <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
        <strong>回包里没有 profile。</strong>
        契约说 bound=true 时它应该在 —— 原样报上去（附 trace_id），不要当成"这个人没资料"。
      </p>
    );
  }
  return (
    <div className="flex items-start gap-3">
      {/* key 挂 URL：换一个绑定时要让新链接重新拿到一次机会，
          否则上一个 404 的头像会把新头像一起判死。 */}
      <Avatar
        key={profile.avatar_url}
        url={profile.avatar_url}
        seed={profile.username ?? profile.x_user_id}
      />
      <div className="grid flex-1 gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{profile.display_name || '(display_name 缺席)'}</span>
          {profile.verified && <BadgeCheck className="size-4 text-sky-500" />}
          {profile.username && (
            <a
              className="text-muted-foreground underline underline-offset-4"
              href={`https://x.com/${profile.username}`}
              target="_blank"
              rel="noreferrer"
            >
              @{profile.username}
            </a>
          )}
        </div>
        {/* x_user_id 永不变，username 用户随时能改 —— 做关联一律用前者，
            所以它在这里是被强调、可复制的那一个。 */}
        <Row label="x_user_id" value={profile.x_user_id} copyable />
        <Row label="粉丝 / 关注" value={`${profile.followers_count ?? 0} / ${profile.following_count ?? 0}`} />
        {profile.description && <Row label="简介" value={profile.description} />}
        <p className="text-muted-foreground text-[11px]">
          粉丝数/关注数是<strong>绑定那一刻的快照</strong>，不是实时值；
          <code className="font-mono">followers_count</code> 为 0 时字段缺席，这里显示的 0 可能是补出来的。
        </p>
      </div>
    </div>
  );
}

/**
 * 头像。**必须兜 onError。**
 *
 * X 给的是 48×48 小图 URL，用户换头像后旧链接直接 404 —— 浏览器画一个碎图标，
 * 而碎图标在这种联调页上会被当成"我们的页面坏了"。回落成 handle 首字母。
 */
function Avatar({url, seed}: {url?: string; seed: string}) {
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-full border font-mono text-lg">
        {seed.slice(0, 1).toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-full border object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function FollowImportBlock({
  fi,
  polling,
  pollTimedOut,
  onResumePolling,
}: {
  fi?: XFollowImport;
  polling: boolean;
  pollTimedOut: boolean;
  onResumePolling: () => void;
}) {
  if (!fi || fi.status === undefined) {
    return (
      <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
        回包里没有 <code className="font-mono">follow_import.status</code>。
        契约里 status 恒为 1/2/3/4，缺席说明形状与契约不符 —— 附 trace_id 报上去。
      </p>
    );
  }

  const status = fi.status;
  // **"没关注任何人"必须写 !count，不能写 count === 0** —— count 为 0 时
  // 这个 key 整个缺席，`=== 0` 拿到的是 undefined，判断恒为 false。
  const noFollowing = status === FOLLOW_IMPORT.SYNCED && !fi.count;

  const tone =
    status === FOLLOW_IMPORT.SYNCED
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : status === FOLLOW_IMPORT.FAILED
        ? 'border-red-500/40 bg-red-500/5'
        : status === FOLLOW_IMPORT.PROTECTED
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-sky-500/40 bg-sky-500/5';

  return (
    <div className={`space-y-1.5 rounded-md border p-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">关注列表导入</span>
        <Badge variant="secondary">
          status={status} · {FOLLOW_IMPORT_LABEL[status]}
        </Badge>
        {polling && <span className="text-muted-foreground">每 5 秒轮询中…</span>}
      </div>

      {status === FOLLOW_IMPORT.PENDING && (
        <p>
          后台任务还没跑完（典型 30 秒内开始）。
          {pollTimedOut ? (
            <>
              {' '}
              <strong>已停止轮询</strong>：超过 2 分钟仍是 PENDING。
              后台仍在重试，稍后回来刷新即可。
            </>
          ) : (
            ' 保持页面开着即可，状态变成 2/3/4 会自动停。'
          )}
        </p>
      )}
      {pollTimedOut && (
        <Button variant="outline" size="sm" onClick={onResumePolling}>
          再等 2 分钟（继续轮询）
        </Button>
      )}

      {status === FOLLOW_IMPORT.SYNCED &&
        (noFollowing ? (
          <p>
            导入完成，<strong>这个人确实没关注任何人</strong>（count 字段缺席 = 0）。
            <br />
            <span className="text-muted-foreground">
              与「账号受保护」（status=4）是两回事：一个是没有，一个是拿不到。
            </span>
          </p>
        ) : (
          <p>
            导入完成，共 <strong>{fi.count}</strong> 条。
            {fi.truncated && (
              <>
                <br />
                <strong>truncated=true</strong>：关注数超出单次导入上限、列表被截断，
                上面这个数是<strong>上限值而非真实关注数</strong>。
              </>
            )}
          </p>
        ))}

      {status === FOLLOW_IMPORT.FAILED && (
        <p>多次尝试后失败（含 X 账号已注销）。<strong>不会再自动重试</strong>；解绑后重绑可再试一次。</p>
      )}

      {status === FOLLOW_IMPORT.PROTECTED && (
        <p>
          该 X 账号是受保护账号，抓取通道<strong>拿不到</strong>关注列表。
          这不是失败也不是"没有关注"。
        </p>
      )}

      <p className="text-muted-foreground font-mono text-[10px]">
        count={fi.count ?? '(缺席=0)'} · synced_at={fi.synced_at ?? '(缺席=未完成)'} ·
        truncated={fi.truncated === undefined ? '(缺席=false)' : String(fi.truncated)}
      </p>
    </div>
  );
}

function Row({label, value, copyable}: {label: string; value: string; copyable?: boolean}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <code className="font-mono text-[11px] break-all">{value}</code>
      {copyable && <CopyButton value={value} />}
    </div>
  );
}

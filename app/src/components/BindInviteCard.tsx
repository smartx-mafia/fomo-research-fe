'use client';

import {useEffect, useRef, useState} from 'react';

import {codeInfo} from '@/api/codes';
import {ApiError} from '@/api/envelope';
import {
  bindInvite,
  checkInviteCode,
  INVITE_CHECK,
  INVITE_CHECK_LABEL,
  INVITE_CODE_RE,
  normalizeCode,
  type InviteInfoReply,
} from '@/api/invite';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';

/**
 * 绑定邀请码卡（invite.md §4 绑定页的核心元素，/invite 与引导页共用）。
 *
 * 契约义务全部在这一个组件里：
 * - 输入框本地正则 `^[a-z0-9]{8}$`（提交前 trim + toLowerCase；不收 @handle、
 *   不替用户去连字符）；格式不过就禁用提交，别把非法输入送到服务端吃限次；
 * - **Skip 按钮只在 defaultBindEnabled === true 时渲染**（false 时渲染了，
 *   点下去必然收 430115）；`null` = /status 还没回来，先不渲染；
 * - 实时校验：防抖 ≥300ms、本地格式通过后才发、**带 JWT**（不带判不出
 *   「你自己的码」）、乱序回包按 seq 丢弃；status=1 只是建议 —— 提交仍要
 *   处理 200108 / 430113 的竞态；
 * - 提交逐码处置（§4.4）：430111 不必展示（回 /status 重判）；430121 转
 *   等待页；430115 隐藏 Skip；420105 按 metadata.retry_after_seconds 倒计时；
 *   500109 / 500097 手动重试不自动重放。
 */
export function BindInviteCard({
  bearer,
  defaultBindEnabled,
  onBound,
  onWait,
  initialCode = '',
  busy = false,
  heading = '绑定邀请码（准入）',
}: {
  bearer: string;
  /** 来自 GET /v1/invite/status 的 default_bind_enabled；null = 还没拉到。 */
  defaultBindEnabled: boolean | null;
  /** 绑定成功（含 430111 —— 并发下已绑好，父组件重拉 /status 确认）。null 表示没有新回包可缓存。 */
  onBound: (info: InviteInfoReply | null) => void;
  /** 430121：窗口没开，父组件应回 /status 走等待页。 */
  onWait?: () => void;
  /** 预填（邀请链接 ?invite_code= 带进来的码），仍要过本地校验。 */
  initialCode?: string;
  /** 父组件层面的忙碌（如刷新 /status 期间）。 */
  busy?: boolean;
  heading?: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [checkText, setCheckText] = useState<{text: string; ok: boolean} | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** 420105 之后 >0：倒计时期间禁用提交与 Skip。 */
  const [retryAfter, setRetryAfter] = useState(0);
  /** 430115 之后隐藏 Skip：服务端在渲染本卡之后关掉了默认绑定。 */
  const [skipHidden, setSkipHidden] = useState(false);
  const checkSeq = useRef(0);

  const normalized = normalizeCode(code);
  const formatOk = INVITE_CODE_RE.test(normalized);
  const inFlight = pending || busy;
  const showSkip = defaultBindEnabled === true && !skipHidden && retryAfter === 0;

  // 实时校验：防抖 ≥300ms，本地格式通过后才发（服务端不查库的非法码别送过去）。
  useEffect(() => {
    if (!formatOk) {
      setCheckText(null);
      return;
    }
    const seq = ++checkSeq.current;
    const t = setTimeout(() => {
      void checkInviteCode(normalized, bearer)
        .then((res) => {
          if (seq !== checkSeq.current) return; // 乱序回包：输入框已变，丢弃
          const status = res.data.status;
          setCheckText({
            text: res.data.message || INVITE_CHECK_LABEL[status] || `未知状态 ${status}`,
            ok: status === INVITE_CHECK.OK,
          });
        })
        .catch(() => {
          if (seq === checkSeq.current) setCheckText(null);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [normalized, formatOk, bearer]);

  // 420105 倒计时（秒；metadata 里是字符串）。
  useEffect(() => {
    if (retryAfter <= 0) return;
    const iv = setInterval(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [retryAfter]);

  /** 逐码处置（invite.md §4.4）。只返回给调用方「是否要重新拉 /status」。 */
  function handleBindError(err: ApiError): void {
    if (err.kind !== 'business') {
      setSubmitErr(err.message);
      return;
    }
    const info = codeInfo(err.code);
    switch (err.code) {
      case 430111:
        // 已绑好（并发请求 / 重复点击）：不展示，回 /status 重判（会是 enter）。
        onBound(null);
        return;
      case 430121:
        // 窗口关了：回 /status（会是 wait），不要重试 bind。
        onWait?.();
        return;
      case 430115:
        // 服务端不允许跳过：隐藏 Skip，要求输入码。
        setSkipHidden(true);
        setSubmitErr(err.message);
        return;
      case 420105: {
        const raw = Number(err.metadata?.retry_after_seconds ?? 0);
        setRetryAfter(Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 60);
        setSubmitErr(err.message);
        return;
      }
      case 430120:
        setSubmitErr(`${err.message} —— ${info?.advice ?? '联系客服'}`);
        return;
      case 500109:
      case 500097:
        // 手动重试，不自动重放。
        setSubmitErr(`${err.message}（请稍后手动重试）`);
        return;
      default:
        // 200108 / 430112 / 430113 / 100124：输入框下报错，让用户核对重输。
        setSubmitErr(info ? `${err.message} —— ${info.advice}` : err.message);
    }
  }

  const submit = async (withCode: boolean) => {
    setPending(true);
    setSubmitErr(null);
    try {
      const res = await bindInvite(bearer, withCode ? normalized : undefined);
      onBound(res.data);
    } catch (e) {
      handleBindError(e as ApiError);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          输入邀请人的 8 位公开码完成准入；上级一次绑定、永不改变（绑错的唯一补救是注销后重登）。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="如 c4w5dldu"
            className="max-w-xs font-mono"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
          />
          <Button
            size="sm"
            disabled={inFlight || !formatOk || retryAfter > 0}
            onClick={() => void submit(true)}
          >
            {inFlight ? '绑定中…' : retryAfter > 0 ? `试码超限，${retryAfter}s 后可重试` : '绑定'}
          </Button>
          {showSkip && (
            <Button
              size="sm"
              variant="outline"
              disabled={inFlight || retryAfter > 0}
              title="不带码绑定（挂到默认邀请人名下），也是一次准入"
              onClick={() => void submit(false)}
            >
              跳过
            </Button>
          )}
        </div>

        {code.trim() !== '' && !formatOk && (
          <p className="text-xs text-red-500">
            {normalized.startsWith('@')
              ? '不接受 @handle —— 只收 8 位公开码'
              : '格式不对：需要 8 位小写字母数字（大小写不敏感）'}
          </p>
        )}
        {formatOk && checkText && (
          <p className={`text-xs ${checkText.ok ? 'text-emerald-500' : 'text-amber-500'}`}>{checkText.text}</p>
        )}
        {submitErr && <p className="text-xs text-red-500">{submitErr}</p>}
        <p className="text-muted-foreground text-[11px]">
          邀请码不区分大小写；只去首尾空白，不去连字符。
        </p>
      </CardContent>
    </Card>
  );
}

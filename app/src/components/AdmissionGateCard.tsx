'use client';

import {useEffect, useRef, useState} from 'react';

import {checkInviteCode, getInviteDefault, INVITE_CODE_RE, ENTRY_CODE_RE, INVITE_CHECK, INVITE_CHECK_LABEL, normalizeCode, type InviteDefaultReply} from '@/api/invite';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';

/**
 * 登录的准入凭据卡：后端回 430115/430116/430113（邀请码）或
 * 430117/430118（入场码）后弹出。用户填码 → 用**同一个 identity token**
 * 重调登录（父组件职责），不要重走 Privy。
 *
 * 两种码分开校验（invite.md §1）：邀请码 8 位、入场码 16 位，
 * 都是小写字母数字、大小写不敏感；`@handle` 一律本地拒掉（服务端回
 * 100124/430116，不查库）。
 */
export function AdmissionGateCard({
  kind,
  reason,
  busy,
  onSubmit,
  onSkip,
}: {
  kind: 'invite' | 'entry';
  /** 给用户看的触发原因（哪一步、哪个码）。 */
  reason: string;
  busy: boolean;
  /** 提交归一化后的码。 */
  onSubmit: (code: string) => void;
  /** 「跳过」（仅邀请码、服务端开着默认绑定时出现）。 */
  onSkip?: () => void;
}) {
  const isInvite = kind === 'invite';
  const [code, setCode] = useState('');
  const [checkText, setCheckText] = useState<string | null>(null);
  const [defaultInviter, setDefaultInviter] = useState<InviteDefaultReply | null>(null);
  const checkSeq = useRef(0);

  const normalized = normalizeCode(code);
  const formatOk = isInvite ? INVITE_CODE_RE.test(normalized) : ENTRY_CODE_RE.test(normalized);

  // 邀请码卡顺带拉默认邀请人：enabled=true 时给「跳过」按钮（跳过=不带码登录）。
  useEffect(() => {
    if (!isInvite) return;
    let cancelled = false;
    getInviteDefault()
      .then((res) => {
        if (!cancelled) setDefaultInviter(res.data);
      })
      .catch(() => {
        /* Optional 端点失败不拦输入 —— 输入框照常可用 */
      });
    return () => {
      cancelled = true;
    };
  }, [isInvite]);

  // 防抖 ≥300ms 的实时校验：只在本地格式通过后发（invite.md §3.4 义务）。
  useEffect(() => {
    if (!isInvite || !formatOk) {
      setCheckText(null);
      return;
    }
    const seq = ++checkSeq.current;
    const t = setTimeout(() => {
      void checkInviteCode(normalized)
        .then((res) => {
          // 回包乱序兜底：只有最新一发才有资格渲染（user.md §3.3 同款义务）。
          if (seq === checkSeq.current) setCheckText(INVITE_CHECK_LABEL[res.data.status] ?? `未知状态 ${res.data.status}`);
        })
        .catch(() => {
          if (seq === checkSeq.current) setCheckText(null);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [normalized, formatOk, isInvite]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {isInvite ? '邀请码' : '入场码'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {isInvite ? '8 位小写字母数字' : '16 位小写字母数字'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">{reason}</p>

        {isInvite && defaultInviter?.enabled && (
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">
            当前为受邀注册阶段。不填码也可以<span className="font-medium">跳过</span>
            （将挂到默认邀请人 {defaultInviter.invite_code ?? ''} 名下）。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={isInvite ? '如 c4w5dldu' : '16 位入场码'}
            className="max-w-xs font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <Button size="sm" disabled={busy || !formatOk} onClick={() => onSubmit(normalized)}>
            {busy ? '登录中…' : isInvite ? '带邀请码登录' : '带入场码登录'}
          </Button>
          {isInvite && defaultInviter?.enabled && onSkip && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onSkip}>
              跳过
            </Button>
          )}
        </div>

        {code.trim() !== '' && !formatOk && (
          <p className="text-xs text-red-500">
            {normalized.startsWith('@')
              ? '不接受 @handle —— 只收 8 位公开码'
              : `格式不对：需要${isInvite ? ' 8' : ' 16'}位小写字母数字`}
          </p>
        )}
        {isInvite && formatOk && checkText && (
          <p
            className={`text-xs ${
              checkText === INVITE_CHECK_LABEL[INVITE_CHECK.OK] ? 'text-emerald-500' : 'text-amber-500'
            }`}
          >
            {checkText}
          </p>
        )}
        <p className="text-muted-foreground text-[11px]">
          重调登录用的是同一个 identity token（还在有效期内），不会重走一遍 Privy 授权。
        </p>
      </CardContent>
    </Card>
  );
}

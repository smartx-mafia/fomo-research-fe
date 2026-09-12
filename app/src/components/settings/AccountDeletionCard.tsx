'use client';

import {useState} from 'react';

import {ApiError} from '@/api/envelope';
import {deleteAccount} from '@/api/user';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {clearSite, useSession} from '@/session/storage';

/** 两步确认要求输入的词（user.md §4：不可逆，必须有二次确认）。 */
const CONFIRM_TEXT = '注销';

/**
 * Danger zone —— 注销账号（user.md §4）：POST /v1/user/delete，请求体恒空对象、
 * 幂等、**不可逆**。两步确认：先点红字按钮展开确认面板，再手动输入「注销」
 * 才放行最终按钮。成功（或 400102 = 账号已注销）→ clearSite() 丢本站 JWT并回
 * 登录页；400101 = 封禁中不能自助注销，提示联系客服且不重试。
 */
export function AccountDeletionCard() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [banned, setBanned] = useState(false);

  // 页面层只在已登录时渲染本卡，这里再兜一道。
  if (!jwt) return null;

  const dropAndGoLogin = () => {
    // §4：注销成功后前端必须立即丢弃本站 JWT 并回到登录态。
    clearSite();
    location.href = '/login';
  };

  const run = () => {
    if (!jwt || busy) return;
    setBusy(true);
    setErr(null);
    void deleteAccount(jwt)
      .then(() => dropAndGoLogin())
      .catch((e: unknown) => {
        const apiErr = e as ApiError;
        if (apiErr.code === 400102) {
          // 账号已是注销态（幂等边界 / 旧 token 打上来）——同样按「该丢 token」处理。
          dropAndGoLogin();
          return;
        }
        if (apiErr.code === 400101) {
          // 封禁中的账号不能自助注销（user.md §5）：引导联系客服，**不要重试**。
          setBanned(true);
          return;
        }
        setErr(apiErr);
      })
      .finally(() => setBusy(false));
  };

  const reset = () => {
    setConfirming(false);
    setText('');
    setErr(null);
    setBanned(false);
  };

  const canConfirm = text.trim() === CONFIRM_TEXT && !busy && !banned;

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">注销后账号与其资产不可恢复。</p>
              <Button
                variant="outline"
                className="border-destructive/60 text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                注销账号
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  <strong>不可逆</strong>；注销后同一 Privy 账号再登录会创建
                  <strong>全新账号</strong>（新 identifier、空资料、新托管钱包），旧账号与其资产不会回来。
                </li>
                <li>封禁中的账号不能自助注销。</li>
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-56"
                  value={text}
                  placeholder={`输入「${CONFIRM_TEXT}」以确认`}
                  disabled={busy || banned}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button variant="destructive" disabled={!canConfirm} onClick={run}>
                  {busy ? '提交中…' : '永久注销'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={reset}>
                  取消
                </Button>
              </div>
              {banned && <p className="text-sm text-red-500">账号已被封禁，请联系客服（不要重试）。</p>}
            </div>
          )}
          {err && <ErrorPanel err={err} />}
        </CardContent>
      </Card>
      <p className="text-muted-foreground px-1 text-[11px]">
        注销成功后本地 JWT 立即丢弃；服务端旧 token 在有效期内仍可能通过其它域的端点（已知服务端缺口），前端不依赖它。
      </p>
    </>
  );
}

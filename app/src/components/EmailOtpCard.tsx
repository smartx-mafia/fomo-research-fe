import {useLoginWithEmail} from '@privy-io/react-auth';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {readLastEmail, writeLastEmail} from '@/session/storage';

/**
 * Email OTP 登录（headless —— 自己做 UI，不用 Privy 的 modal）。
 *
 * 状态完全由 SDK 的 OtpFlowState 驱动，不自己维护第二份 —— 两份状态
 * 一定会有对不上的时候，而对不上的表现是按钮该亮时不亮。
 */
export function EmailOtpCard({
  onLoggedIn,
  onEvent,
}: {
  onLoggedIn: () => void;
  onEvent: (level: 'info' | 'ok' | 'error', step: string, detail?: string) => void;
}) {
  const [email, setEmail] = useState(readLastEmail);
  const [code, setCode] = useState('');

  const {state, sendCode, loginWithCode} = useLoginWithEmail({
    onComplete: ({isNewUser}) => {
      onEvent('ok', 'Privy 登录完成', `isNewUser=${String(isNewUser)}`);
      onLoggedIn();
    },
    onError: (err) => onEvent('error', 'Privy 登录失败', String(err)),
  });

  const sending = state.status === 'sending-code';
  const submitting = state.status === 'submitting-code';
  const awaiting = state.status === 'awaiting-code-input' || submitting;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1 · 邮箱验证码登录</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <div className="flex gap-2">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              disabled={sending}
            />
            <Button
              onClick={() => {
                writeLastEmail(email.trim());
                onEvent('info', '发送验证码', email.trim());
                void sendCode({email: email.trim()}).catch((e: unknown) =>
                  onEvent('error', '发送验证码失败', String(e)),
                );
              }}
              disabled={sending || !email.includes('@')}
            >
              {sending ? '发送中…' : awaiting ? '重发' : '发送验证码'}
            </Button>
          </div>
        </div>

        {awaiting && (
          <div className="space-y-2">
            <Label htmlFor="otp">验证码（6 位）</Label>
            <div className="flex gap-2">
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                disabled={submitting}
              />
              <Button
                onClick={() => {
                  onEvent('info', '提交验证码');
                  void loginWithCode({code}).catch((e: unknown) =>
                    onEvent('error', '提交验证码失败', String(e)),
                  );
                }}
                disabled={submitting || code.length !== 6}
              >
                {submitting ? '登录中…' : '登录'}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              同一个验证码最多试 <strong>5 次</strong>，超了必须重新发送。
            </p>
          </div>
        )}

        {state.status === 'error' && state.error && (
          <p className="text-xs text-red-500">Privy 报错：{String(state.error.message)}</p>
        )}

        <p className="text-muted-foreground text-[11px]">
          当前 Privy 流程状态：<code className="font-mono">{state.status}</code>
        </p>
      </CardContent>
    </Card>
  );
}

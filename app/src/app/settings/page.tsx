'use client';

import Link from 'next/link';

import {SETTINGS_NAV} from '@/components/settings/SettingsNav';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {clearSite, useSession} from '@/session/storage';

/**
 * 设置中心总页（settings-integration.md §1）：纯导航不调接口。
 * Logout 丢本地 JWT（服务端无登出接口，旧 token 到期自然失效）。
 */
export default function SettingsPage() {
  const session = useSession();
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">设置中心 —— 各子页独立调自己的接口，本页不发请求。</p>
      </header>

      <Card>
        <CardContent className="divide-y divide-border">
          {SETTINGS_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-muted-foreground text-xs">{item.desc}</div>
              </div>
              <span className="text-muted-foreground">›</span>
            </Link>
          ))}
          <Link href="/invite" className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
            <div>
              <div className="text-sm font-medium">Invite</div>
              <div className="text-muted-foreground text-xs">邀请码 / 我邀请的人 / 准入状态</div>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <Link href="/onboarding" className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
            <div>
              <div className="text-sm font-medium">Onboarding</div>
              <div className="text-muted-foreground text-xs">引导判定（服务端说该弹哪个）</div>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-sm font-medium">Legal &amp; privacy / Help &amp; support</div>
              <div className="text-muted-foreground text-xs">本期前端写死，无接口。</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground text-xs">
            {session ? `已登录 · ${session.user?.identifier ?? ''}` : '未登录（本站 JWT 不在本地）'}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!session}
            onClick={() => {
              clearSite();
              location.href = '/login';
            }}
          >
            Logout（丢本地 token）
          </Button>
        </CardContent>
      </Card>

      <p className="text-muted-foreground px-1 text-[11px]">FOMO web · settings v1</p>
    </div>
  );
}

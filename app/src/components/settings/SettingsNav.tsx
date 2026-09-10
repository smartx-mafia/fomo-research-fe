'use client';

import Link from 'next/link';

/**
 * 设置中心子页共用的导航（settings-integration.md §1：总页纯导航不调接口，
 * 八项里 Legal / Help 前端写死，Logout 丢本地 JWT）。
 */
export const SETTINGS_NAV = [
  {href: '/settings/profile', label: 'Profile', desc: '头像 / 昵称 / Handle / 简介 / X 导入'},
  {href: '/settings/security', label: 'Security', desc: 'Face ID / 导出记录'},
  {href: '/settings/notifications', label: 'Notifications', desc: '推送 / 关注通知'},
  {href: '/settings/trading', label: 'Trading', desc: '滑点 / 确认条 / 计价'},
  {href: '/settings/preferences', label: 'Preferences', desc: '语言 / 主题'},
] as const;

export function SettingsNav({active}: {active: string}) {
  return (
    <nav className="flex flex-wrap gap-2">
      {SETTINGS_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={
            'rounded-md border px-2.5 py-1 text-xs transition-colors ' +
            (item.href === active
              ? 'border-transparent bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:text-foreground')
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

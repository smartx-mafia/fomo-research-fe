'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';

import {EventLog} from '@/components/EventLog';
import {XBindPage} from '@/components/XBindPage';
import {Button} from '@/components/ui/button';
import {useEventLog} from '@/hooks/useEventLog';
import {readSite} from '@/session/storage';

/**
 * X 绑定台容器（自 privy-login-demo 的 App.tsx x 视图迁移）。
 * /login/x 与 /x/callback 共用它：回调路径必须与后端 redirect_uri 登记
 * 的一致（demo 登记的是 /x/callback）。
 *
 * 挂载门：XBindPage 及其子组件在 render 里直接读 location / sessionStorage，
 * SSR 阶段没有这些 API —— 必须等挂载后再渲染。
 */
export function XBindScreen() {
  const router = useRouter();
  const log = useEventLog();
  const [mounted, setMounted] = useState(false);
  const [jwt, setJwt] = useState<string | null>(null);

  useEffect(() => {
    setJwt(readSite()?.jwt ?? null);
    setMounted(true);
    const onStorage = () => setJwt(readSite()?.jwt ?? null);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!mounted) {
    return <p className="p-6 font-mono text-sm text-muted">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2">
        <Link href="/login">
          <Button size="sm" variant="outline">
            ← 登录联调台
          </Button>
        </Link>
        <Link href="/">
          <Button size="sm" variant="outline">
            行情页
          </Button>
        </Link>
      </nav>

      <XBindPage jwt={jwt} log={log} onGoLogin={() => router.push('/login')} />

      <EventLog entries={log.entries} onClear={log.clear} />
    </div>
  );
}

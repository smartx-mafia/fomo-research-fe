'use client';

import Link from 'next/link';

import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';

/** 设置域所有端点都要求登录（settings.md §0）；无 JWT 时各子页共用的门。 */
export function LoginGate() {
  return (
    <Card>
      <CardContent className="space-y-2 p-6 text-sm">
        <p>这一页是「我的」设置，需要先登录。</p>
        <Link href="/login">
          <Button size="sm">去登录</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

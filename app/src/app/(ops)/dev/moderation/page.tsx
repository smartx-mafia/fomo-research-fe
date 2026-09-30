import {notFound} from 'next/navigation';
import {ENABLE_HARNESS} from '@/config';
import {ModerationClient} from './ModerationClient';

/**
 * `/dev/moderation` —— 内容审查运营动态词库的内部控制台（后端 sx_admin 的 AdminModeration）。
 *
 * 与 `/dev/harness` 同一个开关（NEXT_PUBLIC_ENABLE_HARNESS）、同一个 dev 代理：它是内部工具，
 * 不进产品导航、关着时 404 且不下发代码。不放进 `(harness)` 分组，是因为那一层 layout 要
 * Privy 配置才渲染，而这个页面用的是管理员账号，与 Privy 无关。
 */
export default function DevModerationPage() {
  if (!ENABLE_HARNESS) {
    notFound();
  }
  return <ModerationClient />;
}

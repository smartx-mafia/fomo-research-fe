'use client';

import {Card} from '@/components/ui';
import {HolderListPanel} from './HolderListPanel';

/**
 * 代币详情面的链标识 → 社交面的链 slug（social-follow-holders.md §2：
 * `chain` 是 bsc/solana/base/robinhood/ethereum/arc 小写，**不是**聪明钱面的 `sol`，
 * 传错回 100119）。eth→ethereum、sol→solana 之外小写透传；
 * 归一不出已知 slug 返回 null，调用方整块不渲染。
 */
export function normalizeChainSlug(chain: string): string | null {
  const slug = chain.trim().toLowerCase();
  if (slug === 'eth') return 'ethereum';
  if (slug === 'sol') return 'solana';
  return ['bsc', 'solana', 'base', 'robinhood', 'ethereum', 'arc'].includes(slug) ? slug : null;
}

export function TokenFollowHoldersCard({bearer, chain, address}: {bearer?: string | null; chain: string; address: string}) {
  const slug = normalizeChainSlug(chain);
  if (!bearer || !slug) return null;
  return <Card><p className="border-b border-border px-4 py-2 text-sm text-muted">关注的人持有</p><HolderListPanel key={`${slug}:${address}:${bearer}`} chain={slug} address={address} source="all" scope="following" bearer={bearer} social /></Card>;
}

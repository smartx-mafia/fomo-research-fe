'use client';

import {Card} from '@/components/ui';
import {HolderListPanel} from './HolderListPanel';

export function normalizeChainSlug(chain: string): string | null {
  const slug = chain.trim().toLowerCase();
  if (slug === 'eth') return 'ethereum';
  if (slug === 'sol') return 'solana';
  return ['bsc', 'solana', 'base', 'robinhood', 'ethereum'].includes(slug) ? slug : null;
}

export function TokenFollowHoldersCard({bearer, chain, address}: {bearer?: string | null; chain: string; address: string}) {
  const slug = normalizeChainSlug(chain);
  if (!bearer || !slug) return null;
  return <Card><p className="border-b border-border px-4 py-2 text-sm text-muted">关注的人持有</p><HolderListPanel key={`${slug}:${address}:${bearer}`} chain={slug} address={address} source="all" scope="following" bearer={bearer} social /></Card>;
}

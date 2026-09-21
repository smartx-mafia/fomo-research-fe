'use client';

import Link from 'next/link';
import {useId, useState} from 'react';
import useSWRInfinite from 'swr/infinite';
import {ApiError} from '@/api/envelope';
import {fetchHolderList, fetchFollowedHolderList, holderKey, type HolderSource, type HolderScope, type TokenHolder, type TokenHolderPage} from '@/api/token-holder-list';
import {formatDecimalExact, decimalSign} from '@/lib/exact-decimal';

const basisLabel = {onchain: 'On-chain balance', platform_ledger: 'SmartX ledger', external_snapshot: 'Collected snapshot'};
const money = (value?: string) => value === undefined ? '—' : `$${formatDecimalExact(value, 2)}`;

export function HolderRow({item, chain}: {item: TokenHolder; chain: string}) {
  const ownRemark = item.remark && item.remarkSubject && holderKey(item.remarkSubject) === holderKey(item.identity) ? item.remark : undefined;
  const name = ownRemark || item.name;
  const href = item.identity.type === 'smartx_user' ? `/user/${encodeURIComponent(item.identity.id!)}` : item.identity.type === 'wallet' ? `/smart-money/${encodeURIComponent(chain)}/${encodeURIComponent(item.identity.address!)}` : undefined;
  const title = <span className="truncate text-sm font-semibold text-foreground">{name}</span>;
  const pnl = item.pnlPercent === undefined ? '—' : `${decimalSign(item.pnlPercent) === 1 ? '+' : ''}${formatDecimalExact(item.pnlPercent, 2)}%`;
  return <article className="flex items-center gap-3 border-t border-border px-4 py-3">
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- Public profile URLs use the existing avatar policy. */}
      {item.avatarURL ? <img src={item.avatarURL} alt="" className="size-full object-cover" /> : name.slice(0, 1).toUpperCase()}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex gap-2">{href ? <Link href={href} className="truncate hover:underline">{title}</Link> : title}{item.following ? <span className="text-xs text-accent">{item.followingPrimary ? 'Following' : item.followedSubjects?.some((id) => id.type === 'wallet') ? 'Following wallet' : 'Following related account'}</span> : null}</div>
      <p className="truncate text-xs text-muted">{item.sources.join(' · ') || (item.identity.type === 'wallet' ? 'Wallet' : item.identity.type === 'external_user' ? 'External user' : 'SmartX')} · {basisLabel[item.basis]}</p>
      {(item.wallets?.length ? item.wallets.map((w) => w.address!) : item.walletAddress ? [item.walletAddress] : []).map((address) => <p key={address} className="truncate text-xs text-muted" title={address}>{address}</p>)}
      {item.remark && !ownRemark ? <p className="truncate text-xs text-muted">Followed account note: {item.remark}</p> : null}
      <p className="text-xs text-muted">Held {formatDecimalExact(item.balance, 6)}{item.basis !== 'onchain' ? ` · Cost ${money(item.costUSD)}` : ''}</p>
      {item.freshness === 'stale' ? <p className="text-xs text-muted">Older position snapshot</p> : null}
      {item.sharedWallets ? <p className="text-xs text-muted">Includes shared wallets</p> : null}
      {item.relationState === 'unavailable' ? <p className="text-xs text-muted">Follow status unavailable</p> : null}
    </div>
    <div className="shrink-0 text-right text-sm tabular-nums"><p>{money(item.valueUSD)}</p>{item.basis !== 'onchain' ? <p className={`text-xs ${pnl.startsWith('-') ? 'text-down' : pnl.startsWith('+') ? 'text-up' : 'text-muted'}`}>{pnl}</p> : null}</div>
  </article>;
}

export function HolderListPanel({chain, address, source, scope, bearer, social = false}: {chain: string; address: string; source: HolderSource; scope: HolderScope; bearer?: string; social?: boolean}) {
  const [refresh, setRefresh] = useState(0);
  const instance = useId();
  const {data, error, size, setSize, isValidating, mutate} = useSWRInfinite<TokenHolderPage>(
    (index, previous: TokenHolderPage | null) => index > 0 && !previous?.nextCursor ? null : ['holders-unified', social, chain, address, source, scope, bearer ?? '', refresh, instance, previous?.nextCursor ?? ''],
    ([, , , , , , , , , cursor]: readonly unknown[]) => social ? fetchFollowedHolderList(bearer!, chain, address, String(cursor)) : fetchHolderList(chain, address, {source, scope, bearer, cursor: String(cursor)}),
    {revalidateOnMount: true, revalidateFirstPage: false, revalidateOnFocus: false, shouldRetryOnError: false, persistSize: false},
  );
  const pages = data ?? [], last = pages.at(-1);
  const seen = new Set<string>();
  const items = pages.flatMap((page) => page.items).filter((item) => {if (seen.has(item.key)) return false; seen.add(item.key); return true;});
  const changed = error instanceof ApiError && error.code === 100103;
  const message = changed ? 'Holdings or follows changed. Reload this list.' : error instanceof ApiError && error.code === 400000 ? 'Please sign in again.' : error instanceof ApiError && error.code === 430114 ? 'Complete invite access to see followed holders.' : error instanceof ApiError && error.code === 200309 ? 'This token does not provide on-chain holder data.' : 'Holder data is temporarily unavailable.';
  const coverage = new Set(pages.flatMap((page) => page.coverage));
  if (!data && !error) return <p className="p-4 text-sm text-muted">Loading holders…</p>;
  return <div>
    {!error ? <button type="button" className="mx-4 mb-2 text-xs text-accent" onClick={() => {void setSize(1);setRefresh((v) => v + 1);}}>Refresh holders</button> : null}
    {error ? <div role="alert" className="p-4 text-sm text-muted"><p>{message}</p><button type="button" className="mt-2 text-accent" onClick={() => {if (changed) {void setSize(1);setRefresh((v) => v + 1);} else {void mutate();}}}>Reload</button></div> : null}
    {last ? <p className="px-4 py-2 text-xs text-muted">{last.total} {last.totalIsExact ? 'holders' : 'ledger and external holder records'}{source === 'onchain' ? ' · Top 100 shown' : ''}</p> : null}
    {coverage.has('snapshot_coverage_limited') ? <p className="px-4 pb-2 text-xs text-muted">External holdings have limited snapshot coverage. An empty list does not confirm no holdings.</p> : null}
    {[...coverage].some((c) => c.endsWith('_unavailable')) ? <p className="px-4 pb-2 text-xs text-muted">Some identity or follow information is unavailable.</p> : null}
    {!error && items.length === 0 ? <p className="p-4 text-sm text-muted">No holders found in the available data.</p> : items.map((item) => <HolderRow key={item.key} item={item} chain={chain} />)}
    {last?.nextCursor && !changed ? <button type="button" disabled={isValidating} onClick={() => void setSize(size + 1)} className="mx-4 my-3 text-xs text-accent disabled:opacity-50">{isValidating ? 'Loading…' : 'Load more'}</button> : null}
  </div>;
}

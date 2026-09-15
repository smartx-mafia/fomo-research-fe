'use client';

import Image from 'next/image';
import {ArrowUpRight, LoaderCircle} from 'lucide-react';
import {useState} from 'react';
import type {SquareTradeItem, UserActor} from '@/api/social-content';
import {formatDecimalExact} from '@/lib/exact-decimal';
import {fmtCompact} from '@/lib/format';
import {opinionAge} from '@/lib/opinion-card-display';
import {TokenAvatar} from '@/components/TokenAvatar';
import styles from './SquareOpinionCard.module.css';

export function SquareTradeCard({item, followControl, now}: {
  item: SquareTradeItem;
  followControl?: {phase: 'anonymous' | 'loading' | 'ready' | 'saving' | 'failed'; following?: boolean; onToggle: () => void};
  now: number;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const trade = item.content.trade;
  const isSmartMoney = item.actorType === 'smart_money';
  const profile = isSmartMoney ? item.smartMoney : undefined;
  const actorName = isSmartMoney ? profile?.displayName || profile?.handle || shortAddress(item.actorIdentifier) : actorLabel(item.actor);
  const sourceURL = safeWebURL(profile?.sourceURL);
  const xHandle = profile?.xHandle?.replace(/^@/, '');
  const tokenSymbol = trade.token?.symbol || shortAddress(trade.tokenAddress);
  const tokenHref = `/token/${encodeURIComponent(trade.chain)}/${encodeURIComponent(trade.tokenAddress)}`;
  const occurredSeconds = trade.occurredAt.seconds;
  const sideClass = trade.side === 'buy' ? styles.buy : styles.sell;
  const actorAvatar = safeWebURL(isSmartMoney ? profile?.avatarURL : item.actor.avatarURL);

  return (
    <article className={styles.card} aria-label={`${trade.side} activity by ${actorName}`}>
      <div className={styles.avatar}>
        {actorAvatar && failedAvatar !== actorAvatar ? <Image src={actorAvatar} alt="" width={36} height={36} unoptimized onError={() => setFailedAvatar(actorAvatar)} /> : <span aria-hidden="true">{actorName.slice(0, 1).toUpperCase() || '•'}</span>}
      </div>
      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <div className={styles.nameRow}><span className={styles.name} title={actorName}>{actorName}</span><span className={`${styles.sideBadge} ${sideClass}`}>{trade.side === 'buy' ? 'Buy' : 'Sell'}</span></div>
            {isSmartMoney ? <p className={styles.handle}>
              <span title={item.actorIdentifier}>{shortAddress(item.actorIdentifier)}</span> · {trade.chain}
              {profile?.source ? <> · {sourceURL ? <a href={sourceURL} target="_blank" rel="noreferrer noopener">{profile.source}</a> : profile.source}</> : null}
              {xHandle ? <> · <a href={`https://x.com/${encodeURIComponent(xHandle)}`} target="_blank" rel="noreferrer noopener">@{xHandle}</a></> : null}
            </p> : item.actor.username ? <p className={styles.handle}>@{item.actor.username}</p> : null}
          </div>
          <div className={styles.authorActions}>
            <time className={styles.time} dateTime={occurredSeconds > 0 ? new Date(occurredSeconds * 1000).toISOString() : undefined}>{opinionAge(occurredSeconds, now)}</time>
            {followControl ? <button type="button" className={styles.follow} disabled={followControl.phase === 'loading' || followControl.phase === 'saving'} aria-pressed={followControl.following} aria-label={followControl.phase === 'failed' ? `Retry follow status for ${actorName}` : followControl.following ? `Unfollow ${actorName}` : `Follow ${actorName}`} onClick={followControl.onToggle}>
              {followControl.phase === 'loading' || followControl.phase === 'saving' ? <LoaderCircle className={styles.spinner} size={13} aria-hidden="true" /> : null}
              {followControl.phase === 'failed' ? 'Retry status' : followControl.phase === 'loading' ? 'Checking…' : followControl.phase === 'saving' ? 'Saving…' : followControl.following ? 'Following' : 'Follow'}
            </button> : null}
          </div>
        </header>

        <div className={styles.tradePosition}>
          <TokenAvatar chain={trade.chain} address={trade.tokenAddress} size={32}
            fallbackLogo={trade.token?.logo} fallbackSymbol={tokenSymbol} fallbackName={trade.token?.name} />
          <div className={styles.tokenInfo}>
            <div className={styles.positionLabel}>{trade.chain} · {trade.side === 'buy' ? 'Bought' : 'Sold'}</div>
            <p className={styles.symbol}><a href={tokenHref}>{tokenSymbol}</a></p>
            <p className={styles.tradeAmount}>{trade.tokenAmount ? `${formatDecimalExact(trade.tokenAmount, 4)} ${tokenSymbol}` : 'Token amount unavailable'}</p>
          </div>
          <div className={styles.tradeValues}>
            <span className={styles.tradeUsd} title={trade.usd ? 'Trade value (USD)' : 'Trade value unavailable'}>{trade.usd ? `$${formatDecimalExact(trade.usd)}` : '—'}</span>
            <span className={styles.tradeMarketCap} title={trade.marketCapUSDAtTrade ? 'Circulating market cap at trade time (USD)' : 'Market cap at trade time unavailable'}>{trade.marketCapUSDAtTrade ? `at $${formatMarketCap(trade.marketCapUSDAtTrade)} MC` : 'at — MC'}</span>
            {trade.txHash ? <a className={styles.tradeLink} href={txHref(trade.txChain || trade.chain, trade.txHash)} target="_blank" rel="noreferrer noopener">Tx <ArrowUpRight size={13} aria-hidden="true" /></a> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function actorLabel(actor: UserActor): string { return actor.nickname || actor.username || shortAddress(actor.identifier); }
function shortAddress(value: string): string { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || 'Unknown trader'; }
function txHref(chain: string, hash: string): string {
  if (chain === 'solana') return `https://solscan.io/tx/${encodeURIComponent(hash)}`;
  if (chain === 'base') return `https://basescan.org/tx/${encodeURIComponent(hash)}`;
  if (chain === 'bsc') return `https://bscscan.com/tx/${encodeURIComponent(hash)}`;
  if (chain === 'eth' || chain === 'ethereum') return `https://etherscan.io/tx/${encodeURIComponent(hash)}`;
  if (chain === 'robinhood') return `https://robinhoodchain.blockscout.com/tx/${encodeURIComponent(hash)}`;
  return '#';
}

function formatMarketCap(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? fmtCompact(number) : formatDecimalExact(value, 2);
}

function safeWebURL(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

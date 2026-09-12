'use client';

import Image from 'next/image';
import {ExternalLink, Heart, LoaderCircle} from 'lucide-react';
import {useState} from 'react';
import type {SquareFeedItem} from '@/api/social-content';
import {opinionAge, opinionCycleReturn} from '@/lib/opinion-card-display';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import styles from './SquareOpinionCard.module.css';
import {TokenAvatar} from '@/components/TokenAvatar';

export function SquareOpinionCard({item, remark, likePending, onToggleLike, now}: {
  item: SquareFeedItem;
  remark?: string;
  likePending: boolean;
  onToggleLike: (item: SquareFeedItem) => void;
  now: number;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const {actor, content} = item;
  const version = content.opinion.latestVersion;
  const name = actor.nickname || actor.username || `${actor.identifier.slice(0, 10)}…`;
  const position = content.position;
  const pnl = opinionCycleReturn(position.pnl_ratio);
  const symbol = content.token?.symbol || position.symbol;
  const closed = BigInt(position.shares_raw) === BigInt(0);
  const pnlAmount = closed ? position.realized_pnl_usd : position.unrealized_pnl_usd;
  const pnlSign = decimalSign(pnlAmount);
  const href = `/token/${encodeURIComponent(position.asset.chain)}/${encodeURIComponent(position.asset.token_address)}`;
  const xLinks = version.items.filter((entry) => entry.kind === 'x_link');
  const published = new Date(item.sortTime.seconds * 1000);

  return (
    <article className={styles.card} aria-label={`Opinion by ${name}`}>
      <div className={styles.avatar}>
        {actor.avatarURL && failedAvatar !== actor.avatarURL ? (
          <Image src={actor.avatarURL} alt="" width={36} height={36} unoptimized
            onError={() => setFailedAvatar(actor.avatarURL)} />
        ) : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <div className={styles.nameRow}>
              <span className={styles.name} title={name}>{name}</span>
              {remark ? <span className={styles.remark} title={remark}>{remark}</span> : null}
            </div>
            {actor.username ? <p className={styles.handle}>@{actor.username}</p> : null}
          </div>
          <time className={styles.time} dateTime={Number.isFinite(published.getTime()) ? published.toISOString() : undefined}
            title={Number.isFinite(published.getTime()) ? published.toLocaleString() : undefined}>
            {opinionAge(item.sortTime.seconds, now)}
          </time>
        </header>

        <p className={styles.body}>{version.body}</p>

        <div className={styles.position} aria-label="Position summary">
          <TokenAvatar chain={position.asset.chain} address={position.asset.token_address} size={32}
            fallbackLogo={content.token?.logo} fallbackSymbol={symbol} fallbackName={content.token?.name} />
          <div className={styles.tokenInfo}>
            <div className={styles.positionLabel}>{closed ? 'Closed' : 'Open'}<span className={styles.dot} aria-hidden="true" /></div>
            <p className={styles.symbol} title={`${symbol ?? 'Token'} · ${position.asset.chain}:${position.asset.token_address}`}>
              {/* 路径式详情页在静态导出下无客户端路由，走整页加载经 _redirects 重写 */}
              <a href={href}>{symbol || 'Token unavailable'}</a>
            </p>
          </div>
          <div className={styles.values}>
            {!closed ? <span className={styles.value} title={position.market_value_usd === undefined ? 'Position value unavailable' : 'Position market value (USD)'}>
              {position.market_value_usd === undefined ? '—' : `$${formatDecimalExact(position.market_value_usd)}`}
            </span> : null}
            <span title={closed ? 'Realized PnL (USD)' : 'Unrealized PnL (USD)'} className={`${styles.pnl} ${pnlSign === -1 ? styles.down : pnlSign === 1 ? styles.up : ''}`}>
              {pnlAmount === undefined ? '—' : `${pnlSign === 1 ? '+' : ''}$${formatDecimalExact(pnlAmount)}`}
              <span className="sr-only">{closed ? 'Realized PnL' : 'Unrealized PnL'}</span>
            </span>
            {closed ? <span title="ROI: realized cycle PnL divided by cumulative buy value" className={`${styles.pnl} ${pnl.direction === 'down' ? styles.down : pnl.direction === 'up' ? styles.up : ''}`}>
              <span className="sr-only">{pnl.label}</span>
              <span className={styles.pnlVisual} aria-hidden="true">
                {pnl.direction !== 'flat' ? <span className={styles.triangle}>{pnl.direction === 'down' ? '▾' : '▴'}</span> : null}
                {pnl.text}
              </span>
            </span> : null}
          </div>
        </div>

        <footer className={styles.footer}>
          <button type="button" disabled={likePending} aria-pressed={version.viewerLike}
            aria-label={version.viewerLike ? 'Unlike this opinion' : 'Like this opinion'}
            onClick={() => onToggleLike(item)} className={styles.like}>
            {likePending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> :
              <Heart className={version.viewerLike ? styles.liked : undefined} fill={version.viewerLike ? 'currentColor' : 'none'} strokeWidth={1.8} aria-hidden="true" />}
            <span>{version.likeCount}</span>
          </button>
          {xLinks.length > 0 ? <div className={styles.links}>{xLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener">
              <span aria-hidden="true">𝕏</span><span>View post</span><ExternalLink size={14} aria-hidden="true" />
            </a>
          ))}</div> : null}
        </footer>
      </div>
    </article>
  );
}

'use client';

import Image from 'next/image';
import Link from 'next/link';
import {ExternalLink, Heart, LoaderCircle} from 'lucide-react';
import {useState} from 'react';
import type {SquareFeedItem} from '@/api/social-content';
import {opinionAge, opinionPnl} from '@/lib/opinion-card-display';
import styles from './SquareOpinionCard.module.css';
import type {TokenMarket} from '@/lib/types';

export function SquareOpinionCard({item, token, remark, likePending, onToggleLike, now}: {
  item: SquareFeedItem;
  token?: TokenMarket;
  remark?: string;
  likePending: boolean;
  onToggleLike: (item: SquareFeedItem) => void;
  now: number;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const [failedTokenLogo, setFailedTokenLogo] = useState<string>();
  const {actor, content} = item;
  const version = content.opinion.latestVersion;
  const name = actor.nickname || actor.username || `${actor.identifier.slice(0, 10)}…`;
  const pnl = opinionPnl(content.position?.pnlPercent);
  const symbol = token?.symbol || content.position?.tokenSymbol;
  const tokenName = token?.name || symbol;
  const logo = token?.logo && /^https?:\/\//i.test(token.logo) ? token.logo : undefined;
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
          <span className={styles.tokenAvatar} aria-hidden="true">
            {logo && failedTokenLogo !== logo ? <Image src={logo} alt="" width={32} height={32} unoptimized
              onError={() => setFailedTokenLogo(logo)} /> : symbol?.slice(0, 1).toUpperCase() || '—'}
          </span>
          <div className={styles.tokenInfo}>
            <div className={styles.positionLabel}>Position<span className={styles.dot} aria-hidden="true" /></div>
            <p className={styles.symbol} title={token ? `${tokenName} (${symbol}) · ${token.chain}:${token.address}` : symbol}>
              {token ? <Link href={`/token/${encodeURIComponent(token.chain)}/${encodeURIComponent(token.address)}`}>{tokenName}</Link> : tokenName || '—'}
            </p>
          </div>
          <div className={styles.values}>
            {/* Market value is not part of the current Square contract. Missing is not $0. */}
            <span className={styles.value} title="Position value is not available yet">
              <span aria-hidden="true">—</span><span className="sr-only">Position value unavailable</span>
            </span>
            <span className={`${styles.pnl} ${pnl.direction === 'down' ? styles.down : pnl.direction === 'up' ? styles.up : ''}`}>
              <span className="sr-only">{pnl.label}</span>
              <span className={styles.pnlVisual} aria-hidden="true">
                {pnl.direction !== 'flat' ? <span className={styles.triangle}>{pnl.direction === 'down' ? '▾' : '▴'}</span> : null}
                {pnl.text}
              </span>
            </span>
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

'use client';

import Image from 'next/image';
import {BadgeCheck, ExternalLink, Heart, LoaderCircle, Pin} from 'lucide-react';
import {useState} from 'react';
import type {PinnedAnnouncement, PinnedAnnouncementRun} from '@/api/social-content';
import styles from './SquarePinnedAnnouncement.module.css';

function RichRun({run}: {run: PinnedAnnouncementRun}) {
  if (run.type === 'ticker') {
    // The token detail route is path-based and handled by _redirects on static hosting.
    return <a className={styles.inlineLink} href={`/token/${encodeURIComponent(run.chain)}/${encodeURIComponent(run.address)}`}
      title={`${run.chain}:${run.address}`}>{run.text}</a>;
  }
  if (run.type === 'link') {
    return <a className={styles.inlineLink} href={run.url} target="_blank" rel="noopener noreferrer">
      {run.text}<ExternalLink size={12} aria-hidden="true" />
    </a>;
  }
  const text = run.marks.includes('italic') ? <em>{run.text}</em> : run.text;
  return run.marks.includes('bold') ? <strong>{text}</strong> : text;
}

export function SquarePinnedAnnouncement({announcement, likePending, onToggleLike}: {
  announcement: PinnedAnnouncement;
  likePending: boolean;
  onToggleLike: (announcement: PinnedAnnouncement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const canExpand = announcement.body.length > 1 || announcement.body[0]?.children.map((run) => run.text).join('').length > 180;
  const paragraphs = expanded ? announcement.body : announcement.body.slice(0, 1);
  const published = new Date(announcement.publishedAt.seconds * 1000 + Math.floor(announcement.publishedAt.nanos / 1_000_000));
  const initials = announcement.authorName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

  return <article className={styles.card} aria-label={`Pinned announcement by ${announcement.authorName}: ${announcement.title}`}>
    <div className={styles.avatar} aria-hidden="true">
      {announcement.authorAvatarURL && failedAvatar !== announcement.authorAvatarURL ?
        <Image src={announcement.authorAvatarURL} alt="" width={36} height={36} unoptimized
          onError={() => setFailedAvatar(announcement.authorAvatarURL)} /> : <span>{initials}</span>}
    </div>
    <div className={styles.content}>
      <header className={styles.header}>
        <div className={styles.author}>
          <div className={styles.authorTop}>
            <span className={styles.authorName}>{announcement.authorName}</span>
            {announcement.authorVerified ? <BadgeCheck size={16} fill="currentColor" aria-label="Verified account" /> : null}
            {Number.isFinite(published.getTime()) ? <time dateTime={published.toISOString()} title={published.toISOString()}>
              {published.toLocaleDateString('en', {month: 'short', day: 'numeric', timeZone: 'UTC'})}
            </time> : null}
          </div>
          <span className={styles.authorID} title={announcement.authorID}>@{announcement.authorID}</span>
        </div>
        <span className={styles.pinned}><Pin size={13} fill="currentColor" aria-hidden="true" />Pinned</span>
      </header>
      <div className={styles.panel}>
        <h2 className={styles.title}>{announcement.title}</h2>
        <div className={styles.body}>
          {paragraphs.map((paragraph, index) => <p key={index} className={!expanded && canExpand ? styles.collapsed : undefined}>
            {paragraph.children.map((run, runIndex) => <RichRun key={runIndex} run={run} />)}
          </p>)}
        </div>
        {canExpand ? <button type="button" className={styles.readMore} onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}>{expanded ? 'Read Less' : 'Read More'}</button> : null}
      </div>
      <button type="button" className={styles.like} disabled={likePending} aria-pressed={announcement.viewerLike}
        aria-label={announcement.viewerLike ? 'Unlike this announcement' : 'Like this announcement'}
        onClick={() => onToggleLike(announcement)}>
        {likePending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> :
          <Heart fill={announcement.viewerLike ? 'currentColor' : 'none'} className={announcement.viewerLike ? styles.liked : undefined} aria-hidden="true" />}
        <span>{announcement.likeCount}</span>
      </button>
    </div>
  </article>;
}

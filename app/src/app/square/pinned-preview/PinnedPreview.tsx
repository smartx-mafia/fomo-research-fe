'use client';

import {useState} from 'react';
import type {PinnedAnnouncement} from '@/api/social-content';
import {SquarePinnedAnnouncement} from '@/components/SquarePinnedAnnouncement';

const example: PinnedAnnouncement = {
  id: 'local-preview-only', pinSlot: 1, title: 'Recap: September 14th, 2026',
  authorID: 'smartx-official', authorName: 'Smart X', authorAvatarURL: '/avatars/smartx-logo.svg', authorVerified: true,
  publishedAt: {seconds: 1789344000, nanos: 0}, likeCount: 126, viewerLike: false,
  body: [
    {children: [{type: 'text', text: 'The broad market has entered a local correction heading into today’s main event: the Clarity Act vote. The Senate will hold a procedural vote on the bill, which would split crypto oversight between the SEC and the CFTC and needs 60 votes to advance.', marks: []}]},
    {children: [
      {type: 'ticker', text: '$AI', chain: 'bsc', address: '0x1111111111111111111111111111111111111111'},
      {type: 'text', text: ', the token with a stock-paired pool, continues to hold center stage. Traders are watching the next liquidity level. ', marks: []},
      {type: 'text', text: 'Risk remains elevated.', marks: ['bold']},
    ]},
    {children: [
      {type: 'text', text: 'Read the full research note for context: ', marks: ['italic']},
      {type: 'link', text: 'market recap', url: 'https://example.com/recap'},
      {type: 'text', text: '.', marks: []},
    ]},
  ],
};

export function PinnedPreview() {
  const [announcement, setAnnouncement] = useState(example);
  return <section className="mx-auto w-full max-w-xl pb-12">
    <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
      Local UI preview · SmartX logo and sample content. The real avatar comes from the backend; likes here do not call it.
    </div>
    <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Square</h1>
      <p className="mt-1 text-sm text-muted">A shared batch ranked by likes, freshness, and author performance.</p>
    </header>
    <div className="mb-4 flex border-b border-border text-sm font-medium">
      <span className="relative flex-1 px-3 py-3 text-center">For You<span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" /></span>
      <span className="flex-1 px-3 py-3 text-center text-muted">Newest</span>
      <span className="flex-1 px-3 py-3 text-center text-muted">Friends</span>
    </div>
    <SquarePinnedAnnouncement announcement={announcement} likePending={false}
      onToggleLike={() => setAnnouncement((current) => ({...current, viewerLike: !current.viewerLike,
        likeCount: current.likeCount + (current.viewerLike ? -1 : 1)}))} />
    <div className="border-t border-border px-3 py-6 text-center text-xs text-muted">Regular For You posts follow below the pinned announcements.</div>
  </section>;
}

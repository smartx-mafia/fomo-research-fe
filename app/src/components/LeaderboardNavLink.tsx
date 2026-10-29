'use client';

import Link from 'next/link';
import {loadLeaderboardMeta} from '@/lib/leaderboard-meta';

/** Warm public filters on navigation intent; do not fetch a private board or
 * add an API request to every unrelated product page. */
export function LeaderboardNavLink() {
  const warm = () => {void loadLeaderboardMeta().catch(() => {});};
  return <Link href="/leaderboard" className="hover:text-foreground"
    onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>Leaderboard</Link>;
}

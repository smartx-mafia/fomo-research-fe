import {ArrowLeft, ArrowRight, Star} from 'lucide-react';

/** Small event markers from the notification design; independent of the actor avatar. */
export function NotificationBadge({kind}: {kind?: string}) {
  const common = 'absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-black';
  if (kind === 'opinion') return <span data-notification-badge={kind} className={common}>
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path d="M6 3h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-6l-5 4v-4H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" fill="#00c9e8" />
      <path d="M7 8h10M7 12h7" fill="none" stroke="#101010" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  </span>;
  if (kind === 'follow') return <span data-notification-badge={kind} className={`${common} text-[#f5d84d]`}><Star className="size-[18px]" fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></span>;
  if (kind === 'incoming' || kind === 'outgoing') {
    const Icon = kind === 'incoming' ? ArrowLeft : ArrowRight;
    return <span data-notification-badge={kind} className={`${common} text-white`}><Icon className="size-[18px]" strokeWidth={3} aria-hidden="true" /></span>;
  }
  if (kind === 'buy' || kind === 'sell') return <span data-notification-badge={kind} className={`${common} text-white`}>
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.1 9a8 8 0 0 1 13-3L20 9M20 4v5h-5M19.9 15a8 8 0 0 1-13 3L4 15M4 20v-5h5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  </span>;
  return null;
}

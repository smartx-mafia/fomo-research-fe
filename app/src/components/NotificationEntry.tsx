import {Bell} from 'lucide-react';
import {notificationLabels} from '@/lib/notification-labels';

export function NotificationEntry({language}: {language?: string}) {
  const label = notificationLabels(language).title;
  return <a href="/notifications" aria-label={label} title={label}
    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-[#00c9ad] hover:text-[#00c9ad] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c9ad]">
    <Bell className="size-[18px]" aria-hidden="true" />
  </a>;
}

'use client';

import {useState} from 'react';

export function ProfileBackground({url}: {url?: string}) {
  const [failed, setFailed] = useState<string>();
  return <div className="aspect-[3/1] w-full overflow-hidden bg-gradient-to-br from-accent/20 via-surface-2 to-surface">
    {url && failed !== url ? <img src={url} alt="Profile background" className="size-full object-cover" onError={() => setFailed(url)} /> : null}
  </div>;
}

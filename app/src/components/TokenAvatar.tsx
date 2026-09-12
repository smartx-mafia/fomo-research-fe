'use client';

import {useEffect, useMemo, useState} from 'react';

import {tokenKey, type TokenInfo} from '@/api/token-metadata';
import {useOptionalTokenContext} from '@/components/FavoritesProvider';

export type TokenAvatarSize = 24 | 28 | 32 | 36 | 44;

export type TokenBadge =
  | {kind: 'verified'; label: 'Verified token'}
  | {kind: 'favorite'; label: 'Favorite token'}
  | {kind: 'launchpad'; label: string; logo: string}
  | undefined;

export function usableTokenImage(value: string | undefined): string | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The only badge precedence implementation in the frontend. */
export function selectTokenBadge(info: TokenInfo | undefined, isFavorited: boolean): TokenBadge {
  if (!info) return undefined;
  if (info.is_verify) return {kind: 'verified', label: 'Verified token'};
  if (isFavorited) return {kind: 'favorite', label: 'Favorite token'};
  const launchpadLogo = usableTokenImage(info.launchpad_logo);
  return launchpadLogo
    ? {kind: 'launchpad', logo: launchpadLogo, label: info.launchpad_name ? `Issued on ${info.launchpad_name}` : 'Launchpad token'}
    : undefined;
}

export function TokenAvatarView({
  info,
  isFavorited,
  personalReady = true,
  size = 32,
  fallbackLogo,
  fallbackSymbol,
  fallbackName,
  className = '',
}: {
  info?: TokenInfo;
  isFavorited: boolean;
  personalReady?: boolean;
  size?: TokenAvatarSize;
  fallbackLogo?: string;
  fallbackSymbol?: string;
  fallbackName?: string;
  className?: string;
}) {
  const [failedImages, setFailedImages] = useState<Record<string, true>>({});
  const [failedBadge, setFailedBadge] = useState<string>();
  const sources = useMemo(() => {
    const values = [usableTokenImage(info?.logo), usableTokenImage(fallbackLogo)].filter((value): value is string => !!value);
    return [...new Set(values)];
  }, [info?.logo, fallbackLogo]);
  const source = sources.find((value) => !failedImages[value]);
  const symbol = info?.symbol ?? fallbackSymbol;
  const label = info?.name ?? info?.symbol ?? fallbackName ?? fallbackSymbol ?? 'Token';
  const badge = info?.is_verify ? selectTokenBadge(info, isFavorited) : personalReady ? selectTokenBadge(info, isFavorited) : undefined;
  const badgeSize = Math.max(10, Math.round(size * 0.4));
  const visibleBadge = badge?.kind === 'launchpad' && failedBadge === badge.logo ? undefined : badge;

  return (
    <span
      role="img"
      aria-label={`${label}${visibleBadge ? `, ${visibleBadge.label}` : ''}`}
      className={`relative inline-flex shrink-0 ${className}`}
      style={{width: size, height: size}}
    >
      <span
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface-2 font-semibold text-muted"
        style={{fontSize: Math.max(10, Math.round(size * 0.36))}}
      >
        {source ? (
          // Token artwork is served from arbitrary upstream hosts, so the static export cannot enumerate Next remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setFailedImages((current) => ({...current, [source]: true}))}
          />
        ) : (
          <span aria-hidden="true">{symbol?.trim().slice(0, 1).toUpperCase() || '?'}</span>
        )}
      </span>
      {visibleBadge ? (
        <span
          data-token-badge={visibleBadge.kind}
          aria-hidden="true"
          title={visibleBadge.label}
          className="pointer-events-none absolute -bottom-px -right-px grid place-items-center overflow-hidden rounded-full border-2 border-[#d8d8df] bg-[#111116] shadow-sm"
          style={{width: badgeSize, height: badgeSize, fontSize: Math.max(8, Math.round(badgeSize * 0.64)), lineHeight: 1}}
        >
          {visibleBadge.kind === 'verified' ? '✅' : visibleBadge.kind === 'favorite' ? '🌟' : (
            // Same arbitrary-host constraint as the token artwork above.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={visibleBadge.logo}
              alt=""
              width={badgeSize}
              height={badgeSize}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
              onError={() => setFailedBadge(visibleBadge.logo)}
            />
          )}
        </span>
      ) : null}
    </span>
  );
}

export function TokenAvatar({
  chain,
  address,
  size = 32,
  fallbackLogo,
  fallbackSymbol,
  fallbackName,
  className,
}: {
  chain: string;
  address: string;
  size?: TokenAvatarSize;
  fallbackLogo?: string;
  fallbackSymbol?: string;
  fallbackName?: string;
  className?: string;
}) {
  const {info, isFavorited, personalReady} = useTokenDisplay(chain, address);
  return <TokenAvatarView info={info} isFavorited={isFavorited} personalReady={personalReady} size={size}
    fallbackLogo={fallbackLogo} fallbackSymbol={fallbackSymbol} fallbackName={fallbackName} className={className} />;
}

export function useTokenDisplay(chain: string, address: string) {
  const context = useOptionalTokenContext();
  const retainMetadata = context?.retainMetadata;
  useEffect(() => retainMetadata?.({chain, address}), [chain, address, retainMetadata]);
  const key = tokenKey(chain, address);
  const state = key ? context?.metadataMap[key] : undefined;
  const info = state?.status === 'ready' ? state.info : undefined;
  return {info, isFavorited: key ? context?.statusMap[key] === true : false,
    personalReady: key ? context?.personalReadyMap[key] === true : false, state};
}

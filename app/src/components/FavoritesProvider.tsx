'use client';

/**
 * Shared token display state plus favorite mutations.
 *
 * Non-WS token surfaces hydrate public TokenInfo and viewer favorite state from
 * POST /v1/tokens/metadata. The discovery WS table deliberately keeps using
 * /favorites/status and never asks for badge metadata.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {addFavorite, favoriteStatus, removeFavorite, type FavoriteStatusInput} from '@/api/favorites';
import {ApiError} from '@/api/envelope';
import {
  batchGetTokenMetadata,
  normalizeTokenRef,
  TOKEN_META_STATUS_INVALID,
  TOKEN_META_STATUS_OK,
  tokenKey,
  type TokenInfo,
  type TokenRef,
} from '@/api/token-metadata';
import {clearSite, useSession} from '@/session/storage';

const META_FRESH_MS = 5 * 60_000;
const META_RETRY_MS = 60_000;
const META_BATCH_SIZE = 500;
const EMPTY_BOOLEAN_MAP: Record<string, boolean> = {};

export type TokenMetadataState = {
  status: 'ready' | 'missing' | 'invalid' | 'error';
  info?: TokenInfo;
  checkedAt: number;
  retryAt: number;
};

export type ToggleResult = {ok: true; favorited: boolean; changed: boolean} | {ok: false; code: number; message: string};

type FavoritesCtx = {
  statusMap: Record<string, boolean>;
  /** Favorite state accepted from canonical token metadata or a local mutation; badges read only this map. */
  badgeFavoriteMap: Record<string, boolean>;
  personalReadyMap: Record<string, boolean>;
  metadataMap: Record<string, TokenMetadataState>;
  loading: boolean;
  /** WS discovery table only. */
  ensureStatus: (tokens: FavoriteStatusInput[]) => void;
  /** Every non-WS token display. Calls are coalesced into batches. */
  ensureMetadata: (tokens: TokenRef[]) => void;
  /** Tracks which token identities are currently mounted for focus/session refresh. */
  retainMetadata: (token: TokenRef) => () => void;
  /** Watchlist rows are authoritative evidence that these refs are favorited. */
  primeFavoriteStatus: (tokens: TokenRef[]) => void;
  toggle: (chain: string, address: string) => Promise<ToggleResult>;
};

const Ctx = createContext<FavoritesCtx | null>(null);

export function useFavorites(): FavoritesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}

/** Display-only consumers may render with fallbacks in isolated tests/stories. */
export function useOptionalTokenContext(): FavoritesCtx | null {
  return useContext(Ctx);
}

export function FavoritesProvider({children}: {children: ReactNode}) {
  const session = useSession();
  const [statusMap, setStatusMapState] = useState<Record<string, boolean>>({});
  const [badgeFavoriteMap, setBadgeFavoriteMapState] = useState<Record<string, boolean>>({});
  const [personalReadyMap, setPersonalReadyMap] = useState<Record<string, boolean>>({});
  const [metadataMap, setMetadataMapState] = useState<Record<string, TokenMetadataState>>({});
  const [loading, setLoading] = useState(false);

  const statusMapRef = useRef(statusMap);
  const badgeFavoriteMapRef = useRef(badgeFavoriteMap);
  const metadataMapRef = useRef(metadataMap);
  const jwtRef = useRef<string | undefined>(session?.jwt);
  const viewerGenerationRef = useRef(0);
  const activeRequestsRef = useRef(0);
  const queriedStatusRef = useRef<Set<string>>(new Set());
  const observedMetadataRef = useRef<Map<string, {ref: TokenRef; count: number}>>(new Map());
  const pendingMetadataRef = useRef<Map<string, TokenRef>>(new Map());
  const inFlightMetadataRef = useRef<Set<string>>(new Set());
  const forcedPersonalRefreshRef = useRef<Map<string, TokenRef>>(new Map());
  const personalGenerationRef = useRef<Map<string, number>>(new Map());
  const mutationVersionRef = useRef<Map<string, number>>(new Map());
  const activeMutationRef = useRef<Map<string, {generation: number; version: number}>>(new Map());
  const mutationPromiseRef = useRef<Map<string, Promise<ToggleResult>>>(new Map());
  const drainingRef = useRef(false);
  const drainMetadataRef = useRef<() => void>(() => {});
  const pendingViewerResetRef = useRef(false);

  // Switch the imperative identity refs during render so an interaction in the
  // commit→effect gap can never use the previous viewer's JWT or favorite map.
  if (jwtRef.current !== session?.jwt) {
    jwtRef.current = session?.jwt;
    viewerGenerationRef.current += 1;
    queriedStatusRef.current = new Set();
    personalGenerationRef.current = new Map();
    forcedPersonalRefreshRef.current = new Map();
    statusMapRef.current = EMPTY_BOOLEAN_MAP;
    badgeFavoriteMapRef.current = EMPTY_BOOLEAN_MAP;
    pendingViewerResetRef.current = true;
  }

  const setStatusMap = useCallback((update: (current: Record<string, boolean>) => Record<string, boolean>) => {
    setStatusMapState((current) => {
      const next = update(current);
      statusMapRef.current = next;
      return next;
    });
  }, []);

  const setBadgeFavoriteMap = useCallback((update: (current: Record<string, boolean>) => Record<string, boolean>) => {
    setBadgeFavoriteMapState((current) => {
      const next = update(current);
      badgeFavoriteMapRef.current = next;
      return next;
    });
  }, []);

  const setMetadataMap = useCallback((update: (current: Record<string, TokenMetadataState>) => Record<string, TokenMetadataState>) => {
    setMetadataMapState((current) => {
      const next = update(current);
      metadataMapRef.current = next;
      return next;
    });
  }, []);

  const beginRequest = useCallback(() => {
    activeRequestsRef.current += 1;
    setLoading(true);
  }, []);
  const endRequest = useCallback(() => {
    activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
    setLoading(activeRequestsRef.current > 0);
  }, []);

  drainMetadataRef.current = () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    queueMicrotask(async () => {
      try {
        while (pendingMetadataRef.current.size > 0) {
          const batch = [...pendingMetadataRef.current.values()].slice(0, META_BATCH_SIZE);
          const keys = batch.map((token) => tokenKey(token.chain, token.address)!);
          for (const key of keys) {
            pendingMetadataRef.current.delete(key);
            inFlightMetadataRef.current.add(key);
          }
          const generation = viewerGenerationRef.current;
          const bearer = jwtRef.current;
          const versions = keys.map((key) => mutationVersionRef.current.get(key) ?? 0);
          beginRequest();
          try {
            const response = await batchGetTokenMetadata(batch, bearer);
            const checkedAt = Date.now();
            const updates: Record<string, TokenMetadataState> = {};
            const favoriteUpdates: Record<string, boolean> = {};
            const personalReadyUpdates: Record<string, boolean> = {};
            response.data.results.forEach((result, index) => {
              const key = keys[index];
              if (result.status === TOKEN_META_STATUS_OK && result.info) {
                updates[key] = {status: 'ready', info: result.info, checkedAt, retryAt: checkedAt + META_FRESH_MS};
              } else if (result.status === TOKEN_META_STATUS_INVALID) {
                updates[key] = {status: 'invalid', checkedAt, retryAt: Number.POSITIVE_INFINITY};
              } else {
                updates[key] = {status: 'missing', checkedAt, retryAt: checkedAt + META_RETRY_MS};
              }
              if (generation === viewerGenerationRef.current) {
                const mutation = activeMutationRef.current.get(key);
                const canAcceptFavorite = mutation?.generation !== generation &&
                  (mutationVersionRef.current.get(key) ?? 0) === versions[index];
                if (result.status !== TOKEN_META_STATUS_OK || canAcceptFavorite) {
                  personalGenerationRef.current.set(key, generation);
                  personalReadyUpdates[key] = true;
                  forcedPersonalRefreshRef.current.delete(key);
                  if (result.status === TOKEN_META_STATUS_OK) {
                    favoriteUpdates[key] = result.personal.is_favorited;
                    if (bearer) queriedStatusRef.current.add(key);
                  }
                } else if (mutation?.generation === generation ||
                  personalGenerationRef.current.get(key) !== generation) {
                  // This canonical personal value raced a mutation and was not accepted.
                  // Keep it visibly unready and force a new request after both operations finish.
                  personalGenerationRef.current.delete(key);
                  personalReadyUpdates[key] = false;
                  forcedPersonalRefreshRef.current.set(key, batch[index]);
                }
              }
            });
            setMetadataMap((current) => ({...current, ...updates}));
            if (Object.keys(favoriteUpdates).length > 0) {
              setStatusMap((current) => ({...current, ...favoriteUpdates}));
              setBadgeFavoriteMap((current) => ({...current, ...favoriteUpdates}));
            }
            if (Object.keys(personalReadyUpdates).length > 0) {
              setPersonalReadyMap((current) => ({...current, ...personalReadyUpdates}));
            }
          } catch (error) {
            const checkedAt = Date.now();
            if (error instanceof ApiError && error.code === 400000 && generation === viewerGenerationRef.current) {
              clearSite();
            }
            setMetadataMap((current) => {
              const next = {...current};
              for (const key of keys) next[key] = {status: 'error', checkedAt, retryAt: checkedAt + META_RETRY_MS};
              return next;
            });
          } finally {
            for (let index = 0; index < keys.length; index += 1) {
              const key = keys[index];
              inFlightMetadataRef.current.delete(key);
              const refresh = forcedPersonalRefreshRef.current.get(key);
              if (refresh && activeMutationRef.current.get(key)?.generation !== viewerGenerationRef.current) {
                forcedPersonalRefreshRef.current.delete(key);
                pendingMetadataRef.current.set(key, refresh);
              }
            }
            endRequest();
            if (generation !== viewerGenerationRef.current) {
              for (const token of batch) {
                const key = tokenKey(token.chain, token.address)!;
                pendingMetadataRef.current.set(key, token);
              }
            }
          }
        }
      } finally {
        drainingRef.current = false;
        if (pendingMetadataRef.current.size > 0) drainMetadataRef.current();
      }
    });
  };

  const ensureMetadata = useCallback((tokens: TokenRef[]) => {
    const now = Date.now();
    const generation = viewerGenerationRef.current;
    for (const token of tokens) {
      const ref = normalizeTokenRef(token.chain, token.address);
      if (!ref) continue;
      const key = tokenKey(ref.chain, ref.address)!;
      const current = metadataMapRef.current[key];
      const publicFresh = current?.status === 'ready'
        ? now - current.checkedAt < META_FRESH_MS
        : current?.status === 'invalid' || (current !== undefined && now < current.retryAt);
      const personalFresh = personalGenerationRef.current.get(key) === generation;
      if ((publicFresh && personalFresh) || inFlightMetadataRef.current.has(key)) continue;
      pendingMetadataRef.current.set(key, ref);
    }
    if (pendingMetadataRef.current.size > 0) drainMetadataRef.current();
  }, []);

  const retainMetadata = useCallback((token: TokenRef) => {
    const ref = normalizeTokenRef(token.chain, token.address);
    if (!ref) return () => {};
    const key = tokenKey(ref.chain, ref.address)!;
    const current = observedMetadataRef.current.get(key);
    observedMetadataRef.current.set(key, {ref, count: (current?.count ?? 0) + 1});
    ensureMetadata([ref]);
    return () => {
      const retained = observedMetadataRef.current.get(key);
      if (!retained || retained.count <= 1) observedMetadataRef.current.delete(key);
      else observedMetadataRef.current.set(key, {...retained, count: retained.count - 1});
    };
  }, [ensureMetadata]);

  const primeFavoriteStatus = useCallback((tokens: TokenRef[]) => {
    const keys: string[] = [];
    for (const token of tokens) {
      const ref = normalizeTokenRef(token.chain, token.address);
      if (!ref) continue;
      const key = tokenKey(ref.chain, ref.address)!;
      queriedStatusRef.current.add(key);
      keys.push(key);
      if (statusMapRef.current[key] !== true) {
        mutationVersionRef.current.set(key, (mutationVersionRef.current.get(key) ?? 0) + 1);
      }
    }
    if (keys.length === 0) return;
    if (!keys.every((key) => statusMapRef.current[key] === true)) {
      const next = {...statusMapRef.current};
      for (const key of keys) next[key] = true;
      statusMapRef.current = next;
      setStatusMapState(next);
    }
  }, [setStatusMap]);

  useEffect(() => {
    if (!pendingViewerResetRef.current) return;
    pendingViewerResetRef.current = false;
    setStatusMap(() => ({}));
    setBadgeFavoriteMap(() => ({}));
    setPersonalReadyMap({});
    ensureMetadata([...observedMetadataRef.current.values()].map((entry) => entry.ref));
  }, [session?.jwt, ensureMetadata, setBadgeFavoriteMap, setStatusMap]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') ensureMetadata([...observedMetadataRef.current.values()].map((entry) => entry.ref));
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [ensureMetadata]);

  const ensureStatus = useCallback((tokens: FavoriteStatusInput[]) => {
    const bearer = jwtRef.current;
    if (!bearer) return;
    const generation = viewerGenerationRef.current;
    const batch: TokenRef[] = [];
    for (const token of tokens) {
      const ref = normalizeTokenRef(token.chain, token.address);
      if (!ref) continue;
      const key = tokenKey(ref.chain, ref.address)!;
      if (queriedStatusRef.current.has(key)) continue;
      queriedStatusRef.current.add(key);
      batch.push(ref);
      if (batch.length === META_BATCH_SIZE) break;
    }
    if (batch.length === 0) return;
    const versions = batch.map((token) => mutationVersionRef.current.get(tokenKey(token.chain, token.address)!) ?? 0);
    beginRequest();
    favoriteStatus(bearer, batch)
      .then((response) => {
        if (generation !== viewerGenerationRef.current) return;
        setStatusMap((current) => {
          const next = {...current};
          response.data.results.forEach((result, index) => {
            const fallback = batch[index];
            const key = tokenKey(result.chain ?? fallback.chain, result.address ?? fallback.address);
            if (!key || activeMutationRef.current.get(key)?.generation === generation ||
                (mutationVersionRef.current.get(key) ?? 0) !== versions[index]) return;
            next[key] = result.is_favorited === true;
          });
          return next;
        });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 400000 && generation === viewerGenerationRef.current) {
          clearSite();
          return;
        }
        if (error instanceof ApiError && (error.kind !== 'business' || error.code === 500106 || error.code === 500097)) {
          for (const token of batch) queriedStatusRef.current.delete(tokenKey(token.chain, token.address)!);
        }
      })
      .finally(endRequest);
  }, [beginRequest, endRequest, setStatusMap]);

  const toggle = useCallback((chain: string, address: string): Promise<ToggleResult> => {
    const bearer = jwtRef.current;
    if (!bearer) return Promise.resolve({ok: false, code: 400000, message: 'Sign in to use your watchlist'});
    const ref = normalizeTokenRef(chain, address);
    if (!ref) return Promise.resolve({ok: false, code: 0, message: 'Invalid token reference'});
    const key = tokenKey(ref.chain, ref.address)!;
    const generation = viewerGenerationRef.current;
    const existing = activeMutationRef.current.get(key);
    if (existing?.generation === generation) return mutationPromiseRef.current.get(key)!;
    const currently = statusMapRef.current[key] === true;
    const hadBadgeFavorite = Object.prototype.hasOwnProperty.call(badgeFavoriteMapRef.current, key);
    const previousBadgeFavorite = badgeFavoriteMapRef.current[key] === true;
    const version = (mutationVersionRef.current.get(key) ?? 0) + 1;
    const marker = {generation, version};
    mutationVersionRef.current.set(key, version);
    activeMutationRef.current.set(key, marker);
    setStatusMap((current) => ({...current, [key]: !currently}));
    setBadgeFavoriteMap((current) => ({...current, [key]: !currently}));
    const promise = (async (): Promise<ToggleResult> => {
      try {
        const response = currently
          ? await removeFavorite(bearer, ref.chain, ref.address)
          : await addFavorite(bearer, ref.chain, ref.address);
        if (activeMutationRef.current.get(key) !== marker || generation !== viewerGenerationRef.current || bearer !== jwtRef.current) {
          return {ok: false, code: 0, message: 'Session changed before the favorite update completed'};
        }
        const favorited = response.data.favorited === true;
        const changed = response.data.changed === true;
        const normalizedKey = tokenKey(response.data.chain ?? ref.chain, response.data.address ?? ref.address) ?? key;
        setStatusMap((current) => {
          const next = {...current};
          delete next[key];
          next[normalizedKey] = favorited;
          return next;
        });
        setBadgeFavoriteMap((current) => {
          const next = {...current};
          delete next[key];
          next[normalizedKey] = favorited;
          return next;
        });
        queriedStatusRef.current.add(normalizedKey);
        personalGenerationRef.current.set(normalizedKey, generation);
        setPersonalReadyMap((current) => ({...current, [normalizedKey]: true}));
        return {ok: true, favorited, changed};
      } catch (error) {
        const current = activeMutationRef.current.get(key) === marker && generation === viewerGenerationRef.current && bearer === jwtRef.current;
        if (!current) return {ok: false, code: 0, message: 'Session changed before the favorite update completed'};
        setStatusMap((values) => ({...values, [key]: currently}));
        setBadgeFavoriteMap((values) => {
          const next = {...values};
          if (hadBadgeFavorite) next[key] = previousBadgeFavorite;
          else delete next[key];
          return next;
        });
        // A metadata response that arrived during the mutation deliberately skipped its
        // personal value. Do not leave that generation marked fresh after the mutation failed.
        personalGenerationRef.current.delete(key);
        setPersonalReadyMap((values) => ({...values, [key]: false}));
        forcedPersonalRefreshRef.current.set(key, ref);
        if (error instanceof ApiError) {
          if (error.code === 400000) {
            clearSite();
            return {ok: false, code: 400000, message: 'Session expired — sign in again'};
          }
          if (error.code === 430110) return {ok: false, code: 430110, message: 'Watchlist is full — remove some first'};
          if (error.code === 200107) return {ok: false, code: 200107, message: 'Token not found on this chain'};
          if (error.code === 500097) return {ok: false, code: 500097, message: 'Market upstream unavailable — try again'};
          if (error.code === 500106) return {ok: false, code: 500106, message: 'Watchlist storage unavailable — try again'};
          return {ok: false, code: error.code, message: error.message};
        }
        return {ok: false, code: 0, message: error instanceof Error ? error.message : String(error)};
      } finally {
        if (activeMutationRef.current.get(key) === marker) {
          activeMutationRef.current.delete(key);
          mutationPromiseRef.current.delete(key);
          mutationVersionRef.current.set(key, version + 1);
          const refresh = forcedPersonalRefreshRef.current.get(key);
          if (refresh && !inFlightMetadataRef.current.has(key)) {
            forcedPersonalRefreshRef.current.delete(key);
            pendingMetadataRef.current.set(key, refresh);
            drainMetadataRef.current();
          }
        }
      }
    })();
    mutationPromiseRef.current.set(key, promise);
    return promise;
  }, [setBadgeFavoriteMap, setStatusMap]);

  const viewerMatches = !pendingViewerResetRef.current;
  const visibleStatusMap = viewerMatches ? statusMap : EMPTY_BOOLEAN_MAP;
  const visibleBadgeFavoriteMap = viewerMatches ? badgeFavoriteMap : EMPTY_BOOLEAN_MAP;
  const visiblePersonalReadyMap = viewerMatches ? personalReadyMap : EMPTY_BOOLEAN_MAP;
  const value = useMemo(() => ({statusMap: visibleStatusMap, badgeFavoriteMap: visibleBadgeFavoriteMap,
    personalReadyMap: visiblePersonalReadyMap, metadataMap, loading, ensureStatus, ensureMetadata,
    retainMetadata, primeFavoriteStatus, toggle}),
    [visibleStatusMap, visibleBadgeFavoriteMap, visiblePersonalReadyMap, metadataMap, loading, ensureStatus,
      ensureMetadata, retainMetadata, primeFavoriteStatus, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** StarButton remains the explicit mutation control; avatar badges are decorative. */
export function StarButton({chain, address, size = 'sm', knownFavorited = false}: {chain: string; address: string; size?: 'sm' | 'md'; knownFavorited?: boolean}) {
  const {statusMap, primeFavoriteStatus, toggle} = useFavorites();
  const session = useSession();
  const [hint, setHint] = useState<string | null>(null);
  const key = tokenKey(chain, address);
  const hasHydratedStatus = key ? Object.prototype.hasOwnProperty.call(statusMap, key) : false;
  const on = hasHydratedStatus && key ? statusMap[key] === true : knownFavorited;

  async function onClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (knownFavorited && key && statusMap[key] !== true) primeFavoriteStatus([{chain, address}]);
    const result = await toggle(chain, address);
    if (!result.ok) {
      setHint(result.message);
      window.setTimeout(() => setHint(null), 2200);
    }
  }

  const cls = size === 'md' ? 'text-lg' : 'text-sm';
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onClick}
        title={session ? (on ? 'Remove from watchlist' : 'Add to watchlist') : 'Sign in to use your watchlist'}
        className={`${cls} leading-none transition-colors ${on ? 'text-accent' : 'text-muted hover:text-foreground'}`}
      >
        {on ? '★' : '☆'}
      </button>
      {hint ? (
        <span className="absolute left-1/2 top-full z-30 mt-1 w-max max-w-[220px] -translate-x-1/2 rounded border border-border bg-surface px-2 py-1 text-[10px] text-muted shadow">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

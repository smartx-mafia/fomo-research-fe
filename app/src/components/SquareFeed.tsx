'use client';

import Link from 'next/link';
import {
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';

import {SquareOpinionCard} from './SquareOpinionCard';

import {ApiError} from '@/api/envelope';
import {
  SQUARE_LANES,
  getSquareFeedUpdates,
  likeOpinionVersion,
  listSquareFeedPage,
  unlikeOpinionVersion,
  type LikeMutationResult,
  type ProtoTimestamp,
  type SquareFeedItem,
  type SquareLane,
  type SquarePageCursor,
  type SquareRefreshAnchor,
  type SquareUpdatesData,
  type UserActor,
} from '@/api/social-content';
import {getRelations} from '@/api/social';
import {clearSite, useSession} from '@/session/storage';

export type SquareLaneSlug = 'for-you' | 'newest' | 'friends';

type LaneRequestError = {
  kind: 'sign-in' | 'invite' | 'failed';
  message: string;
};

type LaneState = {
  items: SquareFeedItem[];
  nextCursor?: SquarePageCursor;
  batchID?: string;
  asOf?: ProtoTimestamp;
  /** §6.2 不透明轮询锚点；每页覆盖，下拉刷新/点气泡重拉首屏后由新首屏推进。 */
  refreshAnchor?: SquareRefreshAnchor;
  hydrated: boolean;
  loadingInitial: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error?: LaneRequestError;
  loadMoreError?: LaneRequestError;
};

type LaneStates = Record<SquareLaneSlug, LaneState>;

type LikeSnapshot = {
  lane: SquareLaneSlug;
  sourceID: string;
  versionID: string;
  liked: boolean;
  count: number;
};

type Notice = {
  kind: 'sign-in' | 'invite' | 'failed';
  message: string;
};

const LANE_ORDER: SquareLaneSlug[] = ['for-you', 'newest', 'friends'];

const LANE_META: Record<SquareLaneSlug, {label: string; description: string; apiLane: SquareLane}> = {
  'for-you': {
    label: 'For You',
    description: 'A shared batch ranked by likes, freshness, and author performance.',
    apiLane: SQUARE_LANES.FOR_YOU,
  },
  newest: {
    label: 'Newest',
    description: 'The latest public opinions across SmartX.',
    apiLane: SQUARE_LANES.NEWEST,
  },
  friends: {
    label: 'Friends',
    description: 'Opinions from people you follow.',
    apiLane: SQUARE_LANES.FRIENDS,
  },
};

function emptyLaneState(): LaneState {
  return {
    items: [],
    hydrated: false,
    loadingInitial: false,
    refreshing: false,
    loadingMore: false,
  };
}

function initialLaneStates(): LaneStates {
  return {
    'for-you': emptyLaneState(),
    newest: emptyLaneState(),
    friends: emptyLaneState(),
  };
}

function requestError(error: unknown): LaneRequestError {
  if (error instanceof ApiError && error.code === 400000) {
    return {kind: 'sign-in', message: 'Your session expired. Sign in again to restore personal actions.'};
  }
  if (error instanceof ApiError && error.code === 430114) {
    return {kind: 'invite', message: 'This account still needs invitation access before using this feature.'};
  }
  if (error instanceof ApiError && error.code === 420000) {
    return {kind: 'failed', message: 'Too many requests. Wait a moment, then try again.'};
  }
  return {kind: 'failed', message: 'Square is temporarily unavailable. Your cached posts are still here.'};
}

function formatTime(timestamp?: ProtoTimestamp): string {
  if (!timestamp) return '';
  const date = new Date(timestamp.seconds * 1000 + Math.floor(timestamp.nanos / 1_000_000));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function compactIdentifier(identifier: string): string {
  return identifier.length > 22 ? `${identifier.slice(0, 10)}…${identifier.slice(-6)}` : identifier;
}

function actorName(actor: UserActor): string {
  return actor.nickname ?? actor.username ?? compactIdentifier(actor.identifier);
}

function actorInitial(actor: UserActor): string {
  return actorName(actor).trim().slice(0, 1).toUpperCase() || '?';
}

function withUpdatedVersion(
  item: SquareFeedItem,
  versionID: string,
  liked: boolean,
  likeCount: number,
): SquareFeedItem {
  const version = item.content.opinion.latestVersion;
  if (version.versionID !== versionID) return item;
  return {
    ...item,
    content: {
      ...item.content,
      opinion: {
        ...item.content.opinion,
        latestVersion: {...version, viewerLike: liked, likeCount: Math.max(0, likeCount)},
      },
    },
  };
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading Square">
      {Array.from({length: 4}, (_, index) => (
        <div key={index} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-2" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
              <div className="h-8 w-28 animate-pulse rounded-md bg-surface-2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StateMessage({error, onRetry}: {error: LaneRequestError; onRetry: () => void}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-6 text-center">
      {error.kind === 'sign-in' ? (
        <LockKeyhole className="h-7 w-7 text-accent" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-7 w-7 text-muted" aria-hidden="true" />
      )}
      <div>
        <p className="text-sm font-medium text-foreground">
          {error.kind === 'invite' ? 'Invitation access required' : error.kind === 'sign-in' ? 'Sign in required' : 'Could not load Square'}
        </p>
        <p className="mt-1 max-w-md text-sm text-muted">{error.message}</p>
      </div>
      <div className="flex items-center gap-2">
        {error.kind === 'sign-in' ? (
          <Link href="/login" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110">
            Sign in
          </Link>
        ) : null}
        {error.kind !== 'invite' ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground hover:border-muted"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InlineNotice({notice, onDismiss}: {notice: Notice; onDismiss: () => void}) {
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
        notice.kind === 'invite' ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface'
      }`}
    >
      <div>
        <p className="font-medium text-foreground">
          {notice.kind === 'invite' ? 'Invitation access required' : notice.kind === 'sign-in' ? 'Sign in to continue' : 'Action failed'}
        </p>
        <p className="mt-0.5 text-muted">{notice.message}</p>
        {notice.kind === 'sign-in' ? (
          <Link href="/login" className="mt-1 inline-block text-accent hover:underline">Go to login</Link>
        ) : null}
      </div>
      <button type="button" onClick={onDismiss} className="text-xs text-muted hover:text-foreground" aria-label="Dismiss message">
        Dismiss
      </button>
    </div>
  );
}

export function SquareFeed({initialLane}: {initialLane: SquareLaneSlug}) {
  const session = useSession();
  const [displayNow, setDisplayNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') setDisplayNow(Date.now()); };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const [activeLane, setActiveLane] = useState<SquareLaneSlug>(initialLane);
  const [laneStates, setLaneStates] = useState<LaneStates>(initialLaneStates);
  const [pendingLikes, setPendingLikes] = useState<Record<string, boolean>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>();
  /** §6.2 当前 activeLane 的未读气泡数据；切 lane 即弃，由轮询 effect 重新查询。 */
  const [unreads, setUnreads] = useState<SquareUpdatesData>();
  const activeLaneRef = useRef(activeLane);
  const sessionJWTRef = useRef(session?.jwt);
  const previousSessionRef = useRef<string | null | undefined>(undefined);
  const scrollByLaneRef = useRef<Record<SquareLaneSlug, number>>({'for-you': 0, newest: 0, friends: 0});
  const requestGenerationRef = useRef<Record<SquareLaneSlug, number>>({'for-you': 0, newest: 0, friends: 0});
  const requestInFlightRef = useRef<Record<SquareLaneSlug, boolean>>({'for-you': false, newest: false, friends: false});
  const requestAbortRef = useRef<Partial<Record<SquareLaneSlug, AbortController>>>({});
  const remarksAbortRef = useRef<Set<AbortController>>(new Set());
  const mountedRef = useRef(false);
  /** 与点赞写入重叠的旧 Feed 快照不得覆盖 mutation 的最终状态。 */
  const likeMutationEpochRef = useRef(0);
  const activeLikeMutationsRef = useRef(0);
  const staleReadsAfterLikeRef = useRef<Partial<Record<SquareLaneSlug, 'first' | 'more'>>>({});
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const queriedRemarksRef = useRef<Set<string>>(new Set());

  activeLaneRef.current = activeLane;
  sessionJWTRef.current = session?.jwt;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const replaceLane = useCallback((lane: SquareLaneSlug, updater: (state: LaneState) => LaneState) => {
    setLaneStates((states) => ({...states, [lane]: updater(states[lane])}));
  }, []);

  const ensureRemarks = useCallback(async (items: SquareFeedItem[]) => {
    const bearer = sessionJWTRef.current;
    if (!bearer) return;
    const identifiers = [...new Set(items.map((item) => item.actor.identifier))]
      .filter((identifier) => !queriedRemarksRef.current.has(identifier));
    if (identifiers.length === 0) return;
    identifiers.forEach((identifier) => queriedRemarksRef.current.add(identifier));
    const batches = Array.from(
      {length: Math.ceil(identifiers.length / 100)},
      (_, index) => identifiers.slice(index * 100, (index + 1) * 100),
    );
    const controller = new AbortController();
    remarksAbortRef.current.add(controller);
    try {
      const responses = await Promise.all(
        batches.map((userIdentifiers) => getRelations(
          bearer,
          {userIdentifiers, addresses: []},
          controller.signal,
        )),
      );
      if (!mountedRef.current || sessionJWTRef.current !== bearer) return;
      const next: Record<string, string> = {};
      responses.forEach((response, batchIndex) => {
        batches[batchIndex].forEach((identifier, index) => {
          const remark = response.data.users?.[index]?.remark;
          if (remark) next[identifier] = remark;
        });
      });
      setRemarks((current) => ({...current, ...next}));
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      identifiers.forEach((identifier) => queriedRemarksRef.current.delete(identifier));
      if (error instanceof ApiError && error.code === 400000 && sessionJWTRef.current === bearer) clearSite();
      // Private labels are optional viewer enrichment. Their failure must not hide the public feed.
    } finally {
      remarksAbortRef.current.delete(controller);
    }
  }, []);

  const loadFirstPage = useCallback(async (lane: SquareLaneSlug, refresh: boolean) => {
    const bearer = sessionJWTRef.current;
    if (lane === 'friends' && !bearer) return;
    if (requestInFlightRef.current[lane]) {
      if (!refresh) return;
      // A user refresh supersedes pagination. The older response is ignored by generation.
      requestAbortRef.current[lane]?.abort();
      requestGenerationRef.current[lane] += 1;
      requestInFlightRef.current[lane] = false;
    }

    requestInFlightRef.current[lane] = true;
    const controller = new AbortController();
    requestAbortRef.current[lane] = controller;
    const generation = ++requestGenerationRef.current[lane];
    const likeEpoch = likeMutationEpochRef.current;
    replaceLane(lane, (state) => ({
      ...state,
      loadingInitial: !state.hydrated && state.items.length === 0,
      refreshing: state.hydrated || state.items.length > 0 || refresh,
      loadingMore: false,
      error: undefined,
      loadMoreError: undefined,
    }));

    try {
      const data = await listSquareFeedPage(LANE_META[lane].apiLane, {
        bearer,
        limit: 20,
        signal: controller.signal,
      });
      if (!mountedRef.current || requestGenerationRef.current[lane] !== generation || sessionJWTRef.current !== bearer) return;
      if (likeMutationEpochRef.current !== likeEpoch) {
        replaceLane(lane, (state) => ({...state, loadingInitial: false, refreshing: false}));
        if (activeLikeMutationsRef.current > 0) {
          staleReadsAfterLikeRef.current[lane] = 'first';
        } else {
          setTimeout(() => void loadFirstPage(lane, true), 0);
        }
        return;
      }
      // One state commit keeps a For You batch, its metadata, and cards atomic.
      replaceLane(lane, () => ({
        items: data.items,
        nextCursor: data.nextCursor,
        batchID: data.batchID,
        asOf: data.asOf,
        refreshAnchor: data.refreshAnchor,
        hydrated: true,
        loadingInitial: false,
        refreshing: false,
        loadingMore: false,
      }));
      void ensureRemarks(data.items);
      if (refresh) {
        scrollByLaneRef.current[lane] = 0;
        if (activeLaneRef.current === lane) {
          requestAnimationFrame(() => window.scrollTo({top: 0, behavior: 'smooth'}));
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!mountedRef.current || requestGenerationRef.current[lane] !== generation || sessionJWTRef.current !== bearer) return;
      const normalized = requestError(error);
      if (error instanceof ApiError && error.code === 400000) clearSite();
      replaceLane(lane, (state) => ({
        ...state,
        loadingInitial: false,
        refreshing: false,
        error: normalized,
      }));
    } finally {
      if (requestGenerationRef.current[lane] === generation && sessionJWTRef.current === bearer) {
        requestInFlightRef.current[lane] = false;
        if (requestAbortRef.current[lane] === controller) delete requestAbortRef.current[lane];
      }
    }
  }, [ensureRemarks, replaceLane]);

  const loadMore = useCallback(async (lane: SquareLaneSlug) => {
    const state = laneStates[lane];
    const bearer = sessionJWTRef.current;
    if (!state.nextCursor || requestInFlightRef.current[lane] || (lane === 'friends' && !bearer)) return;

    requestInFlightRef.current[lane] = true;
    const controller = new AbortController();
    requestAbortRef.current[lane] = controller;
    const generation = ++requestGenerationRef.current[lane];
    const likeEpoch = likeMutationEpochRef.current;
    replaceLane(lane, (current) => ({...current, loadingMore: true, loadMoreError: undefined}));

    try {
      const data = await listSquareFeedPage(LANE_META[lane].apiLane, {
        bearer,
        cursor: state.nextCursor,
        limit: 20,
        signal: controller.signal,
      });
      if (!mountedRef.current || requestGenerationRef.current[lane] !== generation || sessionJWTRef.current !== bearer) return;
      if (likeMutationEpochRef.current !== likeEpoch) {
        replaceLane(lane, (current) => ({...current, loadingMore: false}));
        if (activeLikeMutationsRef.current > 0) {
          if (staleReadsAfterLikeRef.current[lane] !== 'first') staleReadsAfterLikeRef.current[lane] = 'more';
        } else {
          setTimeout(() => void loadMore(lane), 0);
        }
        return;
      }
      replaceLane(lane, (current) => {
        const seen = new Set(current.items.map((item) => `${item.type}:${item.sourceID}`));
        const additions = data.items.filter((item) => !seen.has(`${item.type}:${item.sourceID}`));
        return {
          ...current,
          items: [...current.items, ...additions],
          nextCursor: data.nextCursor,
          batchID: data.batchID ?? current.batchID,
          asOf: data.asOf ?? current.asOf,
          refreshAnchor: data.refreshAnchor,
          loadingMore: false,
        };
      });
      void ensureRemarks(data.items);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!mountedRef.current || requestGenerationRef.current[lane] !== generation || sessionJWTRef.current !== bearer) return;
      if (error instanceof ApiError && error.code === 100103) {
        requestInFlightRef.current[lane] = false;
        replaceLane(lane, (current) => ({...current, loadingMore: false, nextCursor: undefined}));
        void loadFirstPage(lane, true);
        return;
      }
      if (error instanceof ApiError && error.code === 400000) clearSite();
      replaceLane(lane, (current) => ({
        ...current,
        loadingMore: false,
        loadMoreError: requestError(error),
      }));
    } finally {
      if (requestGenerationRef.current[lane] === generation && sessionJWTRef.current === bearer) {
        requestInFlightRef.current[lane] = false;
        if (requestAbortRef.current[lane] === controller) delete requestAbortRef.current[lane];
      }
    }
  }, [ensureRemarks, laneStates, loadFirstPage, replaceLane]);

  useEffect(() => {
    const state = laneStates[activeLane];
    if (activeLane === 'friends' && !session?.jwt) return;
    if (!state.hydrated && !state.loadingInitial && !state.error) void loadFirstPage(activeLane, false);
  }, [activeLane, laneStates, loadFirstPage, session?.jwt]);

  useEffect(() => {
    const currentJWT = session?.jwt ?? null;
    if (previousSessionRef.current === undefined) {
      previousSessionRef.current = currentJWT;
      return;
    }
    if (previousSessionRef.current === currentJWT) return;
    previousSessionRef.current = currentJWT;

    for (const lane of LANE_ORDER) {
      requestAbortRef.current[lane]?.abort();
      delete requestAbortRef.current[lane];
      requestGenerationRef.current[lane] += 1;
      requestInFlightRef.current[lane] = false;
    }
    for (const controller of remarksAbortRef.current) controller.abort();
    remarksAbortRef.current.clear();
    likeMutationEpochRef.current += 1;
    activeLikeMutationsRef.current = 0;
    staleReadsAfterLikeRef.current = {};
    setPendingLikes({});
    queriedRemarksRef.current = new Set();
    setRemarks({});
    setLaneStates((states) => {
      const invalidatePublicLane = (state: LaneState): LaneState => ({
        ...state,
        items: state.items.map((item) => withUpdatedVersion(
          item,
          item.content.opinion.latestVersion.versionID,
          false,
          item.content.opinion.latestVersion.likeCount,
        )),
        hydrated: false,
        loadingInitial: false,
        refreshing: false,
        loadingMore: false,
        error: undefined,
        loadMoreError: undefined,
      });
      return {
        'for-you': invalidatePublicLane(states['for-you']),
        newest: invalidatePublicLane(states.newest),
        friends: emptyLaneState(),
      };
    });
    if (activeLaneRef.current !== 'friends') void loadFirstPage(activeLaneRef.current, true);
  }, [loadFirstPage, session?.jwt]);

  useEffect(() => {
    const canonicalize = (lane: SquareLaneSlug, method: 'pushState' | 'replaceState') => {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'token');
      url.searchParams.set('lane', lane);
      window.history[method]({}, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    };
    canonicalize(activeLaneRef.current, 'replaceState');

    const onPopState = () => {
      const value = new URL(window.location.href).searchParams.get('lane');
      if (value !== 'for-you' && value !== 'newest' && value !== 'friends') return;
      const previous = activeLaneRef.current;
      scrollByLaneRef.current[previous] = window.scrollY;
      activeLaneRef.current = value;
      setActiveLane(value);
      requestAnimationFrame(() => window.scrollTo({top: scrollByLaneRef.current[value]}));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const state = laneStates[activeLane];
    if (!sentinel || !state.nextCursor || state.loadingMore || state.refreshing || state.loadMoreError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore(activeLane);
      },
      {rootMargin: '360px 0px'},
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeLane, laneStates, loadMore]);

  // §6.2 未读轮询：仅跟踪 activeLane，有锚点（即已 hydrate）才开；30s 一次，
  // 回前台立即补一次，切 lane / 新锚点（含下拉刷新、点气泡后的新首屏）会立即重查。
  // 失败不进 notice 体系：100103 丢锚点并立即重拉首屏，400000 清会话并停本轮轮询。
  const activeRefreshAnchor = laneStates[activeLane].refreshAnchor;

  useEffect(() => {
    const lane = activeLane;
    const anchor = activeRefreshAnchor;
    const jwt = session?.jwt;
    if (!anchor || (lane === 'friends' && !jwt)) return;
    let stopped = false;
    let checking = false;
    let controller: AbortController | undefined;

    const check = async () => {
      if (stopped || checking || document.visibilityState === 'hidden') return;
      if (activeLaneRef.current !== lane || sessionJWTRef.current !== jwt) return;
      checking = true;
      controller = new AbortController();
      try {
        const updates = await getSquareFeedUpdates(LANE_META[lane].apiLane, {
          bearer: jwt,
          anchor,
          signal: controller.signal,
        });
        if (stopped || activeLaneRef.current !== lane || sessionJWTRef.current !== jwt) return;
        setUnreads(updates.count > 0 ? updates : undefined);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (stopped || activeLaneRef.current !== lane || sessionJWTRef.current !== jwt) return;
        if (error instanceof ApiError && error.code === 100103) {
          // 契约要求丢弃失效锚点并立即重拉首屏，不能停在失去未读能力的旧会话。
          setUnreads(undefined);
          replaceLane(lane, (current) => ({...current, refreshAnchor: undefined}));
          void loadFirstPage(lane, true);
          return;
        }
        if (error instanceof ApiError && error.code === 400000) {
          // 坏 token / 匿名问 FRIENDS：会话失效，clearSite 后由会话失效 effect 接管 UI。
          stopped = true;
          clearSite();
          return;
        }
        // 其余错误静默忽略，等下一轮。
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeLane, activeRefreshAnchor, loadFirstPage, replaceLane, session?.jwt]);

  // 未读气泡只属于当前 lane：切换即清掉，轮询 effect 重新查询。
  useEffect(() => {
    setUnreads(undefined);
  }, [activeLane]);

  const selectLane = (lane: SquareLaneSlug) => {
    if (lane === activeLaneRef.current) return;
    scrollByLaneRef.current[activeLaneRef.current] = window.scrollY;
    activeLaneRef.current = lane;
    setActiveLane(lane);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'token');
    url.searchParams.set('lane', lane);
    window.history.pushState({}, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    requestAnimationFrame(() => window.scrollTo({top: scrollByLaneRef.current[lane]}));
  };

  const updateAllVersions = (versionID: string, liked: boolean, count: number) => {
    setLaneStates((states) => {
      const next = {...states};
      for (const lane of LANE_ORDER) {
        next[lane] = {
          ...states[lane],
          items: states[lane].items.map((item) => withUpdatedVersion(item, versionID, liked, count)),
        };
      }
      return next;
    });
  };

  const toggleLike = async (item: SquareFeedItem) => {
    const bearer = sessionJWTRef.current;
    if (!bearer) {
      setNotice({kind: 'sign-in', message: 'Square is public, but liking an opinion requires a SmartX session.'});
      return;
    }
    const version = item.content.opinion.latestVersion;
    if (pendingLikes[version.versionID]) return;

    const snapshots: LikeSnapshot[] = [];
    for (const lane of LANE_ORDER) {
      for (const candidate of laneStates[lane].items) {
        const candidateVersion = candidate.content.opinion.latestVersion;
        if (candidateVersion.versionID === version.versionID) {
          snapshots.push({
            lane,
            sourceID: candidate.sourceID,
            versionID: candidateVersion.versionID,
            liked: candidateVersion.viewerLike,
            count: candidateVersion.likeCount,
          });
        }
      }
    }

    const optimisticLiked = !version.viewerLike;
    const optimisticCount = Math.max(0, version.likeCount + (optimisticLiked ? 1 : -1));
    likeMutationEpochRef.current += 1;
    activeLikeMutationsRef.current += 1;
    setPendingLikes((pending) => ({...pending, [version.versionID]: true}));
    setNotice(undefined);
    updateAllVersions(version.versionID, optimisticLiked, optimisticCount);

    try {
      const result: LikeMutationResult = await (optimisticLiked
        ? likeOpinionVersion(bearer, version.versionID)
        : unlikeOpinionVersion(bearer, version.versionID));
      if (!mountedRef.current || sessionJWTRef.current !== bearer) return;
      updateAllVersions(version.versionID, result.liked, result.likeCount);
    } catch (error) {
      if (!mountedRef.current || sessionJWTRef.current !== bearer) return;
      setLaneStates((states) => {
        const next = {...states};
        for (const lane of LANE_ORDER) {
          const laneSnapshots = snapshots.filter((snapshot) => snapshot.lane === lane);
          next[lane] = {
            ...states[lane],
            items: states[lane].items.map((candidate) => {
              const snapshot = laneSnapshots.find((entry) => entry.sourceID === candidate.sourceID);
              return snapshot
                ? withUpdatedVersion(candidate, snapshot.versionID, snapshot.liked, snapshot.count)
                : candidate;
            }),
          };
        }
        return next;
      });
      const normalized = requestError(error);
      if (error instanceof ApiError && error.code === 400000) clearSite();
      setNotice(normalized);
    } finally {
      if (!mountedRef.current || sessionJWTRef.current !== bearer) return;
      likeMutationEpochRef.current += 1;
      activeLikeMutationsRef.current = Math.max(0, activeLikeMutationsRef.current - 1);
      setPendingLikes((pending) => {
        const next = {...pending};
        delete next[version.versionID];
        return next;
      });
      if (activeLikeMutationsRef.current === 0) {
        const staleReads = staleReadsAfterLikeRef.current;
        staleReadsAfterLikeRef.current = {};
        for (const lane of LANE_ORDER) {
          const kind = staleReads[lane];
          if (kind === 'first') void loadFirstPage(lane, true);
          else if (kind === 'more') void loadMore(lane);
        }
      }
    }
  };

  const state = laneStates[activeLane];
  const isFriendsLocked = activeLane === 'friends' && !session;

  return (
    <section className="mx-auto w-full max-w-xl pb-12">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Square</h1>
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              Token
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{LANE_META[activeLane].description}</p>
        </div>
        <button
          type="button"
          disabled={state.refreshing || state.loadingInitial || isFriendsLocked}
          onClick={() => void loadFirstPage(activeLane, true)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted hover:border-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${state.refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {state.refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      <div className="sticky top-[57px] z-10 mb-4 border-b border-border bg-background/95 backdrop-blur">
        <div role="tablist" aria-label="Square lanes" className="flex gap-1">
          {LANE_ORDER.map((lane) => (
            <button
              key={lane}
              type="button"
              role="tab"
              aria-selected={activeLane === lane}
              onClick={() => selectLane(lane)}
              className={`relative flex-1 px-3 py-3 text-sm font-medium transition-colors ${
                activeLane === lane ? 'text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {LANE_META[lane].label}
              {lane === 'friends' && !session ? <LockKeyhole className="ml-1.5 inline h-3.5 w-3.5" aria-hidden="true" /> : null}
              {activeLane === lane ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
            </button>
          ))}
        </div>
      </div>

      {unreads ? (
        <button
          type="button"
          onClick={() => {
            setUnreads(undefined);
            void loadFirstPage(activeLane, true);
          }}
          className="mb-3 flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-left transition-colors hover:border-accent/70"
        >
          <span className="flex -space-x-2" aria-hidden="true">
            {unreads.actors.slice(0, 3).map((actor) =>
              actor.avatarURL ? (
                // The actor URL is backend-owned runtime data; this PoC does not have a fixed remote image allowlist.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={actor.identifier}
                  src={actor.avatarURL}
                  alt=""
                  className="h-7 w-7 rounded-full border-2 border-background bg-surface-2 object-cover"
                />
              ) : (
                <span
                  key={actor.identifier}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-surface-2 text-[11px] font-semibold text-muted"
                >
                  {actorInitial(actor)}
                </span>
              ),
            )}
          </span>
          <span className="text-sm font-medium text-foreground">
            {unreads.hasMore ? '99+' : unreads.count} new activities
          </span>
        </button>
      ) : null}

      {activeLane === 'for-you' && state.hydrated && (state.batchID || state.asOf) ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted">
          <span>Recommendation batch {state.batchID ? compactIdentifier(state.batchID) : 'active'}</span>
          {state.asOf ? <span>As of {formatTime(state.asOf)}</span> : null}
        </div>
      ) : null}

      {notice ? <div className="mb-3"><InlineNotice notice={notice} onDismiss={() => setNotice(undefined)} /></div> : null}

      {isFriendsLocked ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
            <LockKeyhole className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Your Friends lane is private</p>
            <p className="mt-1 max-w-sm text-sm text-muted">Sign in to read opinions from people you follow.</p>
          </div>
          <Link href="/login" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110">
            Sign in
          </Link>
        </div>
      ) : state.loadingInitial && state.items.length === 0 ? (
        <FeedSkeleton />
      ) : state.error && state.items.length === 0 ? (
        <StateMessage error={state.error} onRetry={() => void loadFirstPage(activeLane, false)} />
      ) : state.hydrated && state.items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
            <UserRound className="h-5 w-5 text-muted" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {activeLane === 'friends' ? 'No opinions from friends yet' : 'No opinions here yet'}
            </p>
            <p className="mt-1 text-sm text-muted">
              {activeLane === 'friends' ? 'Follow people to build this lane, then refresh.' : 'This is a real empty feed, not a loading error.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col bg-black" aria-busy={state.refreshing}>
          {state.error ? (
            <InlineNotice notice={state.error} onDismiss={() => replaceLane(activeLane, (current) => ({...current, error: undefined}))} />
          ) : null}
          {state.items.map((item) => (
            <SquareOpinionCard
              now={displayNow}
              key={`${item.type}:${item.sourceID}`}
              item={item}
              remark={item.actor.identifier === session?.user?.identifier ? undefined : remarks[item.actor.identifier]}
              likePending={!!pendingLikes[item.content.opinion.latestVersion.versionID]}
              onToggleLike={(candidate) => void toggleLike(candidate)}
            />
          ))}

          <div ref={loadMoreSentinelRef} className="flex min-h-14 items-center justify-center py-2">
            {state.loadingMore ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading more
              </span>
            ) : state.loadMoreError ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="text-xs text-muted">{state.loadMoreError.message}</span>
                {state.loadMoreError.kind !== 'invite' ? (
                  <button type="button" onClick={() => void loadMore(activeLane)} className="text-xs text-accent hover:underline">
                    Retry pagination
                  </button>
                ) : null}
              </div>
            ) : state.nextCursor ? (
              <button type="button" onClick={() => void loadMore(activeLane)} className="text-xs text-muted hover:text-foreground">
                Load more
              </button>
            ) : state.hydrated ? (
              <span className="text-xs text-muted">You&apos;re all caught up.</span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

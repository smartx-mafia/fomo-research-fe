/**
 * Opinion / Like / Square Feed client.
 *
 * The business encoder is not protojson on responses: int64 values are JSON
 * numbers, timestamps stay as objects, and oneof members are flattened to
 * their proto field names (`opinion`, `x_link`); an unselected oneof member
 * is `null`. Since 2026-09-07 (wire rule 10) every field is emitted — unset
 * messages expand to all-zero objects and scalar zeros are explicit — so this
 * module is also the normalization boundary that folds zero shapes back into
 * `undefined` for UI code.
 */
import {call} from './envelope';
import {normalizePortfolioPosition, positionTargetID, type PortfolioPosition} from './portfolio';
import {normalizeTokenInfo, tokenKey, type TokenInfo} from './token-metadata';

function socialCall(path: string, options: Parameters<typeof call>[1] = {}) {
  return call<unknown>(path, {...options, preserveInt64Fields: SOCIAL_INT64_FIELDS});
}

const SOCIAL_INT64_FIELDS = ['opinion_id', 'version_id', 'base_version_id', 'opened_entry_id', 'chain_id'] as const;

export function socialID(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new SocialContentShapeError('Unsafe social ID');
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > BigInt('9223372036854775807')) {
    throw new SocialContentShapeError('Invalid social ID');
  }
  return String(value);
}

export const SQUARE_LANES = {
  NEWEST: 'SQUARE_LANE_NEWEST',
  FRIENDS: 'SQUARE_LANE_FRIENDS',
  FOR_YOU: 'SQUARE_LANE_FOR_YOU',
} as const;

export type SquareLane = (typeof SQUARE_LANES)[keyof typeof SQUARE_LANES];
export type OpinionTargetName = 'POSITION';
export type OpinionTargetType = 1;
export type SquareItemType = 1 | 2;
export type SquareFilter = 'SQUARE_FILTER_OPINION' | 'SQUARE_FILTER_BUY' | 'SQUARE_FILTER_SELL';

declare const squarePageCursorBrand: unique symbol;
declare const squareRefreshAnchorBrand: unique symbol;

/** Opaque pagination position. It is accepted only by the feed endpoint. */
export type SquarePageCursor = string & {[squarePageCursorBrand]: true};

/** Opaque unread baseline. It is accepted only by the updates endpoint. */
export type SquareRefreshAnchor = string & {[squareRefreshAnchorBrand]: true};

export type ProtoTimestamp = {
  /** Unix seconds. The Go encoder omits this when it is zero. */
  seconds: number;
  /** Nanoseconds within the second. The Go encoder omits this when it is zero. */
  nanos: number;
};

export type OpinionAttachment = {
  kind: 'x_link';
  url: string;
};

/** Request-side proto shape. Only X links are currently accepted. */
export type OpinionAttachmentInput = {
  x_link: {url: string};
};

export type OpinionVersion = {
  versionID: string;
  versionNo: number;
  body: string;
  items: OpinionAttachment[];
  likeCount: number;
  publishedAt: ProtoTimestamp;
  viewerLike: boolean;
};

export type Opinion = {
  opinionID: string;
  authorIdentifier: string;
  targetType: OpinionTargetType;
  targetID: string;
  latestVersion: OpinionVersion;
  createdAt: ProtoTimestamp;
  updatedAt: ProtoTimestamp;
};

export type UserActor = {
  identifier: string;
  username?: string;
  nickname?: string;
  avatarURL?: string;
};

export type SmartMoneyActor = {
  address: string;
  chains: string[];
  displayName?: string;
  avatarURL?: string;
  handle?: string;
  xHandle?: string;
  source?: string;
  sourceURL?: string;
};

export type TradeCard = {
  side: 'buy' | 'sell';
  chain: string;
  tokenAddress: string;
  token?: PositionToken;
  tokenAmount?: string;
  usd?: string;
  /** Trade 权威成交均价（USD/枚）；缺席时不得用 usd/tokenAmount 反推。 */
  executionPriceUSD?: string;
  /** 成交价 × 首次采集时固化的流通量；缺席时不得用当前行情或供应量补算。 */
  marketCapUSDAtTrade?: string;
  occurredAt: ProtoTimestamp;
  txHash?: string;
  positionTargetID?: string;
  txChain?: string;
};

export type PositionToken = TokenInfo;

export type OpinionFeedContent = {
  kind: 'opinion';
  opinion: Opinion;
  position: PortfolioPosition;
  token?: PositionToken;
};

export type TradeFeedContent = {kind: 'trade'; trade: TradeCard};

type SquareFeedItemBase = {
  sourceID: string;
  actorIdentifier: string;
  actor: UserActor;
  actorType?: 'user' | 'smart_money';
  smartMoney?: SmartMoneyActor;
  sortTime: ProtoTimestamp;
};
export type SquareOpinionItem = SquareFeedItemBase & {type: 1; content: OpinionFeedContent};
export type SquareTradeItem = SquareFeedItemBase & {type: 2; content: TradeFeedContent};
export type SquareFeedItem = SquareOpinionItem | SquareTradeItem;

export type PinnedAnnouncementRun =
  | {type: 'text'; text: string; marks: ('bold' | 'italic')[]}
  | {type: 'ticker'; text: string; chain: string; address: string}
  | {type: 'link'; text: string; url: string};

export type PinnedAnnouncement = {
  id: string;
  pinSlot: number;
  authorID: string;
  authorName: string;
  authorAvatarURL: string;
  authorVerified: boolean;
  title: string;
  body: {children: PinnedAnnouncementRun[]}[];
  publishedAt: ProtoTimestamp;
  likeCount: number;
  viewerLike: boolean;
};

export type SquareFeedData = {
  /** The encoder returns data={} for an empty page. */
  items: SquareFeedItem[];
  /** Cursor-less FOR_YOU first page only; independent of recommendation items. */
  pinnedAnnouncements?: PinnedAnnouncement[];
  /** Missing or empty means pagination is exhausted. */
  nextCursor?: SquarePageCursor;
  /** FOR_YOU only. */
  batchID?: string;
  /** FOR_YOU only. */
  asOf?: ProtoTimestamp;
  /**
   * Opaque feed updates anchor (§6.2). It represents the session cutoff and
   * is separate from the pagination cursor. Store the latest opaque token
   * returned by each page; a cursor-less first-page refresh advances the
   * cutoff. It expires in 24h and is bound to the lane.
   */
  refreshAnchor?: SquareRefreshAnchor;
};

/** §6.2 unread summary for one lane, relative to the stored refresh anchor. */
export type SquareUpdatesData = {
  /** Server caps at 99; hasMore=true means the real number is larger. */
  count: number;
  hasMore: boolean;
  /** First 3 deduplicated authors of the unread activity. */
  actors: UserActor[];
};

export type OpinionHistoryData = {
  versions: OpinionVersion[];
  nextCursor?: string;
};

export type LikeMutationResult = {
  likeCount: number;
  liked: boolean;
  changed: boolean;
};

/** protojson omits a false changed, so repeated deletes normalize to {changed: false}. */
export type DeleteOpinionResult = {
  changed: boolean;
};

export type CreateOpinionInput = {
  targetType: OpinionTargetName;
  targetID: string;
  body: string;
  items?: readonly OpinionAttachmentInput[];
  idempotencyKey: string;
};

export type UpdateOpinionInput = {
  baseVersionID: string;
  body: string;
  items?: readonly OpinionAttachmentInput[];
  idempotencyKey: string;
};

export type SquareFeedOptions = {
  /** Optional for NEWEST/FOR_YOU; required by the backend for FRIENDS. */
  bearer?: string;
  cursor?: SquarePageCursor;
  limit?: number;
  filters?: readonly SquareFilter[];
  signal?: AbortSignal;
};

export type SquareFeedUpdatesOptions = {
  /** Optional for NEWEST/FOR_YOU; required by the backend for FRIENDS. */
  bearer?: string;
  /** The refreshAnchor returned by listSquareFeedPage for the same lane. */
  anchor?: SquareRefreshAnchor;
  filters?: readonly SquareFilter[];
  signal?: AbortSignal;
};

export type OpinionReadOptions = {
  /** Optional reads include viewerLike when a valid bearer is supplied. */
  bearer?: string;
};

export type OpinionHistoryOptions = OpinionReadOptions & {
  cursor?: string;
  limit?: number;
};

type UnknownRecord = Record<string, unknown>;

class SocialContentShapeError extends TypeError {
  constructor(detail: string) {
    super(`Social content response has an invalid shape: ${detail}`);
    this.name = 'SocialContentShapeError';
  }
}

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function omittedInteger(row: UnknownRecord, key: string): number {
  const value = row[key];
  if (value === undefined) return 0;
  const parsed = safeInteger(value);
  if (parsed === undefined) throw new SocialContentShapeError(`${key} is not a safe JSON integer`);
  return parsed;
}

function omittedBoolean(row: UnknownRecord, key: string): boolean {
  const value = row[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new SocialContentShapeError(`${key} is not a boolean`);
  return value;
}

function normalizeTimestamp(value: unknown, field: string): ProtoTimestamp {
  const row = record(value);
  if (!row) throw new SocialContentShapeError(`${field} is not a timestamp object`);
  return {
    seconds: omittedInteger(row, 'seconds'),
    nanos: omittedInteger(row, 'nanos'),
  };
}

function normalizeAttachment(value: unknown): OpinionAttachment | undefined {
  const item = record(value);
  // 2026-09-07 起 oneof 成员平铺成 proto 字段名（README 规则）；未选中时线上是 null。
  const xLink = record(item?.x_link);
  const url = nonEmptyString(xLink?.url);
  return url ? {kind: 'x_link', url} : undefined;
}

function normalizeVersion(value: unknown, field = 'version'): OpinionVersion {
  const row = record(value);
  if (!row) throw new SocialContentShapeError(`${field} is not an object`);

  const versionID = socialID(row.version_id);
  const versionNo = safeInteger(row.version_no);
  const body = nonEmptyString(row.body);
  if (versionNo === undefined || versionNo <= 0) {
    throw new SocialContentShapeError(`${field}.version_no is missing or invalid`);
  }
  if (!body) throw new SocialContentShapeError(`${field}.body is missing`);

  const rawItems = row.items;
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SocialContentShapeError(`${field}.items is not an array`);
  }

  return {
    versionID,
    versionNo,
    body,
    items: (rawItems ?? [])
      .map(normalizeAttachment)
      .filter((item): item is OpinionAttachment => item !== undefined),
    likeCount: omittedInteger(row, 'like_count'),
    publishedAt: normalizeTimestamp(row.published_at, `${field}.published_at`),
    viewerLike: omittedBoolean(row, 'viewer_like'),
  };
}

function normalizeOpinion(value: unknown): Opinion {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('opinion is not an object');

  const opinionID = socialID(row.opinion_id);
  const authorIdentifier = nonEmptyString(row.author_identifier);
  const targetID = nonEmptyString(row.target_id);
  if (!authorIdentifier) throw new SocialContentShapeError('opinion.author_identifier is missing');
  if (row.target_type !== 1) throw new SocialContentShapeError('opinion.target_type is not POSITION');
  if (!targetID) throw new SocialContentShapeError('opinion.target_id is missing');

  return {
    opinionID,
    authorIdentifier,
    targetType: 1,
    targetID,
    latestVersion: normalizeVersion(row.latest_version, 'opinion.latest_version'),
    createdAt: normalizeTimestamp(row.created_at, 'opinion.created_at'),
    updatedAt: normalizeTimestamp(row.updated_at, 'opinion.updated_at'),
  };
}

function normalizeActor(value: unknown, allowEmpty = false): UserActor {
  const row = record(value);
  const identifier = nonEmptyString(row?.identifier) ?? '';
  if (!row || (!allowEmpty && !identifier)) throw new SocialContentShapeError('feed actor.identifier is missing');
  const username = nonEmptyString(row.username);
  const nickname = nonEmptyString(row.nickname);
  const avatarURL = nonEmptyString(row.avatar_url);
  return {
    identifier,
    ...(username ? {username} : {}),
    ...(nickname ? {nickname} : {}),
    ...(avatarURL ? {avatarURL} : {}),
  };
}

function normalizeSmartMoney(value: unknown): SmartMoneyActor | undefined {
  const row = record(value);
  if (!row) return undefined;
  const address = nonEmptyString(row.address);
  const chains = row.chains;
  if (!address) return undefined;
  if (chains !== undefined && (!Array.isArray(chains) || chains.some((chain) => typeof chain !== 'string'))) {
    throw new SocialContentShapeError('feed smart_money.chains is invalid');
  }
  return {address, chains: (chains as string[] | undefined) ?? [],
    displayName: nonEmptyString(row.display_name), avatarURL: nonEmptyString(row.avatar_url),
    handle: nonEmptyString(row.handle), xHandle: nonEmptyString(row.x_handle),
    source: nonEmptyString(row.source), sourceURL: nonEmptyString(row.source_url)};
}

function normalizePositionToken(card: UnknownRecord, position: PortfolioPosition): PositionToken | undefined {
  if (card.token_ready === false) return undefined;
  const token = record(card.token);
  if (card.token_ready !== true || !token || token.chain !== position.asset.chain || token.address !== position.asset.token_address ||
      token.symbol !== (position.symbol ?? '') || token.decimals !== position.decimals || typeof token.name !== 'string' || typeof token.symbol !== 'string' ||
      typeof token.decimals !== 'number' || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
    throw new SocialContentShapeError('feed token does not match position');
  }
  return {chain: position.asset.chain, address: position.asset.token_address, symbol: token.symbol, name: token.name, decimals: token.decimals,
    is_verify: token.is_verify === true,
    ...Object.fromEntries(['logo', 'creator', 'twitter', 'website', 'launchpad', 'launchpad_name', 'launchpad_logo', 'total_supply', 'circulating_supply'].map((key) => [key, nonEmptyString(token[key])]))};
}

function normalizeOpinionCard(value: unknown): OpinionFeedContent {
  const card = record(value);
  if (!card) throw new SocialContentShapeError('opinion card is missing');
  const opinion = normalizeOpinion(card.opinion);
  const position = normalizePortfolioPosition(card.position, true);
  if (positionTargetID(position) !== opinion.targetID) throw new SocialContentShapeError('opinion position identity mismatch');
  const token = normalizePositionToken(card, position);
  return {kind: 'opinion', opinion, position, ...(token ? {token} : {})};
}

function normalizeTradeToken(value: unknown, chain: string, address: string): PositionToken | undefined {
  const row = record(value);
  if (!row || !nonEmptyString(row.address)) return undefined;
  const token = normalizeTokenInfo(row);
  if (!token || tokenKey(token.chain, token.address) !== tokenKey(chain, address)) {
    throw new SocialContentShapeError('trade token does not match chain/address or decimals');
  }
  return token;
}

function normalizeTrade(value: unknown): TradeCard {
  const row = record(value);
  if (!row || (row.side !== 'buy' && row.side !== 'sell')) throw new SocialContentShapeError('feed trade.side is invalid');
  const chain = nonEmptyString(row.chain);
  const tokenAddress = nonEmptyString(row.token_address);
  if (!chain || !tokenAddress) throw new SocialContentShapeError('feed trade identity is missing');
  const token = normalizeTradeToken(row.token, chain, tokenAddress);
  return {side: row.side, chain, tokenAddress, ...(token ? {token} : {}),
    tokenAmount: nonEmptyString(row.token_amount), usd: nonEmptyString(row.usd),
    executionPriceUSD: nonEmptyString(row.execution_price_usd), marketCapUSDAtTrade: nonEmptyString(row.market_cap_usd_at_trade),
    occurredAt: normalizeTimestamp(row.occurred_at, 'feed trade.occurred_at'),
    txHash: nonEmptyString(row.tx_hash), positionTargetID: nonEmptyString(row.position_target_id), txChain: nonEmptyString(row.tx_chain)};
}

function normalizeFeedItem(value: unknown): SquareFeedItem | undefined {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('feed item is not an object');

  // Unknown future card types are ignored until the UI has a renderer for them.
  if (row.type !== 1 && row.type !== 2) return undefined;
  const sourceID = nonEmptyString(row.source_id);
  const actorIdentifier = nonEmptyString(row.actor_identifier);
  if (!sourceID) throw new SocialContentShapeError('feed item.source_id is missing');
  if (!actorIdentifier) throw new SocialContentShapeError('feed item.actor_identifier is missing');

  const actorType = row.actor_type === 'smart_money' ? 'smart_money' : row.actor_type === 'user' ? 'user' : row.type === 2 ? undefined : 'user';
  if (row.type === 2 && !actorType) throw new SocialContentShapeError('feed trade.actor_type is missing');
  const smartMoney = normalizeSmartMoney(row.smart_money);
  const actor = normalizeActor(row.actor, actorType === 'smart_money');
  if (actorType === 'smart_money' && (!smartMoney || smartMoney.address !== actorIdentifier)) throw new SocialContentShapeError('feed smart money identity mismatch');
  if (actorType === 'user' && actor.identifier !== actorIdentifier) throw new SocialContentShapeError('feed user identity mismatch');

  if (row.type === 2) {
    const trade = normalizeTrade(row.trade);
    return {type: 2, sourceID, actorIdentifier, actorType, actor, ...(smartMoney ? {smartMoney} : {}), sortTime: normalizeTimestamp(row.sort_time, 'feed item.sort_time'), content: {kind: 'trade', trade}};
  }

  // oneof content 平铺成字段名 opinion（README 规则）；未选中时线上是 null。
  const opinionCard = record(row.opinion);
  if (!opinionCard) throw new SocialContentShapeError('feed item.opinion card is missing');
  const content = normalizeOpinionCard(opinionCard);
  if (content.opinion.authorIdentifier !== actorIdentifier || sourceID !== content.opinion.opinionID) {
    throw new SocialContentShapeError('feed position, author or opinion identity mismatch');
  }

  return {
    type: 1,
    sourceID,
    actorIdentifier,
    actor, actorType: 'user',
    sortTime: normalizeTimestamp(row.sort_time, 'feed item.sort_time'),
    content,
  };
}

function normalizePinnedRun(value: unknown): PinnedAnnouncementRun {
  const row = record(value);
  const text = nonEmptyString(row?.text);
  if (!row || !text) throw new SocialContentShapeError('pinned announcement run is invalid');
  if (row.type === 'text') {
    const marks = row.marks ?? [];
    if (!Array.isArray(marks) || marks.some((mark) => mark !== 'bold' && mark !== 'italic')) {
      throw new SocialContentShapeError('pinned announcement text marks are invalid');
    }
    return {type: 'text', text, marks};
  }
  if (row.type === 'ticker') {
    const chain = nonEmptyString(row.chain);
    const address = nonEmptyString(row.address);
    if (!chain || !address) throw new SocialContentShapeError('pinned announcement ticker identity is missing');
    return {type: 'ticker', text, chain, address};
  }
  if (row.type === 'link') {
    const url = nonEmptyString(row.url);
    if (!url || !/^https:\/\/[^\s]+$/i.test(url)) throw new SocialContentShapeError('pinned announcement link is invalid');
    return {type: 'link', text, url};
  }
  throw new SocialContentShapeError('pinned announcement run type is unknown');
}

function normalizePinnedAnnouncement(value: unknown): PinnedAnnouncement {
  const row = record(value);
  const id = nonEmptyString(row?.id);
  const authorID = nonEmptyString(row?.author_id);
  const authorName = nonEmptyString(row?.author_name);
  const authorAvatarURL = nonEmptyString(row?.author_avatar_url) ?? '';
  const title = nonEmptyString(row?.title);
  const pinSlot = safeInteger(row?.pin_slot);
  if (!row || !id || !authorID || !authorName || !title || !pinSlot || pinSlot < 1 || pinSlot > 5 || !Array.isArray(row.body)) {
    throw new SocialContentShapeError('pinned announcement is invalid');
  }
  if (authorAvatarURL && !/^https:\/\/[^\s]+$/i.test(authorAvatarURL)) {
    throw new SocialContentShapeError('pinned announcement author avatar URL is invalid');
  }
  const body = row.body.map((value) => {
    const paragraph = record(value);
    if (!paragraph || !Array.isArray(paragraph.children)) throw new SocialContentShapeError('pinned announcement paragraph is invalid');
    return {children: paragraph.children.map(normalizePinnedRun)};
  });
  return {id, pinSlot, authorID, authorName, authorAvatarURL,
    authorVerified: omittedBoolean(row, 'author_verified'), title, body,
    publishedAt: normalizeTimestamp(row.published_at, 'pinned announcement.published_at'),
    likeCount: omittedInteger(row, 'like_count'), viewerLike: omittedBoolean(row, 'viewer_like')};
}

function normalizeFeedData(value: unknown): SquareFeedData {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('feed data is not an object');
  if (row.items !== undefined && !Array.isArray(row.items)) {
    throw new SocialContentShapeError('feed data.items is not an array');
  }
  if (row.pinned_announcements !== undefined && !Array.isArray(row.pinned_announcements)) {
    throw new SocialContentShapeError('feed data.pinned_announcements is not an array');
  }
  const nextCursor = nonEmptyString(row.next_cursor) as SquarePageCursor | undefined;
  const batchID = nonEmptyString(row.batch_id);
  const asOfRaw = row.as_of === undefined ? undefined : normalizeTimestamp(row.as_of, 'feed data.as_of');
  // 全零时间戳（seconds === 0）是"未设置"的新编码，不是 1970 年。
  const asOf = asOfRaw && asOfRaw.seconds > 0 ? asOfRaw : undefined;
  const refreshAnchor = nonEmptyString(row.refresh_anchor) as SquareRefreshAnchor | undefined;

  return {
    items: (row.items ?? [])
      .map(normalizeFeedItem)
      .filter((item): item is SquareFeedItem => item !== undefined),
    ...(row.pinned_announcements !== undefined ? {pinnedAnnouncements: row.pinned_announcements.map(normalizePinnedAnnouncement)} : {}),
    ...(nextCursor ? {nextCursor} : {}),
    ...(batchID ? {batchID} : {}),
    ...(asOf ? {asOf} : {}),
    ...(refreshAnchor ? {refreshAnchor} : {}),
  };
}

function normalizeUpdatesData(value: unknown): SquareUpdatesData {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('updates data is not an object');
  if (row.actors !== undefined && !Array.isArray(row.actors)) {
    throw new SocialContentShapeError('updates data.actors is not an array');
  }
  return {
    count: omittedInteger(row, 'count'),
    hasMore: omittedBoolean(row, 'has_more'),
    actors: (row.actors ?? []).map((value) => normalizeActor(value)),
  };
}

function normalizeOpinionReply(value: unknown): Opinion {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('opinion reply data is not an object');
  return normalizeOpinion(row.opinion);
}

function normalizeHistoryData(value: unknown): OpinionHistoryData {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('history data is not an object');
  if (row.versions !== undefined && !Array.isArray(row.versions)) {
    throw new SocialContentShapeError('history data.versions is not an array');
  }
  const nextCursor = nonEmptyString(row.next_cursor);
  return {
    versions: (row.versions ?? []).map((version, index) => normalizeVersion(version, `history.versions[${index}]`)),
    ...(nextCursor ? {nextCursor} : {}),
  };
}

function normalizeLikeResult(value: unknown): LikeMutationResult {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('like data is not an object');
  return {
    likeCount: omittedInteger(row, 'like_count'),
    liked: omittedBoolean(row, 'liked'),
    changed: omittedBoolean(row, 'changed'),
  };
}

function normalizeDeleteResult(value: unknown): DeleteOpinionResult {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('delete data is not an object');
  return {
    changed: omittedBoolean(row, 'changed'),
  };
}

function opinionPath(opinionID: string): string {
  return `/v1/social/opinions/${encodeURIComponent(socialID(opinionID))}`;
}

function versionPath(versionID: string, action: 'like' | 'unlike'): string {
  return `/v1/social/opinions/versions/${encodeURIComponent(socialID(versionID))}/${action}`;
}

function pinnedAnnouncementPath(id: string, action: 'like' | 'unlike'): string {
  if (!id) throw new SocialContentShapeError('pinned announcement id is missing');
  return `/v1/social/pinned-announcements/${encodeURIComponent(id)}/${action}`;
}

export async function listSquareFeedPage(
  lane: SquareLane,
  options: SquareFeedOptions = {},
): Promise<SquareFeedData> {
  const query = new URLSearchParams({lane});
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  for (const filter of options.filters ?? []) query.append('filters', filter);
  const response = await socialCall(`/v1/social/square/feed?${query.toString()}`, {
    bearer: options.bearer,
    signal: options.signal,
  });
  return normalizeFeedData(response.data);
}

/**
 * §6.2 unread polling against the stored refresh anchor. Without a cold-start
 * anchor the anchor parameter must stay absent (the server then returns
 * count=0); never fake one from next_cursor. Errors: 100103 stale/broken
 * anchor (drop it and reload the first page), 400000 bad session.
 */
export async function getSquareFeedUpdates(
  lane: SquareLane,
  options: SquareFeedUpdatesOptions = {},
): Promise<SquareUpdatesData> {
  const query = new URLSearchParams({lane});
  if (options.anchor) query.set('anchor', options.anchor);
  for (const filter of options.filters ?? []) query.append('filters', filter);
  const response = await socialCall(`/v1/social/square/feed/updates?${query.toString()}`, {
    bearer: options.bearer,
    signal: options.signal,
  });
  return normalizeUpdatesData(response.data);
}

export async function getOpinion(
  opinionID: string,
  options: OpinionReadOptions = {},
): Promise<Opinion> {
  return (await getOpinionCard(opinionID, options)).opinion;
}

/** Detail/share consumers use exactly the same card contract as Square. */
export async function getOpinionCard(opinionID: string, options: OpinionReadOptions = {}): Promise<OpinionFeedContent> {
  const response = await socialCall(opinionPath(opinionID), {bearer: options.bearer});
  return normalizeOpinionCard(response.data);
}

export async function getOpinionHistory(
  opinionID: string,
  options: OpinionHistoryOptions = {},
): Promise<OpinionHistoryData> {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await socialCall(`${opinionPath(opinionID)}/history${suffix}`, {
    bearer: options.bearer,
  });
  return normalizeHistoryData(response.data);
}

export async function getOpinionByTarget(
  bearer: string,
  targetType: OpinionTargetName,
  targetID: string,
): Promise<Opinion> {
  const query = new URLSearchParams({target_type: targetType, target_id: targetID});
  const response = await socialCall(`/v1/social/opinion-by-target?${query.toString()}`, {bearer});
  return normalizeOpinionCard(response.data).opinion;
}

export async function createOpinion(bearer: string, input: CreateOpinionInput): Promise<Opinion> {
  const response = await socialCall('/v1/social/opinions', {
    method: 'POST',
    bearer,
    body: {
      target_type: input.targetType,
      target_id: input.targetID,
      body: input.body,
      items: input.items ?? [],
      idempotency_key: input.idempotencyKey,
    },
  });
  return normalizeOpinionReply(response.data);
}

export async function updateOpinion(
  bearer: string,
  opinionID: string,
  input: UpdateOpinionInput,
): Promise<Opinion> {
  const response = await socialCall(opinionPath(opinionID), {
    method: 'PUT',
    bearer,
    body: {
      base_version_id: socialID(input.baseVersionID),
      body: input.body,
      items: input.items ?? [],
      idempotency_key: input.idempotencyKey,
    },
  });
  return normalizeOpinionReply(response.data);
}

export async function likeOpinionVersion(bearer: string, versionID: string): Promise<LikeMutationResult> {
  const response = await socialCall(versionPath(versionID, 'like'), {
    method: 'POST',
    bearer,
  });
  return normalizeLikeResult(response.data);
}

export async function unlikeOpinionVersion(bearer: string, versionID: string): Promise<LikeMutationResult> {
  const response = await socialCall(versionPath(versionID, 'unlike'), {
    method: 'POST',
    bearer,
  });
  return normalizeLikeResult(response.data);
}

export async function likePinnedAnnouncement(bearer: string, id: string): Promise<LikeMutationResult> {
  const response = await socialCall(pinnedAnnouncementPath(id, 'like'), {method: 'POST', bearer});
  return normalizeLikeResult(response.data);
}

export async function unlikePinnedAnnouncement(bearer: string, id: string): Promise<LikeMutationResult> {
  const response = await socialCall(pinnedAnnouncementPath(id, 'unlike'), {method: 'POST', bearer});
  return normalizeLikeResult(response.data);
}

export async function deleteOpinion(bearer: string, opinionID: string): Promise<DeleteOpinionResult> {
  const response = await socialCall(opinionPath(opinionID), {
    method: 'DELETE',
    bearer,
  });
  return normalizeDeleteResult(response.data);
}

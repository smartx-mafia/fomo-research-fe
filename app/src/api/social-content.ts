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

export const SQUARE_LANES = {
  NEWEST: 'SQUARE_LANE_NEWEST',
  FRIENDS: 'SQUARE_LANE_FRIENDS',
  FOR_YOU: 'SQUARE_LANE_FOR_YOU',
} as const;

export type SquareLane = (typeof SQUARE_LANES)[keyof typeof SQUARE_LANES];
export type OpinionTargetName = 'POSITION';
export type OpinionTargetType = 1;
export type SquareItemType = 1;

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
  versionID: number;
  versionNo: number;
  body: string;
  items: OpinionAttachment[];
  likeCount: number;
  publishedAt: ProtoTimestamp;
  viewerLike: boolean;
};

export type Opinion = {
  opinionID: number;
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

/** Missing strings remain missing: unavailable PnL or symbol is not zero. */
export type PositionSummary = {
  pnlPercent?: string;
  tokenSymbol?: string;
  quality?: string;
};

export type OpinionFeedContent = {
  kind: 'opinion';
  opinion: Opinion;
  /** Whole message missing means the position summary is unavailable. */
  position?: PositionSummary;
};

export type SquareFeedItem = {
  type: SquareItemType;
  sourceID: string;
  actorIdentifier: string;
  actor: UserActor;
  sortTime: ProtoTimestamp;
  content: OpinionFeedContent;
};

export type SquareFeedData = {
  /** The encoder returns data={} for an empty page. */
  items: SquareFeedItem[];
  /** Missing or empty means pagination is exhausted. */
  nextCursor?: string;
  /** FOR_YOU only. */
  batchID?: string;
  /** FOR_YOU only. */
  asOf?: ProtoTimestamp;
  /**
   * Opaque feed updates anchor (§6.2). Every page of a session returns the
   * same value; a cursor-less first-page refresh advances it. Expires in 24h
   * and is bound to the lane. Empty pages still carry it.
   */
  refreshAnchor?: string;
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
  baseVersionID: number;
  body: string;
  items?: readonly OpinionAttachmentInput[];
  idempotencyKey: string;
};

export type SquareFeedOptions = {
  /** Optional for NEWEST/FOR_YOU; required by the backend for FRIENDS. */
  bearer?: string;
  cursor?: string;
  limit?: number;
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

  const versionID = safeInteger(row.version_id);
  const versionNo = safeInteger(row.version_no);
  const body = nonEmptyString(row.body);
  if (versionID === undefined || versionID <= 0) {
    throw new SocialContentShapeError(`${field}.version_id is missing or invalid`);
  }
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

  const opinionID = safeInteger(row.opinion_id);
  const authorIdentifier = nonEmptyString(row.author_identifier);
  const targetID = nonEmptyString(row.target_id);
  if (opinionID === undefined || opinionID <= 0) {
    throw new SocialContentShapeError('opinion.opinion_id is missing or invalid');
  }
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

function normalizeActor(value: unknown): UserActor {
  const row = record(value);
  const identifier = nonEmptyString(row?.identifier);
  if (!row || !identifier) throw new SocialContentShapeError('feed actor.identifier is missing');
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

function normalizePosition(value: unknown): PositionSummary | undefined {
  // 规则 10：未设置的 message 展开成全零对象；三个字段全空 = 摘要不可用。
  if (value === undefined || value === null) return undefined;
  const row = record(value);
  if (!row) throw new SocialContentShapeError('feed opinion position is not an object');
  const pnlPercent = nonEmptyString(row.pnl_percent);
  const tokenSymbol = nonEmptyString(row.token_symbol);
  const quality = nonEmptyString(row.quality);
  if (!pnlPercent && !tokenSymbol && !quality) return undefined;
  return {
    ...(pnlPercent ? {pnlPercent} : {}),
    ...(tokenSymbol ? {tokenSymbol} : {}),
    ...(quality ? {quality} : {}),
  };
}

function normalizeFeedItem(value: unknown): SquareFeedItem | undefined {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('feed item is not an object');

  // Unknown future card types are ignored until the UI has a renderer for them.
  if (row.type !== 1) return undefined;
  const sourceID = nonEmptyString(row.source_id);
  const actorIdentifier = nonEmptyString(row.actor_identifier);
  if (!sourceID) throw new SocialContentShapeError('feed item.source_id is missing');
  if (!actorIdentifier) throw new SocialContentShapeError('feed item.actor_identifier is missing');

  // oneof content 平铺成字段名 opinion（README 规则）；未选中时线上是 null。
  const opinionCard = record(row.opinion);
  if (!opinionCard) throw new SocialContentShapeError('feed item.opinion card is missing');
  const position = normalizePosition(opinionCard.position);

  return {
    type: 1,
    sourceID,
    actorIdentifier,
    actor: normalizeActor(row.actor),
    sortTime: normalizeTimestamp(row.sort_time, 'feed item.sort_time'),
    content: {
      kind: 'opinion',
      opinion: normalizeOpinion(opinionCard.opinion),
      ...(position ? {position} : {}),
    },
  };
}

function normalizeFeedData(value: unknown): SquareFeedData {
  const row = record(value);
  if (!row) throw new SocialContentShapeError('feed data is not an object');
  if (row.items !== undefined && !Array.isArray(row.items)) {
    throw new SocialContentShapeError('feed data.items is not an array');
  }
  const nextCursor = nonEmptyString(row.next_cursor);
  const batchID = nonEmptyString(row.batch_id);
  const asOfRaw = row.as_of === undefined ? undefined : normalizeTimestamp(row.as_of, 'feed data.as_of');
  // 全零时间戳（seconds === 0）是"未设置"的新编码，不是 1970 年。
  const asOf = asOfRaw && asOfRaw.seconds > 0 ? asOfRaw : undefined;
  const refreshAnchor = nonEmptyString(row.refresh_anchor);

  return {
    items: (row.items ?? [])
      .map(normalizeFeedItem)
      .filter((item): item is SquareFeedItem => item !== undefined),
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
    actors: (row.actors ?? []).map(normalizeActor),
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

function opinionPath(opinionID: number): string {
  return `/v1/social/opinions/${encodeURIComponent(String(opinionID))}`;
}

function versionPath(versionID: number, action: 'like' | 'unlike'): string {
  return `/v1/social/opinions/versions/${encodeURIComponent(String(versionID))}/${action}`;
}

export async function fetchSquareFeed(
  lane: SquareLane,
  options: SquareFeedOptions = {},
): Promise<SquareFeedData> {
  const query = new URLSearchParams({lane});
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const response = await call<unknown>(`/v1/social/square/feed?${query.toString()}`, {
    bearer: options.bearer,
  });
  return normalizeFeedData(response.data);
}

/**
 * §6.2 unread polling against the stored refresh anchor. Without a cold-start
 * anchor the anchor parameter must stay absent (the server then returns
 * count=0); never fake one from next_cursor. Errors: 100103 stale/broken
 * anchor (drop it and reload the first page), 400000 bad session.
 */
export async function fetchSquareFeedUpdates(
  lane: SquareLane,
  options: SquareFeedOptions & {anchor?: string} = {},
): Promise<SquareUpdatesData> {
  const query = new URLSearchParams({lane});
  if (options.anchor) query.set('anchor', options.anchor);
  const response = await call<unknown>(`/v1/social/square/feed/updates?${query.toString()}`, {
    bearer: options.bearer,
  });
  return normalizeUpdatesData(response.data);
}

export async function getOpinion(
  opinionID: number,
  options: OpinionReadOptions = {},
): Promise<Opinion> {
  const response = await call<unknown>(opinionPath(opinionID), {bearer: options.bearer});
  return normalizeOpinionReply(response.data);
}

export async function getOpinionHistory(
  opinionID: number,
  options: OpinionHistoryOptions = {},
): Promise<OpinionHistoryData> {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await call<unknown>(`${opinionPath(opinionID)}/history${suffix}`, {
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
  const response = await call<unknown>(`/v1/social/opinion-by-target?${query.toString()}`, {bearer});
  return normalizeOpinionReply(response.data);
}

export async function createOpinion(bearer: string, input: CreateOpinionInput): Promise<Opinion> {
  const response = await call<unknown>('/v1/social/opinions', {
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
  opinionID: number,
  input: UpdateOpinionInput,
): Promise<Opinion> {
  const response = await call<unknown>(opinionPath(opinionID), {
    method: 'PUT',
    bearer,
    body: {
      base_version_id: input.baseVersionID,
      body: input.body,
      items: input.items ?? [],
      idempotency_key: input.idempotencyKey,
    },
  });
  return normalizeOpinionReply(response.data);
}

export async function likeOpinionVersion(bearer: string, versionID: number): Promise<LikeMutationResult> {
  const response = await call<unknown>(versionPath(versionID, 'like'), {
    method: 'POST',
    bearer,
  });
  return normalizeLikeResult(response.data);
}

export async function unlikeOpinionVersion(bearer: string, versionID: number): Promise<LikeMutationResult> {
  const response = await call<unknown>(versionPath(versionID, 'unlike'), {
    method: 'POST',
    bearer,
  });
  return normalizeLikeResult(response.data);
}

export async function deleteOpinion(bearer: string, opinionID: number): Promise<DeleteOpinionResult> {
  const response = await call<unknown>(opinionPath(opinionID), {
    method: 'DELETE',
    bearer,
  });
  return normalizeDeleteResult(response.data);
}

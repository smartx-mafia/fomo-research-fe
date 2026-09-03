/**
 * 代币自选（收藏 / Watchlist）—— docs/contracts/favorites.md。
 *
 * 四个端点全部需要登录（匿名 400000）。最容易踩的坑都来自 protojson 的
 * 零值省略：bool 的 false **整个键不出现在 JSON 里**，所以这里所有布尔
 * 一律 `!!x` 真值判断，绝不写 `'changed' in data` / `x === false`。
 */
import {call} from './envelope';

export type FavoriteSort = 'favorited_at_desc' | 'market_cap_desc' | 'price_change_24h_desc' | 'volume_24h_desc';

/** POST /v1/tokens/favorites（或 .../delete）的回包 data */
export type FavoriteMutationReply = {
  /** 这次调用之后的状态：收藏成功恒 true、取消成功恒 false（=缺席）。重复调用仍是正确答案 */
  favorited?: boolean;
  /** 这次有没有真的改动。缺席 = false（幂等重复调用） */
  changed?: boolean;
  chain: string;
  /** 服务端归一化后的形态（EVM 小写）。更新本地状态用它，不要用发出去的原始大小写 */
  address: string;
};

/** GET /v1/tokens/favorites 的条目。market 缺席 = 服务端没有行情快照，渲染 "—" */
export type FavoriteItem = {
  chain: string;
  address: string;
  /** unix 毫秒 */
  favorited_at?: number | string;
  market?: Record<string, unknown>;
  /** market 缺席时由静态元数据兜底给出 */
  symbol?: string;
  name?: string;
};

export type FavoriteList = {
  items: FavoriteItem[];
  total?: number;
  /** 收藏数硬上限（当前 500）。total >= limit 时应禁用收藏按钮（430110 之前） */
  limit?: number;
};

export type FavoriteStatusInput = {chain: string; address: string};

/** POST /v1/tokens/favorites/status 的回包条目。is_favorited 缺席 = false */
export type FavoriteStatusItem = {
  chain: string;
  address: string;
  is_favorited?: boolean;
};

/** 收藏。200107 = 链上没有这个币；430110 = 收藏数达上限；500097 = 行情上游不可用（准入判不了） */
export function addFavorite(bearer: string, chain: string, address: string) {
  return call<FavoriteMutationReply>('/v1/tokens/favorites', {
    method: 'POST',
    bearer,
    body: {chain, address},
  });
}

/** 取消收藏（POST .../delete 而非 DELETE：body 要带字段，DELETE+body 在代理层支持参差）。不做币存在性检查。 */
export function removeFavorite(bearer: string, chain: string, address: string) {
  return call<FavoriteMutationReply>('/v1/tokens/favorites/delete', {
    method: 'POST',
    bearer,
    body: {chain, address},
  });
}

/** 我的自选列表（含行情）。不分页一次全量；sort 非法回 100120，不会静默回退默认值 */
export function listFavorites(bearer: string, sort?: FavoriteSort) {
  return call<FavoriteList>(`/v1/tokens/favorites${sort ? `?sort=${sort}` : ''}`, {bearer});
}

/**
 * 批量查收藏状态（榜单/搜索星标用，这两个面没有 personal 字段）。
 * 回包与请求**等长、按下标一一对应**——zip 用下标，不要按 address 反查
 * （回显是归一化后的地址，大小写可能不同）。空列表或 >500 回 100120。
 */
export function favoriteStatus(bearer: string, tokens: FavoriteStatusInput[]) {
  return call<{results: FavoriteStatusItem[]}>('/v1/tokens/favorites/status', {
    method: 'POST',
    bearer,
    body: {tokens},
  });
}

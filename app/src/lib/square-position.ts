import type {SquareFeedItem} from '@/api/social-content';
import type {PortfolioPosition} from '@/api/portfolio';
import {tokenApiChain, tokenKey} from '@/api/token-metadata';

export type SquarePositionTarget = {
  kind: 'user' | 'wallet' | 'external_user';
  identifier: string;
  chain: string;
  address: string;
  name: string;
  avatarURL?: string;
  symbol?: string;
  logo?: string;
  cycleKey?: string;
  closedHint?: boolean;
  opinionBody?: string;
};

/** App SquareTradeRow / SquareOpinionRow: actor identity and cycle are separate
 * from the token identity. A trade amount is never the author's current holding. */
export function squarePositionTarget(item: SquareFeedItem): SquarePositionTarget | undefined {
  const token = item.type === 1 ? item.content.token : item.content.trade.token;
  if (item.type === 1 && !token) return undefined;
  const chain = item.type === 1 ? item.content.position.asset.chain : item.content.trade.chain;
  const address = item.type === 1 ? item.content.position.asset.token_address : item.content.trade.tokenAddress;
  const uiChain = tokenApiChain(chain);
  if (!uiChain || !tokenKey(chain, address)) return undefined;
  const smart = item.actorType === 'smart_money';
  const identifier = smart ? item.smartMoney?.subjectId || item.smartMoney?.address || item.actorIdentifier : item.actor.identifier;
  if (!identifier) return undefined;
  const kind = /^subject:[1-9]\d*$/.test(identifier) ? 'external_user' : smart ? 'wallet' : 'user';
  return {kind, identifier, chain: uiChain, address,
    name: smart ? item.smartMoney?.displayName || identifier : item.actor.nickname || item.actor.username || identifier,
    avatarURL: smart ? item.smartMoney?.avatarURL : item.actor.avatarURL,
    symbol: token?.symbol || (item.type === 1 ? item.content.position.symbol : undefined), logo: token?.logo,
    // External snapshots have no platform ledger cycle identity.
    cycleKey: kind === 'user' ? item.type === 1 ? item.content.position.cycle_key : item.content.trade.cycleKey : undefined,
    closedHint: item.type === 1 ? BigInt(item.content.position.shares_raw) === 0n : undefined,
    opinionBody: item.type === 1 ? item.content.opinion.latestVersion.body : undefined};
}

export function squarePositionKey(target: SquarePositionTarget) {
  return JSON.stringify([target.kind, target.identifier, target.chain, target.address, target.cycleKey ?? '', target.closedHint]);
}

export function samePositionAsset(chain: string, address: string, target: Pick<SquarePositionTarget, 'chain' | 'address'>) {
  const uiChain = (chain: string) => chain === 'sol' ? 'solana' : chain === 'eth' ? 'ethereum' : chain;
  return tokenKey(uiChain(chain), address) === tokenKey(uiChain(target.chain), target.address);
}

/** Only the selected author's current portfolio may resolve a missing cycle. */
export function squareCurrentCycle(target: SquarePositionTarget, positions?: PortfolioPosition[]): string | undefined {
  if (target.kind !== 'user' || target.closedHint === true) return undefined;
  return positions?.find((position) => samePositionAsset(position.asset.chain, position.asset.token_address, target))?.cycle_key;
}

export function squareSmartMoneyChain(target: SquarePositionTarget): string {
  if (target.chain === 'solana' || target.chain === 'sol') return 'sol';
  if (target.chain === 'ethereum' || target.chain === 'eth') return 'eth';
  if (['base', 'bsc', 'robinhood'].includes(target.chain)) return target.chain;
  throw new Error('Unsupported position chain.');
}

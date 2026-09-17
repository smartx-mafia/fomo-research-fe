import {BUSINESS_API_BASE} from '@/config';

/** Fast Swap currently shares the test gateway, but keeps its own override for the future dedicated origin. */
export const FAST_SWAP_API_BASE = (
  process.env.NEXT_PUBLIC_FAST_SWAP_API_BASE || BUSINESS_API_BASE
).replace(/\/+$/, '');

export const FAST_SWAP_CONTRACT_VERSION = 'fast-swap.v1' as const;

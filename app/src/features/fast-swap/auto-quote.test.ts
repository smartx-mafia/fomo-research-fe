import {describe, expect, it} from 'vitest';

import {draftMatchesIntent, type QuoteDraft} from './auto-quote';
import {FeePolicy, Side, SlippageMode, type CreateIntent} from './contract';

const draft: QuoteDraft = {
  origin_chain: 'solana:mainnet',
  destination_chain: 'solana:mainnet',
  origin_asset: 'So11111111111111111111111111111111111111112',
  destination_asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount_in_raw: '1000000',
  slippage_mode: SlippageMode.AUTO,
  slippage_bps: 0,
  side: Side.SWAP,
  source_wallet_id: 'source',
  destination_wallet_id: 'destination',
  fee_policy: FeePolicy.PLATFORM_SPONSORED,
};

function intent(overrides: Partial<CreateIntent> = {}): CreateIntent {
  return {...draft, client_intent_id: 'intent-id', slippage_bps: 275, slippage_mode: undefined, ...overrides};
}

describe('draftMatchesIntent', () => {
  it('accepts the server-adopted AUTO slippage while matching all other fields', () => {
    expect(draftMatchesIntent(draft, intent())).toBe(true);
    expect(draftMatchesIntent(draft, intent({amount_in_raw: '2000000'}))).toBe(false);
  });

  it('requires the exact bps in MANUAL mode', () => {
    const manual = {...draft, slippage_mode: SlippageMode.MANUAL, slippage_bps: 300};
    expect(draftMatchesIntent(manual, intent({slippage_mode: SlippageMode.MANUAL, slippage_bps: 300}))).toBe(true);
    expect(draftMatchesIntent(manual, intent({slippage_mode: SlippageMode.MANUAL, slippage_bps: 301}))).toBe(false);
  });
});

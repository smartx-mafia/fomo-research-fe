import type {CreateIntent, SwapSnapshot} from './contract';

/** Synthetic state used by quote orchestration tests. It cannot be signed. */
export function quoteFixture(amount = '2000000'): SwapSnapshot {
  const intent: CreateIntent = {client_intent_id:'intent', origin_chain:'solana:mainnet', destination_chain:'solana:mainnet',
    origin_asset:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', destination_asset:'So11111111111111111111111111111111111111112',
    amount_in_raw:amount, slippage_bps:300, side:3, source_wallet_id:'wallet-sol', destination_wallet_id:'wallet-sol', fee_policy:1};
  return {
    swap_id:'swap', execution_group_id:'group', event_version:'1', intent, intent_hash:'hash',
    preparation:{status:2,current_revision:'1',retry_after_ms:8000,reason_code:null},
    revision:{revision:'1',intent_hash:'hash',created_at:'2026-09-16T00:00:00Z',quote_valid_until:'2026-09-16T00:00:12Z',
      safe_sign_before:'2026-09-16T00:00:08Z',safe_broadcast_before:'2026-09-16T00:00:10Z',
      assets:{origin:{chain:intent.origin_chain,address:intent.origin_asset,decimals:6},destination:{chain:intent.destination_chain,address:intent.destination_asset,decimals:9}},
      expected_out_raw:'20000000',min_out_raw:'19000000',fees:[],relay_request_id:'relay',evm:null,
      solana:{kind:1,transaction_base64:'NOT_SIGNABLE_TEST_DATA',message_hash:'hash',fee_payer_address:'platform',user_signer_address:'user',
        blockhash:'hash',last_valid_block_height:'1000',lookup_tables:[],execution_guard:{program_id:'',group_id:'group'},broadcast:{mode:1,endpoint_id:'gateway',backup_endpoint_id:null}}},
    execution:{status:1,artifact_hash:null,origin_tx_hash:null,relay_request_id:null,relay_execution_id:null,user_operation_hash:null},
    settlement:{source:1,destination:1,relay:1,accounting:1,outcome:1,amount_in_actual_raw:null,amount_out_actual_raw:null,amount_refunded_raw:null,destination_tx_hash:null,destination_observed_at:null,destination_finalized_at:null,refund_fee_delta_raw:null},
    fast_fill:{status:1,reason_code:null},
    availability:{asset:'',chain:'',wallet_id:'',balance_raw:null,reserved_raw:null,spendable_raw:null,can_execute:false,reason_code:null,observed_block:null,observed_at:null},
  };
}

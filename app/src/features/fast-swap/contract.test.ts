import {describe, expect, it} from 'vitest';

import {ExecutionStatus, isReady, newerSnapshot, parseSwapReply, PreparationStatus, serverAllowsSigning} from './contract';

function zeroSnapshot() {
  return {
    swap_id: '11111111-1111-4111-8111-111111111111', execution_group_id: '22222222-2222-4222-8222-222222222222', event_version: '7',
    intent: {client_intent_id: '33333333-3333-4333-8333-333333333333', origin_chain: 'solana:mainnet', destination_chain: 'eip155:8453', origin_asset: 'USDC', destination_asset: '0xToken', amount_in_raw: '1000000', slippage_bps: 300, side: 1, source_wallet_id: 'w-sol', destination_wallet_id: 'w-evm', fee_policy: 1},
    intent_hash: '11'.repeat(32),
    preparation: {status: 1, current_revision: null, retry_after_ms: null, reason_code: null},
    revision: {revision: '', intent_hash: '', created_at: '', quote_valid_until: '', safe_sign_before: '', safe_broadcast_before: '', assets: {origin: {chain: '', address: '', decimals: 0}, destination: {chain: '', address: '', decimals: 0}}, expected_out_raw: '', min_out_raw: '', fees: [], relay_request_id: '', solana: null, evm: null},
    execution: {status: 1, artifact_hash: null, origin_tx_hash: null, relay_request_id: null, relay_execution_id: null, user_operation_hash: null},
    settlement: {source: 1, destination: 1, relay: 1, accounting: 1, outcome: 1, amount_in_actual_raw: null, amount_out_actual_raw: null, amount_refunded_raw: null, destination_tx_hash: null, destination_observed_at: null, destination_finalized_at: null, refund_fee_delta_raw: null},
    fast_fill: {status: 1, reason_code: null},
    availability: {asset: '', chain: '', wallet_id: '', balance_raw: null, reserved_raw: null, spendable_raw: null, can_execute: false, reason_code: null, observed_block: null, observed_at: null},
  };
}

describe('fast swap wire contract', () => {
  it('accepts the protobuf all-zero revision while preparing and does not treat it as ready', () => {
    const swap = parseSwapReply({contract_version: 'fast-swap.v1', swap: zeroSnapshot()});
    expect(swap.revision).toBeTruthy();
    expect(isReady(swap)).toBe(false);
    expect(swap.availability.balance_raw).toBeNull();
  });

  it('requires status, current revision, intent hash and exactly one signing branch', () => {
    const raw: any = zeroSnapshot();
    raw.preparation = {status: PreparationStatus.READY, current_revision: '1', retry_after_ms: 8000, reason_code: null};
    raw.revision = {...raw.revision, revision: '1', intent_hash: raw.intent_hash, created_at: '2026-09-16T00:00:00Z', quote_valid_until: '2026-09-16T00:01:00Z', safe_sign_before: '2026-09-16T00:00:30Z', safe_broadcast_before: '2026-09-16T00:00:45Z', expected_out_raw: '42', min_out_raw: '40', relay_request_id: 'relay', assets: {origin: {chain: 'solana:mainnet', address: 'USDC', decimals: 6}, destination: {chain: 'eip155:8453', address: '0xToken', decimals: 18}}, solana: {kind: 1, transaction_base64: 'AQ==', message_hash: '22'.repeat(32), fee_payer_address: 'fee', user_signer_address: 'user', blockhash: 'block', last_valid_block_height: '1', lookup_tables: [], execution_guard: {program_id: '', group_id: ''}, broadcast: {mode: 1, endpoint_id: 'gateway', backup_endpoint_id: null}}};
    const parsed = parseSwapReply({contract_version: 'fast-swap.v1', swap: raw});
    expect(isReady(parsed)).toBe(true);
    expect(serverAllowsSigning(parsed)).toBe(true);
    parsed.execution.status = ExecutionStatus.UNKNOWN;
    expect(serverAllowsSigning(parsed)).toBe(false);
    parsed.execution.status = ExecutionStatus.FAILED;
    expect(serverAllowsSigning(parsed)).toBe(false);
    parsed.revision.evm = {kind: 2, chain: 'eip155:8453', signer_address: '0x1', execution_digest: '0x1', nonce: '1', deadline: '2026-09-16T00:00:45Z', requests: []};
    expect(isReady(parsed)).toBe(false);
  });

  it('rejects an incompatible contract version', () => {
    expect(() => parseSwapReply({contract_version: 'fast-swap.v2', swap: zeroSnapshot()})).toThrow(/Unsupported/);
  });

  it('normalizes google.protobuf.Struct emitted by the descriptor wire encoder', () => {
    const raw: any = zeroSnapshot();
    const scalar = (kind: string, value: unknown) => ({null_value:null,number_value:null,string_value:null,bool_value:null,struct_value:null,list_value:null,[kind]:value});
    const struct = (fields: Record<string, unknown>) => ({fields});
    raw.revision.evm = {
      kind:2, chain:'eip155:4663', signer_address:'0x133d7baB501Cd965eA6A5C455572Fbf65B58d256', execution_digest:'0x01', nonce:'1', deadline:'2026-09-16T00:01:00Z',
      requests:[{request_id:'calibur_batch',method:1,authorization:null,typed_data:{
        domain:struct({name:scalar('string_value','Calibur')}),
        types:struct({Call:scalar('list_value',{values:[scalar('struct_value',struct({name:scalar('string_value','to'),type:scalar('string_value','address')}))]})}),
        primary_type:'SignedBatchedCall',
        message:struct({batchedCall:scalar('struct_value',struct({revertOnFailure:scalar('bool_value',true)}))}),
      }}],
    };
    const parsed = parseSwapReply({contract_version:'fast-swap.v1',swap:raw});
    expect(parsed.revision.evm?.requests[0]?.typed_data?.domain).toEqual({name:'Calibur'});
    expect(parsed.revision.evm?.requests[0]?.typed_data?.types).toEqual({Call:[{name:'to',type:'address'}]});
    expect(parsed.revision.evm?.requests[0]?.typed_data?.message).toEqual({batchedCall:{revertOnFailure:true}});
  });

  it('keeps last measured availability when later events did not read balances, and clears it on reorg', () => {
    const current = parseSwapReply({contract_version:'fast-swap.v1',swap:zeroSnapshot()});
    current.availability = {...current.availability, asset:current.intent.destination_asset, chain:current.intent.destination_chain, wallet_id:current.intent.destination_wallet_id, spendable_raw:'123', observed_at:'2026-09-16T05:39:12Z', can_execute:true};
    const next = parseSwapReply({contract_version:'fast-swap.v1',swap:zeroSnapshot()});
    next.event_version = '8'; next.settlement.destination = 3;
    expect(newerSnapshot(current,next).availability.spendable_raw).toBe('123');
    next.settlement.destination = 4;
    expect(newerSnapshot(current,next).availability.spendable_raw).toBeNull();
  });
});

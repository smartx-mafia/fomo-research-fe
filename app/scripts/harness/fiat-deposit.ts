/** Controlled backend E2E using the existing harness transport. No App UI changes. */
import assert from 'node:assert/strict';
import {createPrivateKey, sign, randomUUID, createHmac} from 'node:crypto';
import {ApiError, callWithToken} from '../../src/features/harness/api';
import {setBaseOrigin} from '../../src/features/harness/transport';
const env=(name:string)=>{const v=process.env[name];assert(v,`missing ${name}`);return v;};
const token=env('HARNESS_TOKEN'),control=env('HARNESS_TEST_CONTROL');
assert.equal(new URL(control).hostname,'127.0.0.1');setBaseOrigin(env('HARNESS_API_ORIGIN'));
type Created={deposit_id:string;provider_order_id:string;client_secret:string;wallet_proof:{challenge_id:string;message:string}};
type Read={deposit:{status:number;chain:string;token_amount:string;token_address:string;tx_hash:string};provider_order_id:string;client_secret:string;next_action:string};
const post=(path:string,body:unknown)=>callWithToken<Created>(token,path,{method:'POST',body:JSON.stringify(body)});
async function code(n:number,fn:()=>Promise<unknown>){await assert.rejects(fn,(e:unknown)=>e instanceof ApiError&&e.code===n);}
async function state(s:string){assert.equal((await fetch(control+'/'+s,{method:'POST'})).status,200);}
async function main(){
 const payload={idempotency_key:'fiat-e2e-'+randomUUID(),fiat_amount:'2.00',fiat_currency:'USD',receipt_email:'buyer@example.com'};
 const c=await post('/v1/deposits/fiat',payload);assert(c.deposit_id&&c.provider_order_id&&c.client_secret);
 assert.equal((await post('/v1/deposits/fiat',payload)).deposit_id,c.deposit_id);
 await code(420100,()=>post('/v1/deposits/fiat',{...payload,fiat_amount:'3.00'}));
 const path='/v1/deposits/'+c.deposit_id;
 await code(400000,()=>callWithToken('',path));await code(200105,()=>callWithToken(env('HARNESS_OTHER_TOKEN'),path));
 const before=await callWithToken<Read>(token,path);assert.equal(before.provider_order_id,c.provider_order_id);assert.equal(before.next_action,'submit_wallet_proof');
 const proof='/v1/deposits/fiat/'+c.deposit_id+'/wallet-proof';
 await code(100115,()=>post(proof,{challenge_id:c.wallet_proof.challenge_id,signature:Buffer.alloc(64).toString('base64')}));
 const key=createPrivateKey({key:Buffer.from(env('HARNESS_TEST_WALLET_PKCS8'),'base64'),format:'der',type:'pkcs8'});
 await post(proof,{challenge_id:c.wallet_proof.challenge_id,signature:sign(null,Buffer.from(c.wallet_proof.message),key).toString('base64')});
 await state('delivery');const waiting=await callWithToken<Read>(token,path);assert.equal(waiting.deposit.status,4);assert.equal(waiting.next_action,'wait');
 await state('completed');const done=await callWithToken<Read>(token,path);assert.equal(done.deposit.status,5);assert.equal(done.next_action,'none');assert.equal(done.client_secret,'');
 assert.equal(done.deposit.chain,'solana');assert.equal(done.deposit.token_amount,'1790000');assert.equal(done.deposit.tx_hash,'fixture-delivery-tx');assert.equal(done.deposit.token_address,'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
 const snapshot=await(await fetch(control+'/snapshot')).json();
 const body=JSON.stringify({type:'orders.delivery.completed',data:snapshot});
 const id='msg-'+randomUUID(),stamp=String(Math.floor(Date.now()/1000));
 const signature=createHmac('sha256',Buffer.from('Zml4dHVyZS1maWF0LXdlYmhvb2sta2V5','base64')).update(`${id}.${stamp}.${body}`).digest('base64');
 const hook=env('HARNESS_API_ORIGIN')+'/v1/webhooks/crossmint';
 assert.equal((await fetch(hook,{method:'POST',body})).status,401);
 for(let i=0;i<2;i++) assert.equal((await fetch(hook,{method:'POST',body,headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+signature}})).status,200);
 await callWithToken<Read>(token,path);await callWithToken<Read>(token,path);
 const h=await callWithToken<{transfers:{record_id:string;kind:string;amount_raw:string;tx_hash:string}[]}>(token,'/v1/transfers');
 const rows=h.transfers.filter(x=>x.tx_hash==='fixture-delivery-tx');assert.equal(rows.length,1);assert.equal(rows[0].record_id,c.deposit_id);assert.equal(rows[0].kind,'deposit');assert.equal(rows[0].amount_raw,'1790000');
 const stats=await(await fetch(control+'/stats')).json();assert.equal(stats.creates,1);assert.equal(stats.notify_attempts,2);assert.equal(stats.notify_events,1);assert.equal(stats.proofs,1);
 console.log(JSON.stringify({result:'PASS',scope:'controlled HTTP + PostgreSQL; provider and Notify RPC fixtures',deposit_id:c.deposit_id,checks:['create','replay','conflict','auth','ownership','proof','checkout-recovery','delivery-refresh','actual-USDC','notification-retry','signed-webhook','webhook-replay','history-dedup']},null,2));
}
main().catch((e:unknown)=>{console.error(e instanceof ApiError?`API failure code=${e.code}`:e);process.exitCode=1;});

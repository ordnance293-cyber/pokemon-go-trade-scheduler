import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
function extract(name) {
  const start = script.indexOf(`function ${name}(`); assert.notEqual(start, -1, name);
  const brace = script.indexOf('{', start); let depth = 0;
  for (let i=brace;i<script.length;i++) { if(script[i]==='{')depth++; if(script[i]==='}'&&!--depth)return script.slice(start,i+1); }
}
const names=['normalizeLuckyTrinket','getLuckyTrinketAccountTaskKey','isLegacySellerRecordRelevantToCycle','timestampToLocalDate','buildLuckyTrinketAccountTasks','applyLuckyTrinketAccountTaskStates'];
const h=vm.runInNewContext(`(()=>{const LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID='cycle-a';${names.map(extract).join('\n')};return {${names.join(',')}}})()`);
const cycle={id:'cycle-a',startDate:'2026-01-01',endDate:'2026-01-31'};
const seller=(over={})=>({id:'s',account:'full-user;Secret!',status:'trading',luckyTrinket:'seller',luckyTrinketCycleId:'cycle-a',scheduledAt:10,...over});

test('task groups contain only current pending sellers and use full account identity',()=>{
 const rows=h.buildLuckyTrinketAccountTasks([seller(),seller({id:'s2'}),seller({id:'similar',account:'full-user;Other!'}),seller({id:'buyer',luckyTrinket:'buyer'}),seller({id:'normal',luckyTrinket:null}),seller({id:'stock',status:'stock'}),seller({id:'done',status:'done'}),seller({id:'old',luckyTrinketCycleId:'cycle-b'})],new Map(),cycle);
 assert.equal(rows.length,2); assert.equal(rows.find(x=>x.account==='full-user;Secret!').count,2);
});
test('cycle account record is authoritative and does not leak to buyer or another cycle',()=>{
 const map=new Map([[h.getLuckyTrinketAccountTaskKey('full-user;Secret!','cycle-a'),{completed:true}]]);
 const items=h.applyLuckyTrinketAccountTaskStates([seller(),seller({id:'buyer',luckyTrinket:'buyer',luckyTrinketTaskCompleted:true}),seller({id:'future',luckyTrinketCycleId:'cycle-b'})],map,cycle);
 assert.equal(items[0].luckyTrinketTaskCompleted,true); assert.equal(items[1].luckyTrinketTaskCompleted,true); assert.notEqual(items[2].luckyTrinketTaskCompleted,true);
});
test('legacy completed pending seller is recognized but stale buyer completion is not',()=>{
 const rows=h.buildLuckyTrinketAccountTasks([seller({luckyTrinketCycleId:undefined,tradeDate:'2026-01-10',luckyTrinketTaskCompleted:true}),seller({account:'buyer',luckyTrinket:'buyer',luckyTrinketTaskCompleted:true})],new Map(),cycle);
 assert.equal(rows.length,1); assert.equal(rows[0].completed,true);
});
test('task modal is read-only by default, copies exact credentials, and has guarded editing',()=>{
 assert.match(html,/id="openLuckyTrinketTaskBtn"[^>]*>📋 首飾任務/);
 assert.match(html,/📋 首飾任務清單/); assert.match(script,/navigator\.clipboard\.writeText\(task\.account\)/);
 assert.match(script,/name\.textContent = getLuckyTrinketAccountDisplayName\(task\.account\)/);
 assert.match(script,/edit\.textContent = '編輯'/); assert.doesNotMatch(html,/標記任務完成/);
 assert.match(script,/editingLuckyTrinketTaskDraft = task\.completed/); assert.match(script,/cancel[\s\S]*?editingLuckyTrinketTaskAccountKey = null/);
 assert.match(script,/if \(completed === task\.completed\)[\s\S]*?return/); assert.match(script,/window\.confirm\(message\)/);
});
test('one account-cycle listener and atomic scoped update preserve scheduling fields',()=>{
 assert.equal((script.match(/onSnapshot\(collection\(db, "luckyTrinketAccountTasks"\)/g)||[]).length,1);
 const update=extract('setLuckyTrinketAccountTaskCompleted').replace(/^function /,'async function ');
 assert.match(update,/where\('account', '==', account\).*where\('status', '==', 'trading'\)/s);
 assert.match(update,/await getDocs\(matchingQuery\)/);
 assert.doesNotMatch(update,/transaction\.get\(matchingQuery\)/);
 assert.match(update,/candidateRefs\.map\(documentRef => transaction\.get\(documentRef\)\)/);
 assert.match(update,/normalizeLuckyTrinket\(item\.luckyTrinket\) === 'seller'/);
 assert.doesNotMatch(update,/tradeDate\s*:/); assert.doesNotMatch(update,/scheduledAt\s*:/);
});
test('account task save queries outside the transaction and revalidates every candidate document',async()=>{
 const calls=[];
 const documents=[
  seller({id:'seller',tradeDate:'2026-01-12',scheduledAt:100}),
  seller({id:'buyer',luckyTrinket:'buyer',luckyTrinketTaskCompleted:false}),
  seller({id:'normal',luckyTrinket:null,luckyTrinketTaskCompleted:false}),
  seller({id:'wrong-cycle',luckyTrinketCycleId:'cycle-b',luckyTrinketTaskCompleted:false}),
  seller({id:'changed-status',status:'done',luckyTrinketTaskCompleted:false})
 ];
 const refs=documents.map(item=>({id:item.id,item}));
 const transaction={
  async get(ref){ assert.ok(!ref.isQuery,'Transaction.get received a Query'); calls.push(['get',ref.id]); return ref.isTask?{exists:()=>false,data:()=>({})}:{exists:()=>true,data:()=>ref.item,ref}; },
  set(ref,value){ calls.push(['set',ref.id,value]); },
  update(ref,value){ calls.push(['update',ref.id,value]); Object.assign(ref.item,value); }
 };
 const update=extract('setLuckyTrinketAccountTaskCompleted').replace(/^function /,'async function ');
 const run=vm.runInNewContext(`(async()=>{${extract('normalizeLuckyTrinket')}\n${extract('timestampToLocalDate')}\n${extract('isLegacySellerRecordRelevantToCycle')}\n${update};return setLuckyTrinketAccountTaskCompleted})()`,{
  db:{}, LUCKY_TRINKET_CYCLES:[cycle], LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID:'cycle-a',
  collection:()=>({}), where:(...args)=>args, query:()=>({isQuery:true}),
  getDocs:async queryValue=>{ assert.equal(queryValue.isQuery,true); calls.push(['getDocs']); return {docs:refs.map(ref=>({ref}))}; },
  getLuckyTrinketAccountTaskRef:()=>({id:'task',isTask:true}),
  runTransaction:async(_db,callback)=>callback(transaction), Date, Promise
 });
 const save=await run;
 await save('full-user;Secret!','cycle-a',true);
 assert.deepEqual(calls.filter(([kind])=>kind==='update').map(([,id])=>id),['seller']);
 assert.equal(documents[0].luckyTrinketTaskCompleted,true);
 assert.equal(documents[0].tradeDate,'2026-01-12'); assert.equal(documents[0].scheduledAt,100);
 for (const item of documents.slice(1)) assert.equal(item.luckyTrinketTaskCompleted,false);
 const firstTransactionRead=calls.findIndex(([kind])=>kind==='get');
 assert.ok(calls.findIndex(([kind])=>kind==='getDocs') < firstTransactionRead);
 assert.ok(calls.filter(([kind])=>kind==='get').length===refs.length+1);
 await save('full-user;Secret!','cycle-a',false);
 assert.equal(documents[0].luckyTrinketTaskCompleted,false);
});
test('future arrange inherits authoritative account-cycle completion and legacy backfill is seller scoped',()=>{
 assert.match(script,/accountTaskSnapshot\.exists\(\) \? accountTaskSnapshot\.data\(\)\.completed === true/);
 assert.match(script,/source: 'legacy-seller-trade-backfill'/);
 assert.match(script,/legacyCompleted && !luckyTrinketAccountTaskMap\.has\(task\.key\)/);
});

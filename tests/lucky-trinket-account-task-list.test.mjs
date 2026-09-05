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
 const update=extract('setLuckyTrinketAccountTaskCompleted');
 assert.match(update,/where\('account', '==', account\).*where\('status', '==', 'trading'\)/s);
 assert.match(update,/normalizeLuckyTrinket\(item\.luckyTrinket\) === 'seller'/);
 assert.doesNotMatch(update,/tradeDate\s*:/); assert.doesNotMatch(update,/scheduledAt\s*:/);
});
test('future arrange inherits authoritative account-cycle completion and legacy backfill is seller scoped',()=>{
 assert.match(script,/accountTaskSnapshot\.exists\(\) \? accountTaskSnapshot\.data\(\)\.completed === true/);
 assert.match(script,/source: 'legacy-seller-trade-backfill'/);
 assert.match(script,/legacyCompleted && !luckyTrinketAccountTaskMap\.has\(task\.key\)/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
function extract(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = script.indexOf('{', start); let depth = 0;
  for (let i = open; i < script.length; i++) {
    if (script[i] === '{') depth++;
    if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function helpers() {
  return Function(`${['normalizeLuckyTrinket','getTaipeiDateString','isValidDateString','getEffectiveCompletedTaipeiDate','getDailyTradeCompletionLockKey','getTradeSchedulePriority','getAccountCompletedTaipeiDates','addCalendarDays','buildAccountPrioritySchedulePlan'].map(extract).join(';')}; return {getTaipeiDateString,getEffectiveCompletedTaipeiDate,getDailyTradeCompletionLockKey,getAccountCompletedTaipeiDates,buildAccountPrioritySchedulePlan}`)();
}

test('Taipei calendar date changes exactly at Taipei midnight', () => {
  const { getTaipeiDateString } = helpers();
  assert.equal(getTaipeiDateString(Date.parse('2026-08-23T15:59:59Z')), '2026-08-23');
  assert.equal(getTaipeiDateString(Date.parse('2026-08-23T16:00:00Z')), '2026-08-24');
});

test('effective completion date uses explicit, timestamp, tradeDate priority', () => {
  const { getEffectiveCompletedTaipeiDate } = helpers();
  assert.equal(getEffectiveCompletedTaipeiDate({completedTaipeiDate:'2026-08-20',completedAt:Date.parse('2026-08-23T16:00:00Z'),tradeDate:'2026-08-22'}), '2026-08-20');
  assert.equal(getEffectiveCompletedTaipeiDate({completedAt:Date.parse('2026-08-23T16:00:00Z'),tradeDate:'2026-08-22'}), '2026-08-24');
  assert.equal(getEffectiveCompletedTaipeiDate({tradeDate:'2026-08-22'}), '2026-08-22');
  assert.equal(getEffectiveCompletedTaipeiDate({tradeDate:'bad'}), null);
});

test('daily lock identity uses full account and date', () => {
  const { getDailyTradeCompletionLockKey: key } = helpers();
  assert.equal(key('abcdef111111','2026-08-24'), key('abcdef111111','2026-08-24'));
  assert.notEqual(key('abcdef111111','2026-08-24'), key('abcdef111111','2026-08-25'));
  assert.notEqual(key('abcdef111111','2026-08-24'), key('abcdef222222','2026-08-24'));
  assert.doesNotMatch(extract('getDailyTradeCompletionLockKey'), /slice|getLuckyTrinketAccountDisplayName/);
});

test('planner gives no-Trinket real priority and stable lower-priority order', () => {
  const { buildAccountPrioritySchedulePlan: plan } = helpers();
  const items = [
    {id:'a',account:'full',status:'trading',tradeDate:'2026-08-24',createdAt:1,luckyTrinket:'seller'},
    {id:'b',account:'full',status:'trading',tradeDate:'2026-08-25',createdAt:2,luckyTrinket:'buyer'},
    {id:'c',account:'full',status:'trading',tradeDate:'2026-08-26',createdAt:3}
  ];
  assert.deepEqual(plan('full',items,new Map(),'2026-08-24').map(x=>[x.id,x.plannedTradeDate]), [['c','2026-08-24'],['a','2026-08-25'],['b','2026-08-26']]);
});

test('planner is deterministic, unique, account-local and immutable', () => {
  const { buildAccountPrioritySchedulePlan: plan } = helpers();
  const items = [
    {id:'z',account:'A',status:'trading',tradeDate:'2026-08-24',createdAt:2},
    {id:'a',account:'A',status:'trading',tradeDate:'2026-08-24',createdAt:1},
    {id:'b',account:'A',status:'trading',tradeDate:'2026-08-25',createdAt:1},
    {id:'x',account:'B',status:'trading',tradeDate:'2026-08-24'}
  ];
  const before = structuredClone(items); const locks = new Map();
  const a = plan('A',items,locks,'2026-08-24'); const b = plan('B',items,locks,'2026-08-24');
  assert.deepEqual(a.map(x=>x.id), ['a','z','b']);
  assert.equal(new Set(a.map(x=>x.plannedTradeDate)).size, 3);
  assert.equal(b[0].plannedTradeDate, '2026-08-24');
  assert.deepEqual(items,before); assert.equal(locks.size,0);
});

test('actual completion date occupies only actual date, including early completion', () => {
  const { buildAccountPrioritySchedulePlan: plan, getAccountCompletedTaipeiDates } = helpers();
  const late = [{id:'done',account:'A',status:'done',tradeDate:'2026-08-23',completedTaipeiDate:'2026-08-24'},{id:'p',account:'A',status:'trading',tradeDate:'2026-08-24'}];
  assert.deepEqual([...getAccountCompletedTaipeiDates('A',late,new Map())], ['2026-08-24']);
  assert.equal(plan('A',late,new Map(),'2026-08-23')[0].plannedTradeDate,'2026-08-23');
  const early = [{id:'done',account:'A',status:'done',tradeDate:'2026-08-24',completedTaipeiDate:'2026-08-23'},{id:'p',account:'A',status:'trading',tradeDate:'2026-08-25'}];
  assert.equal(plan('A',early,new Map(),'2026-08-23')[0].plannedTradeDate,'2026-08-24');
});

test('temporary override inserts new none trade and models edit priority changes', () => {
  const { buildAccountPrioritySchedulePlan: plan } = helpers();
  const items=[{id:'a',account:'A',status:'trading',tradeDate:'2026-08-24',luckyTrinket:'seller'},{id:'b',account:'A',status:'trading',tradeDate:'2026-08-25',luckyTrinket:'buyer'}];
  assert.deepEqual(plan('A',items,new Map(),'2026-08-24',{itemOverrides:[{id:'c',account:'A',status:'trading',tradeDate:'2026-08-26'}]}).map(x=>x.id),['c','a','b']);
  assert.deepEqual(plan('A',[{...items[0],luckyTrinket:null},{id:'n',account:'A',status:'trading',tradeDate:'2026-08-25'}],new Map(),'2026-08-24').map(x=>x.id),['a','n']);
  assert.deepEqual(plan('A',[{...items[0],luckyTrinket:'seller'},{id:'n',account:'A',status:'trading',tradeDate:'2026-08-25'}],new Map(),'2026-08-24').map(x=>x.id),['n','a']);
});

test('source has one durable listener, atomic completion, backfill and shared repack paths', () => {
  assert.equal((script.match(/onSnapshot\(collection\(db, ["']dailyTradeCompletionLocks["']\)/g)||[]).length,1);
  assert.match(script,/dailyTradeCompletionLockMap/); assert.match(script,/dailyTradeCompletionLockSnapshotReady/);
  const update = script.slice(script.indexOf('window.updateStatus ='), script.indexOf('window.restoreToStock ='));
  assert.match(update,/runTransaction/); assert.match(update,/transaction\.get\(inventoryRef\)/); assert.match(update,/transaction\.get\(dailyLockRef\)/); assert.match(update,/transaction\.set\(dailyLockRef/);
  assert.match(update,/completedAt/); assert.match(update,/completedTaipeiDate/); assert.match(update,/state: 'used'/);
  assert.doesNotMatch(update,/updateDoc\([\s\S]*status: 'done'/);
  assert.match(script,/source: 'legacy-backfill'/); assert.match(script,/source: 'runtime'/);
  assert.doesNotMatch(script,/delete(?:Doc)?\([^\n]*dailyTradeCompletionLocks|transaction\.delete\([^\n]*dailyLock/);
  assert.match(extract('formatCompletedAt'),/Asia\/Taipei/);
  for (const phrase of ['每日交換紀錄同步中，請稍後再試','此帳號今天已完成過交換，無法再次完成','交易已排隊，但優先排程重新整理失敗，請稍後再試']) assert.match(script,new RegExp(phrase));
});

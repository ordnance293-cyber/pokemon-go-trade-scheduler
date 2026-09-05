import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

function extractFunction(name) {
    const start = script.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing ${name}`);
    const bodyStart = script.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < script.length; index += 1) {
        if (script[index] === '{') depth += 1;
        if (script[index] === '}') depth -= 1;
        if (depth === 0) return script.slice(start, index + 1);
    }
    throw new Error(`unterminated ${name}`);
}

function makeHelpers(names, expression) {
    return Function(`${names.map(extractFunction).join(';')}; return ${expression};`)();
}

test('pending priority uses a stable sorted copy without changing dates', () => {
    const sort = makeHelpers(['normalizeLuckyTrinket', 'isLuckyTrinketTaskCompleted', 'tradeNeedsWeeklyChallenge', 'comparePendingTradesForDisplay'],
        'items => [...items].sort(comparePendingTradesForDisplay)');
    const items = [
        { id: 'a', tradeDate: '2026-08-23', luckyTrinket: 'seller' },
        { id: 'b', tradeDate: '2026-08-24' },
        { id: 'c', tradeDate: '2026-08-25', luckyTrinket: 'buyer' },
        { id: 'd', tradeDate: '2026-08-26', luckyTrinket: null }
    ];
    const snapshot = structuredClone(items);
    assert.deepEqual(sort(items).map(item => item.id), ['b', 'd', 'a', 'c']);
    assert.deepEqual(items, snapshot);
    assert.deepEqual(sort(items).map(item => item.tradeDate), ['2026-08-24', '2026-08-26', '2026-08-23', '2026-08-25']);
    assert.match(script, /currentTab === 'trading'[\s\S]*?filtered = \[\.\.\.filtered\]\.sort\(comparePendingTradesForDisplay\)/);
    assert.match(script, /\[\.\.\.groups\[date\]\]\.sort\(comparePendingTradesForDisplay\)\.forEach/);
});

test('weekly challenge weeks run Tuesday through Monday using local dates', () => {
    const helpers = makeHelpers(['parseLocalDateStr', 'formatLocalDateStr', 'getWeeklyChallengeWeekId', 'getWeeklyChallengeWeekRange'],
        '{ getWeeklyChallengeWeekId, getWeeklyChallengeWeekRange }');
    for (const [date, expected] of [['2026-08-17','2026-08-11'],['2026-08-18','2026-08-18'],['2026-08-23','2026-08-18'],['2026-08-24','2026-08-18'],['2026-08-25','2026-08-25']]) {
        assert.equal(helpers.getWeeklyChallengeWeekId(date), expected);
    }
    assert.deepEqual(helpers.getWeeklyChallengeWeekRange('2026-08-18'), { startDate: '2026-08-18', endDate: '2026-08-24' });
});

test('qualification, FIFO grouping, full account identity, completion and carryover are pure', () => {
    const h = makeHelpers(['normalizeLuckyTrinket','tradeNeedsWeeklyChallenge','getWeeklyChallengeCompletionKey','sortWeeklyChallengeTasks','getWeeklyChallengeExactCustomerName','getWeeklyChallengeCustomerKey','groupWeeklyChallengeTasksByCustomer','buildWeeklyChallengeAccountState'],
        '{ tradeNeedsWeeklyChallenge, getWeeklyChallengeCompletionKey, sortWeeklyChallengeTasks, getWeeklyChallengeExactCustomerName, getWeeklyChallengeCustomerKey, groupWeeklyChallengeTasksByCustomer, buildWeeklyChallengeAccountState }');
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'buyer' }), true);
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'seller' }), true);
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'none' }), false);
    assert.equal(h.tradeNeedsWeeklyChallenge({}), false);
    assert.notEqual(h.getWeeklyChallengeCompletionKey('abcdef111111','2026-08-18'), h.getWeeklyChallengeCompletionKey('abcdef222222','2026-08-18'));
    const exactNames = ['Danny Yi','danny yi','DANNY YI',' Danny Yi','Danny Yi ','Danny  Yi','Danny　Yi','Ｄanny Yi'];
    assert.equal(h.getWeeklyChallengeExactCustomerName('Danny Yi'), 'Danny Yi');
    assert.equal(new Set(exactNames.map(h.getWeeklyChallengeExactCustomerName)).size, exactNames.length);
    const exactSource = extractFunction('getWeeklyChallengeExactCustomerName');
    for (const forbidden of [/\.normalize\(/,/\.trim\(/,/\.toLowerCase\(/,/\.toLocaleLowerCase\(/,/\.replace\(\/\\s\+/]) assert.doesNotMatch(exactSource, forbidden);
    assert.notEqual(h.getWeeklyChallengeCustomerKey({account:'A',partner:'Danny Yi',id:'1'}), h.getWeeklyChallengeCustomerKey({account:'B',partner:'Danny Yi',id:'2'}));
    assert.notEqual(h.getWeeklyChallengeCustomerKey({account:'A',partner:'',id:'1'}), h.getWeeklyChallengeCustomerKey({account:'A',partner:'',id:'2'}));
    const tasks = Array.from({ length: 6 }, (_, index) => ({ id: String.fromCharCode(102-index), account: 'abcdef111111', partner: `customer ${index}`, createdAt: index < 2 ? 1 : index }));
    const sorted = h.sortWeeklyChallengeTasks(tasks);
    assert.deepEqual(sorted.slice(0, 2).map(x => x.id), ['e','f']);
    for (const count of [1,2,3,4,6]) {
        const state = h.buildWeeklyChallengeAccountState('abcdef111111', sorted.slice(0,count), '2026-08-18', new Map());
        assert.equal(state.active.length, Math.min(count, 3));
        assert.equal(state.queue.length, Math.max(count - 3, 0));
        assert.equal(state.customerCount, Math.min(count, 3));
        assert.equal(state.peopleCount, Math.min(count, 3) + 1);
        assert.equal(state.missingPeople, Math.max(0, 3 - Math.min(count, 3)));
        assert.equal(state.canComplete, true);
        assert.equal(state.mergeEligible, count >= 1 && count <= 2);
    }
    const completionMap = new Map([[h.getWeeklyChallengeCompletionKey('abcdef111111','2026-08-18'), {}]]);
    const blocked = h.buildWeeklyChallengeAccountState('abcdef111111', tasks, '2026-08-18', completionMap);
    assert.equal(blocked.active.length, 0); assert.equal(blocked.queue.length, 6); assert.equal(blocked.completed, true);
    assert.equal(h.buildWeeklyChallengeAccountState('abcdef111111', tasks, '2026-08-25', completionMap).active.length, 3);
});

test('weekly participants group only same-account exact-name tasks and queue by customer FIFO', () => {
    const h = makeHelpers(['getWeeklyChallengeCompletionKey','sortWeeklyChallengeTasks','getWeeklyChallengeExactCustomerName','getWeeklyChallengeCustomerKey','groupWeeklyChallengeTasksByCustomer','buildWeeklyChallengeAccountState'],
        '{ getWeeklyChallengeCustomerKey, groupWeeklyChallengeTasksByCustomer, buildWeeklyChallengeAccountState }');
    const task = (id, partner, createdAt, account='A') => ({id, account, partner, createdAt, pokemonLabel:id});
    const danny = [task('d1','Danny Yi',1), task('d2','Danny Yi',3), task('d3','Danny Yi',4)];
    let state = h.buildWeeklyChallengeAccountState('A', danny, 'week', new Map());
    assert.equal(state.customerCount, 1); assert.equal(state.peopleCount, 2); assert.equal(state.missingPeople, 2); assert.equal(state.mergeEligible, true);
    assert.deepEqual(state.activeCustomers[0].taskIds, ['d1','d2','d3']);
    state = h.buildWeeklyChallengeAccountState('A', [...danny,task('a1','Alice',2),task('b1','Bob',5),task('b2','Bob',6),task('c1','Carol',7)], 'week', new Map());
    assert.equal(state.customerCount, 3); assert.equal(state.peopleCount, 4); assert.equal(state.isFull, true);
    assert.deepEqual(state.activeCustomers.map(c=>c.partner), ['Danny Yi','Alice','Bob']);
    assert.deepEqual(state.queuedCustomers.map(c=>c.partner), ['Carol']);
    assert.deepEqual(h.groupWeeklyChallengeTasksByCustomer([task('d1','Danny',1),task('a','Alice',2),task('d2','Danny',3)]).map(c=>c.partner), ['Danny','Alice']);
    for (const different of ['danny yi','Danny  Yi','Danny Yi ','Ｄanny Yi']) {
        const distinct = h.buildWeeklyChallengeAccountState('A',[task('x','Danny Yi',1),task('y',different,2)],'week',new Map());
        assert.equal(distinct.customerCount,2); assert.equal(distinct.peopleCount,3); assert.equal(distinct.mergeEligible,true);
    }
    const keys=[h.getWeeklyChallengeCustomerKey(task('a','Danny Yi',1)),h.getWeeklyChallengeCustomerKey(task('b','Danny Yi',2,'B'))]; assert.notEqual(keys[0],keys[1]);
});

test('exact customer expansion excludes differently cased and spaced names', () => {
    const h = makeHelpers(['sortWeeklyChallengeTasks','getWeeklyChallengeExactCustomerName','getWeeklyChallengeCustomerKey','expandWeeklyChallengeCustomerTasks'],
        '{ getWeeklyChallengeCustomerKey, expandWeeklyChallengeCustomerTasks }');
    const tasks=[{id:'a',account:'A',partner:'Danny Yi'},{id:'b',account:'A',partner:'Danny Yi'},{id:'c',account:'A',partner:'danny yi'}];
    assert.deepEqual(h.expandWeeklyChallengeCustomerTasks([h.getWeeklyChallengeCustomerKey(tasks[0])],tasks).map(task=>task.id),['a','b']);
});

test('partner input validation preserves the exact raw value for arrange and edit', () => {
    assert.match(script, /const rawPartner = document\.getElementById\('partnerInput'\)\.value;[\s\S]*?if \(!rawPartner\.trim\(\)\)[\s\S]*?const partner = rawPartner;/);
    assert.match(script, /const rawPartner = editTradePartnerInput\.value;[\s\S]*?if \(!rawPartner\.trim\(\)\)[\s\S]*?const partner = rawPartner;/);
});

test('persistent collections, one listener each, lifecycle transactions and backfill exist', () => {
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeTasks"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeCompletions"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(collection\(db, "luckyTrinketCycleLocks"\)/g) || []).length, 1);
    assert.match(script, /function getLegacyWeeklyChallengeTaskId/);
    assert.match(script, /source: 'legacy-trading-backfill'/);
    assert.match(script, /status !== 'trading'/);
    const completionSource = extractFunction('completeWeeklyChallengeGroup');
    assert.match(completionSource, /customerCount/);
    assert.match(completionSource, /runTransaction/);
    assert.match(extractFunction('getWeeklyChallengeCompletionRef'), /weeklyChallengeCompletions/);
    assert.match(script, /weeklyChallengeCompletedWeekId[\s\S]*?weeklyChallengeCompletedAt/);
    assert.match(script, /current\.status === 'trading'[\s\S]*?weeklyChallengeTaskId[\s\S]*?transaction\.delete\(taskRef\)/);
});

test('weekly challenge utility UI and refresh controls exist', () => {
    for (const id of ['openWeeklyChallengeBtn','weeklyChallengeModal','weeklyChallengeWeekLabel','weeklyChallengeSummary','weeklyChallengeAccountList','closeWeeklyChallengeModalBtn']) {
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
    }
    assert.match(script, /2\/4｜缺2人/);
    assert.match(script, /3\/4｜缺1人/);
    assert.match(script, /4\/4｜人數已滿/);
    assert.match(script, /等待下週二/);
    assert.match(script, /我出首飾/);
    assert.match(script, /他出首飾/);
    assert.match(script, /visibilitychange/);
    assert.match(script, /window\.addEventListener\('focus'/);
    assert.match(script, /createWeeklyChallengeCustomerRow/);
    assert.match(script, /customer\.tasks/);
});

test('weekly challenge uses a persistent two-step started workflow', () => {
    assert.match(script, /weeklyChallengeStartedSessions/);
    assert.match(script, /weeklyChallengeStartedMemberships/);
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeStartedSessions"\)/g) || []).length, 1);
    assert.match(script, /function getWeeklyChallengeStartedMembershipKey/);
    assert.match(script, /async function startWeeklyChallengeGroup/);
    assert.match(script, /async function cancelWeeklyChallengeStart/);
    assert.match(script, /開始解週間/);
    assert.match(script, /本週週間已完成/);
    assert.match(script, /🟦 解題中/);
    assert.doesNotMatch(script, /直接完成週間/);
    assert.match(extractFunction('completeWeeklyChallengeGroup'), /請先按「開始解週間」/);
});

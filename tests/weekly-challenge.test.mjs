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
    const sort = makeHelpers(['normalizeLuckyTrinket', 'tradeNeedsWeeklyChallenge', 'comparePendingTradesForDisplay'],
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
    const h = makeHelpers(['normalizeLuckyTrinket','tradeNeedsWeeklyChallenge','getWeeklyChallengeCompletionKey','sortWeeklyChallengeTasks','buildWeeklyChallengeAccountState'],
        '{ tradeNeedsWeeklyChallenge, getWeeklyChallengeCompletionKey, sortWeeklyChallengeTasks, buildWeeklyChallengeAccountState }');
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'buyer' }), true);
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'seller' }), true);
    assert.equal(h.tradeNeedsWeeklyChallenge({ luckyTrinket: 'none' }), false);
    assert.equal(h.tradeNeedsWeeklyChallenge({}), false);
    assert.notEqual(h.getWeeklyChallengeCompletionKey('abcdef111111','2026-08-18'), h.getWeeklyChallengeCompletionKey('abcdef222222','2026-08-18'));
    const tasks = Array.from({ length: 6 }, (_, index) => ({ id: String.fromCharCode(102-index), account: 'abcdef111111', createdAt: index < 2 ? 1 : index }));
    const sorted = h.sortWeeklyChallengeTasks(tasks);
    assert.deepEqual(sorted.slice(0, 2).map(x => x.id), ['e','f']);
    for (const count of [1,2,3,4,6]) {
        const state = h.buildWeeklyChallengeAccountState('abcdef111111', sorted.slice(0,count), '2026-08-18', new Map());
        assert.equal(state.active.length, Math.min(count, 3));
        assert.equal(state.queue.length, Math.max(count - 3, 0));
        assert.equal(state.ready, count >= 3);
    }
    const completionMap = new Map([[h.getWeeklyChallengeCompletionKey('abcdef111111','2026-08-18'), {}]]);
    const blocked = h.buildWeeklyChallengeAccountState('abcdef111111', tasks, '2026-08-18', completionMap);
    assert.equal(blocked.active.length, 0); assert.equal(blocked.queue.length, 6); assert.equal(blocked.completed, true);
    assert.equal(h.buildWeeklyChallengeAccountState('abcdef111111', tasks, '2026-08-25', completionMap).active.length, 3);
});

test('persistent collections, one listener each, lifecycle transactions and backfill exist', () => {
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeTasks"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeCompletions"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(collection\(db, "luckyTrinketCycleLocks"\)/g) || []).length, 1);
    assert.match(script, /function getLegacyWeeklyChallengeTaskId/);
    assert.match(script, /source: 'legacy-trading-backfill'/);
    assert.match(script, /status !== 'trading'/);
    const completionSource = extractFunction('completeWeeklyChallengeGroup');
    assert.match(completionSource, /taskIds\.length !== 3/);
    assert.match(completionSource, /runTransaction/);
    assert.match(extractFunction('getWeeklyChallengeCompletionRef'), /weeklyChallengeCompletions/);
    assert.match(script, /weeklyChallengeCompletedWeekId[\s\S]*?weeklyChallengeCompletedAt/);
    assert.match(script, /current\.status === 'trading'[\s\S]*?weeklyChallengeTaskId[\s\S]*?transaction\.delete\(taskRef\)/);
});

test('weekly challenge utility UI and refresh controls exist', () => {
    for (const id of ['openWeeklyChallengeBtn','weeklyChallengeModal','weeklyChallengeWeekLabel','weeklyChallengeSummary','weeklyChallengeAccountList','closeWeeklyChallengeModalBtn']) {
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
    }
    assert.match(script, /本組週間完成/);
    assert.match(script, /還差\$\{3 - state\.active\.length\}人/);
    assert.match(script, /等待下週二/);
    assert.match(script, /我出首飾/);
    assert.match(script, /他出首飾/);
    assert.match(script, /visibilitychange/);
    assert.match(script, /window\.addEventListener\('focus'/);
});

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

function getHelpers() {
    return Function(`${extractFunction('getScheduledAtValue')};${extractFunction('compareTradingItemsByScheduledAt')}; return { getScheduledAtValue, compareTradingItemsByScheduledAt };`)();
}

test('trading sorter has the exact choices and schedule default', () => {
    const select = html.match(/<select id="tradingSortSelect"[\s\S]*?<\/select>/)?.[0] || '';
    assert.ok(select, 'missing tradingSortSelect');
    assert.deepEqual([...select.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)].map(match => [match[1], match[3]]), [
        ['schedule', '排程順序'], ['desc', '最新排隊'], ['asc', '最早排隊']
    ]);
    assert.match(select, /<option value="schedule"(?: selected)?>排程順序<\/option>/);
    assert.doesNotMatch(select, /<option value="(?:desc|asc)" selected>/);
});

test('tab switching shows only the sorter for the active sortable tab', () => {
    assert.match(script, /doneSortSelect\.classList\.toggle\(\s*'hidden',\s*currentTab !== 'done'\s*\)/);
    assert.match(script, /tradingSortSelect\.classList\.toggle\(\s*'hidden',\s*currentTab !== 'trading'\s*\)/);
});

test('scheduledAt validation accepts only positive finite numbers', () => {
    const { getScheduledAtValue } = getHelpers();
    assert.equal(getScheduledAtValue({ scheduledAt: 123 }), 123);
    for (const item of [{ scheduledAt: 0 }, { scheduledAt: -1 }, {}, { scheduledAt: '123' }]) assert.equal(getScheduledAtValue(item), null);
});

test('scheduled sorting supports both directions and leaves inputs untouched', () => {
    const { compareTradingItemsByScheduledAt: compare } = getHelpers();
    const items = [{ id: 'A', scheduledAt: 300 }, { id: 'B', scheduledAt: 100 }, { id: 'C', scheduledAt: 200 }];
    const snapshot = structuredClone(items);
    assert.deepEqual([...items].sort((a, b) => compare(a, b, 'desc')).map(item => item.id), ['A', 'C', 'B']);
    assert.deepEqual([...items].sort((a, b) => compare(a, b, 'asc')).map(item => item.id), ['B', 'C', 'A']);
    assert.deepEqual(items, snapshot);
});

test('valid timestamps precede legacy records and legacy fallback is deterministic', () => {
    const { compareTradingItemsByScheduledAt: compare } = getHelpers();
    const mixed = [{ id: 'A', scheduledAt: 100 }, { id: 'B' }, { id: 'C', scheduledAt: 200 }];
    assert.deepEqual([...mixed].sort((a, b) => compare(a, b, 'desc')).map(x => x.id), ['C', 'A', 'B']);
    assert.deepEqual([...mixed].sort((a, b) => compare(a, b, 'asc')).map(x => x.id), ['A', 'C', 'B']);
    const legacy = [
        { id: 'a', tradeDate: '2026-08-24', createdAt: 100 },
        { id: 'b', tradeDate: '2026-08-23', createdAt: 200 },
        { id: 'd', tradeDate: '2026-08-25', createdAt: 2 },
        { id: 'c', tradeDate: '2026-08-25', createdAt: 1 },
        { id: 'e', tradeDate: '2026-08-25', createdAt: 2 }
    ];
    assert.deepEqual([...legacy].sort((a, b) => compare(a, b, 'desc')).map(x => x.id), ['b', 'a', 'c', 'd', 'e']);
});

test('render sorts a copy using schedule or scheduledAt mode and reacts immediately', () => {
    assert.match(script, /currentTab === 'trading'[\s\S]*?tradingSortSelect\.value[\s\S]*?mode === 'schedule'[\s\S]*?\[\.\.\.filtered\]\.sort\(comparePendingTradesForDisplay\)[\s\S]*?\[\.\.\.filtered\]\.sort\(\(a, b\) =>\s*compareTradingItemsByScheduledAt\(a, b, mode\)\s*\)/);
    assert.match(script, /tradingSortSelect\.addEventListener\('change', render\)/);
});

test('all three new arrange paths write scheduledAt with trading status', () => {
    const arrange = script.match(/document\.getElementById\('confirmTradeBtn'\)\.addEventListener[\s\S]*?const scheduledOverride/)?.[0] || '';
    assert.equal((arrange.match(/const now = Date\.now\(\)/g) || []).length, 3);
    assert.equal((arrange.match(/transaction\.update\(inventoryRef, \{ status: 'trading',[^}]*scheduledAt: now[^}]*\}\)/g) || []).length, 3);
    assert.match(arrange, /luckyTrinketCycleId: cycle\.id[^}]*weeklyChallengeTaskId: exemptionSnapshot\.exists\(\) \? deleteField\(\) : taskRef\.id/);
});

test('editing, maintenance, and completion do not rewrite scheduledAt', () => {
    const editStart = script.indexOf('async function updateLuckyTrinketTrade');
    const editEnd = script.indexOf('function render()', editStart);
    assert.doesNotMatch(script.slice(editStart, editEnd), /scheduledAt/);
    assert.equal((script.match(/scheduledAt: now/g) || []).length, 3, 'scheduledAt writes must be limited to the three arrange paths');
});

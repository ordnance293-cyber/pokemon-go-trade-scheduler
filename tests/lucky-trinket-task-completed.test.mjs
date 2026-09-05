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

function getPriorityHelpers() {
    return Function(`${extractFunction('normalizeLuckyTrinket')};${extractFunction('isLuckyTrinketTaskCompleted')};${extractFunction('tradeNeedsWeeklyChallenge')};${extractFunction('comparePendingTradesForDisplay')}; return { isLuckyTrinketTaskCompleted, comparePendingTradesForDisplay };`)();
}

test('completed seller is the highest pending priority and stale booleans are safe', () => {
    const { isLuckyTrinketTaskCompleted, comparePendingTradesForDisplay: compare } = getPriorityHelpers();
    const items = [
        { id: 'unfinished', luckyTrinket: 'seller', luckyTrinketTaskCompleted: false },
        { id: 'buyer-stale', luckyTrinket: 'buyer', luckyTrinketTaskCompleted: true },
        { id: 'normal' },
        { id: 'legacy-seller', luckyTrinket: 'seller' },
        { id: 'completed', luckyTrinket: 'seller', luckyTrinketTaskCompleted: true }
    ];
    const snapshot = structuredClone(items);
    assert.equal(isLuckyTrinketTaskCompleted(items[4]), true);
    for (const item of items.slice(0, 4)) assert.equal(isLuckyTrinketTaskCompleted(item), false);
    assert.deepEqual([...items].sort(compare).map(item => item.id), ['completed', 'normal', 'unfinished', 'buyer-stale', 'legacy-seller']);
    assert.deepEqual(items, snapshot, 'display sorting must not rewrite trade fields');
});

test('arrange and edit controls expose task completion only for seller', () => {
    for (const id of ['luckyTrinketTaskCompletedField', 'luckyTrinketTaskCompletedSelect', 'editLuckyTrinketTaskCompletedField', 'editLuckyTrinketTaskCompletedSelect']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.equal((html.match(/<option value="false" selected>❌ 任務未完成<\/option>/g) || []).length, 2);
    assert.equal((html.match(/<option value="true">✅ 任務已完成<\/option>/g) || []).length, 2);
    assert.match(extractFunction('setLuckyTrinketSelection'), /classList\.toggle\('hidden', selectedLuckyTrinket !== 'seller'\)/);
    assert.match(extractFunction('setEditingLuckyTrinketSelection'), /classList\.toggle\('hidden', editingLuckyTrinket !== 'seller'\)/);
    assert.match(script, /selectedLuckyTrinketTaskCompleted = false/);
    assert.match(script, /editingLuckyTrinketTaskCompleted = isLuckyTrinketTaskCompleted\(item\)/);
});

test('persistence writes seller status and removes it from buyer or normal trades', () => {
    assert.match(script, /luckyTrinket: 'seller'[\s\S]*?luckyTrinketTaskCompleted: selectedLuckyTrinketTaskCompleted/);
    assert.ok((script.match(/luckyTrinketTaskCompleted: deleteField\(\)/g) || []).length >= 2);
    assert.match(extractFunction('updateLuckyTrinketTrade'), /luckyTrinketTaskCompleted: willBeSeller \? editingLuckyTrinketTaskCompleted : deleteField\(\)/);
});

test('completed seller badge is guarded and both pending views use the shared comparator', () => {
    assert.ok((script.match(/✅ 首飾任務完成｜優先交換/g) || []).length >= 2);
    assert.match(script, /isLuckyTrinketTaskCompleted\(p\)/);
    assert.match(script, /\[\.\.\.groups\[date\]\]\.sort\(comparePendingTradesForDisplay\)/);
    assert.match(script, /filtered = \[\.\.\.filtered\]\.sort\(comparePendingTradesForDisplay\)/);
});

test('feature does not rewrite tradeDate or scheduledAt while editing', () => {
    const edit = extractFunction('updateLuckyTrinketTrade');
    assert.doesNotMatch(edit, /tradeDate\s*:/);
    assert.doesNotMatch(edit, /scheduledAt\s*:/);
});

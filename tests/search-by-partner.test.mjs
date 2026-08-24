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

function getSearchMatcher() {
    return Function(`${extractFunction('inventoryItemMatchesSearch')}; return inventoryItemMatchesSearch;`)();
}

test('search input uses the Pokémon and customer placeholder', () => {
    const input = html.match(/<input[^>]*id="searchInput"[^>]*>/)?.[0] || '';
    assert.match(input, /placeholder="搜尋寶可夢／客人名稱\.\.\."/);
});

test('search matches a Pokémon name', () => {
    assert.equal(getSearchMatcher()({ name: '蓋歐卡', partner: 'Danny Yi' }, '蓋歐'), true);
});

test('search matches a partner name', () => {
    assert.equal(getSearchMatcher()({ name: '蓋歐卡', partner: 'Danny Yi' }, 'Danny'), true);
});

test('partner matching is case-insensitive', () => {
    assert.equal(getSearchMatcher()({ name: '蓋歐卡', partner: 'Danny Yi' }, 'dAnNy'), true);
});

test('partner matching supports partial names', () => {
    assert.equal(getSearchMatcher()({ name: '蓋歐卡', partner: 'Danny Yi' }, 'Yi'), true);
});

test('search rejects an unrelated term', () => {
    assert.equal(getSearchMatcher()({ name: '蓋歐卡', partner: 'Danny Yi' }, '皮卡丘'), false);
});

test('search safely handles a missing partner', () => {
    const matches = getSearchMatcher();
    assert.equal(matches({ name: '蓋歐卡' }, '蓋歐'), true);
    assert.equal(matches({ name: '蓋歐卡' }, 'Danny'), false);
});

test('search safely handles a missing Pokémon name', () => {
    assert.equal(getSearchMatcher()({ partner: 'Danny Yi' }, 'danny'), true);
});

test('empty and whitespace-only searches match every item', () => {
    const matches = getSearchMatcher();
    assert.equal(matches({ name: '蓋歐卡', partner: 'Danny Yi' }, ''), true);
    assert.equal(matches({ name: '蓋歐卡', partner: 'Danny Yi' }, '   '), true);
});

test('render uses the shared matcher instead of a name-only condition', () => {
    const render = extractFunction('render');
    assert.match(render, /inventoryItemMatchesSearch\(p,\s*searchText\)/);
    assert.doesNotMatch(render, /String\(p\.name \|\| ''\)\.toLowerCase\(\)\.includes\(searchText\)/);
});

test('trading filtering precedes every selected trading sort without resetting it', () => {
    const render = extractFunction('render');
    const filterAt = render.indexOf('pokemons.filter');
    const tradingAt = render.indexOf("currentTab === 'trading'");
    assert.ok(filterAt >= 0 && tradingAt > filterAt);
    assert.match(render.slice(tradingAt), /tradingSortSelect\.value[\s\S]*?mode === 'schedule'[\s\S]*?comparePendingTradesForDisplay[\s\S]*?compareTradingItemsByScheduledAt\(a, b, mode\)/);
    assert.doesNotMatch(render, /tradingSortSelect\.value\s*=/);
});

test('done filtering precedes selected done sorting without resetting it', () => {
    const render = extractFunction('render');
    const filterAt = render.indexOf('pokemons.filter');
    const doneAt = render.indexOf("currentTab === 'done'");
    assert.ok(filterAt >= 0 && doneAt > filterAt);
    assert.match(render.slice(doneAt), /compareDoneItems\(a, b, doneSortSelect\.value\)/);
    assert.doesNotMatch(render, /doneSortSelect\.value\s*=/);
});

test('search matcher is pure and introduces no Firestore behavior', () => {
    const helper = extractFunction('inventoryItemMatchesSearch');
    assert.doesNotMatch(helper, /\b(?:addDoc|setDoc|updateDoc|deleteDoc|runTransaction|onSnapshot|collection|doc)\s*\(/);
});

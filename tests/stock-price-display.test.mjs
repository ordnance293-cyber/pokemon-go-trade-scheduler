import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${root}/index.html`, 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

function source(name) {
    const start = script.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} helper should exist`);
    const brace = script.indexOf('{', start);
    let depth = 1;
    let end = brace + 1;
    while (depth && end < script.length) {
        if (script[end] === '{') depth++;
        if (script[end] === '}') depth--;
        end++;
    }
    return script.slice(start, end);
}

function helpers() {
    const names = ['normalizeColorType', 'normalizeBackCardType', 'getInventoryGroupingKey',
        'isValidStockCopyPrice', 'getStockItemSavedPrice', 'getStockItemPriceLabel'];
    return vm.runInNewContext(`(() => { ${names.map(source).join('\n')}; return {${names.join(',')}} })()`);
}

const item = (overrides = {}) => ({
    account: 'account-A', colorType: 'shiny', backCardType: 'special', name: '蓋歐卡', ...overrides
});

test('stock helper returns a saved price and the exact display label', () => {
    const { getInventoryGroupingKey, getStockItemSavedPrice, getStockItemPriceLabel } = helpers();
    const pokemon = item();
    const prices = new Map([[getInventoryGroupingKey(pokemon), 450]]);
    assert.equal(getStockItemSavedPrice(pokemon, prices), 450);
    assert.equal(getStockItemPriceLabel(pokemon, prices), '💰 450元');
});

test('missing and invalid cached prices produce the exact warning', () => {
    const { getInventoryGroupingKey, getStockItemSavedPrice, getStockItemPriceLabel } = helpers();
    const pokemon = item();
    assert.equal(getStockItemSavedPrice(pokemon, new Map()), undefined);
    assert.equal(getStockItemPriceLabel(pokemon, new Map()), '💰 未設定價格');
    for (const invalid of [0, -1, null, undefined, '450']) {
        const prices = new Map([[getInventoryGroupingKey(pokemon), invalid]]);
        assert.equal(getStockItemSavedPrice(pokemon, prices), undefined);
        assert.equal(getStockItemPriceLabel(pokemon, prices), '💰 未設定價格');
    }
});

test('lookup uses full account identity and ignores quantity', () => {
    const { getInventoryGroupingKey, getStockItemSavedPrice } = helpers();
    const accountA = item({ name: '固拉多', account: 'account-A', quantity: 1 });
    const accountB = item({ name: '固拉多', account: 'account-B', quantity: 7 });
    const prices = new Map([[getInventoryGroupingKey(accountA), 350], [getInventoryGroupingKey(accountB), 400]]);
    assert.equal(getStockItemSavedPrice(accountA, prices), 350);
    assert.equal(getStockItemSavedPrice(accountB, prices), 400);
    assert.equal(getStockItemSavedPrice({ ...accountA, quantity: 99 }, prices), 350);
});

test('edited identity does not reuse an unrelated saved price', () => {
    const { getInventoryGroupingKey, getStockItemSavedPrice } = helpers();
    const original = item({ name: '固拉多' });
    const prices = new Map([[getInventoryGroupingKey(original), 450]]);
    for (const changed of [
        { name: '蓋歐卡' }, { account: 'account-B' }, { colorType: 'normal' }, { backCardType: 'costume' }
    ]) assert.equal(getStockItemSavedPrice({ ...original, ...changed }, prices), undefined);
});

test('render adds exact price markup only for status stock, including all-tab results', () => {
    const render = source('render');
    const label = source('getStockItemPriceLabel');
    assert.match(render, /p\.status === 'stock'[\s\S]*getStockItemSavedPrice\(p, stockCopyPriceMap\)/);
    assert.match(label, /`💰 \$\{price\}元`/);
    assert.match(label, /'💰 未設定價格'/);
    assert.match(render, /\$\{priceLabel\}/);
    assert.doesNotMatch(render, /currentTab === 'stock'[\s\S]{0,120}getStockItemSavedPrice/);
});

test('the single existing listener refreshes stock and all cards', () => {
    assert.equal((script.match(/onSnapshot\(collection\(db, ["']stockCopyPrices["']/g) || []).length, 1);
    const listener = script.slice(script.indexOf('onSnapshot(collection(db, "stockCopyPrices")'), script.indexOf('function renderTimeline'));
    assert.match(listener, /currentTab === 'stock' \|\| currentTab === 'all'/);
    assert.match(listener, /render\(\)/);
});

test('successful local price save immediately refreshes stock and all cards', () => {
    const save = script.slice(script.indexOf("document.getElementById('applyCopyPricesBtn').addEventListener"), script.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.match(save, /stockCopyPriceMap\.set\([\s\S]*currentTab === 'stock' \|\| currentTab === 'all'[\s\S]*render\(\)/);
});

test('inventory writes do not gain a price field', () => {
    assert.doesNotMatch(script, /(?:addDoc|setDoc)\(collection\(db, ["']inventory["']\)[\s\S]{0,300}\b(?:price|stockPrice|copyPrice)\s*:/);
});

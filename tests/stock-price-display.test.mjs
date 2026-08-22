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
        'isValidStockCopyPrice', 'getStockItemSavedPrice', 'getStockItemPriceLabel', 'parseSingleStockPrice'];
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

test('single-price modal exposes all dedicated controls', () => {
    for (const id of ['singleStockPriceModal', 'singleStockPriceAccount', 'singleStockPriceProduct',
        'singleStockPriceInput', 'singleStockPriceMessage', 'cancelSingleStockPriceBtn', 'saveSingleStockPriceBtn']) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /id="singleStockPriceModal"[^>]*class="[^"]*hidden/);
    assert.match(html, /id="singleStockPriceInput"[^>]*inputmode="numeric"/);
});

test('the existing saved and missing price badge is one clickable stock-only editor path', () => {
    const render = source('render');
    assert.match(render, /p\.status === 'stock'[\s\S]*stockPriceMarkup = `<button/);
    assert.match(render, /type="button"[^>]*onclick="openSingleStockPriceEditor\('\$\{p\.id\}'\)"/);
    assert.match(render, /\$\{priceLabel\}/);
    assert.doesNotMatch(render, />改價</);
});

test('single parser accepts exactly one positive integer', () => {
    const { parseSingleStockPrice } = helpers();
    assert.equal(parseSingleStockPrice('250'), 250);
    for (const invalid of ['', '0', '-5', '250.5', 'abc', '250 300', '250,300']) {
        assert.equal(parseSingleStockPrice(invalid), null);
    }
});

test('single editor resolves current stock and displays shared identity information', () => {
    const start = script.indexOf('window.openSingleStockPriceEditor');
    const open = script.slice(start, script.indexOf("document.getElementById('cancelSingleStockPriceBtn')", start));
    assert.match(open, /pokemons\.find\(p => p\.id === id\)/);
    assert.match(open, /item\.status !== 'stock'/);
    assert.match(open, /getInventoryGroupingKey\(item\)/);
    assert.match(open, /stockCopyPriceMap\.get\(priceKey\)/);
    assert.match(open, /isValidStockCopyPrice\(currentPrice\)[\s\S]*String\(currentPrice\)[\s\S]*: ''/);
    assert.match(open, /getLuckyTrinketAccountDisplayName\(item\.account\)/);
    assert.match(open, /formatInventoryCopyText\(item\)/);
});

test('single save revalidates identity and performs one deterministic price write', () => {
    const start = script.indexOf("document.getElementById('saveSingleStockPriceBtn').addEventListener");
    const save = script.slice(start, script.indexOf("document.getElementById('generateCopyBtn')", start));
    assert.match(save, /pokemons\.find\(p => p\.id === editingStockPriceItemId\)/);
    assert.match(save, /item\.status !== 'stock'/);
    assert.match(save, /getInventoryGroupingKey\(item\) !== editingStockPriceKey/);
    assert.match(save, /商品資料已變更，請重新開啟改價/);
    assert.match(save, /doc\(db, "stockCopyPrices", encodeURIComponent\(priceKey\)\)/);
    for (const field of ['priceKey', 'account', 'name', 'colorType', 'backCardType', 'price', 'updatedAt']) {
        assert.match(save, new RegExp(`\\b${field}\\b`));
    }
    assert.doesNotMatch(save, /doc\(db, ["']inventory["']/);
    const write = save.indexOf('await setDoc');
    const cache = save.indexOf('stockCopyPriceMap.set(priceKey, price)');
    assert.ok(write >= 0 && cache > write, 'cache update must follow the successful Firestore write');
    assert.match(save, /currentTab === 'stock' \|\| currentTab === 'all'[\s\S]*render\(\)/);
    assert.match(save, /copyModal[\s\S]*classList\.contains\('hidden'\)[\s\S]*refreshStockCopyPriceUi\(\)/);
    assert.doesNotMatch(save, /deleteDoc/);
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

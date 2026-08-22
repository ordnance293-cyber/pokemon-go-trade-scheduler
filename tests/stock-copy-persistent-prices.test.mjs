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
    const names = ['normalizeColorType', 'normalizeBackCardType', 'getInventoryGroupingKey', 'parseCopyPrices', 'isValidStockCopyPrice',
        'getSavedCopyPrices', 'getMissingCopyPriceTargets', 'getCopyPriceBatchResult',
        'getAllCopyPriceEditState', 'buildStockCopyLines', 'getLuckyTrinketCycleForDate', 'getLuckyTrinketCycleLockKey', 'isActiveLuckyTrinketCycleLock', 'timestampToLocalDate', 'isLegacySellerRecordRelevantToCycle', 'normalizeLuckyTrinket',
        'accountHasLuckyTrinket', 'getLuckyTrinketAccountDisplayName', 'buildStockCopyAccountHeader'];
    return vm.runInNewContext(`(() => { const LUCKY_TRINKET_CYCLES=[{id:'2026-08-go-pass',startDate:'2026-08-04',endDate:'2026-09-08'}]; const LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID='2026-08-go-pass'; const luckyTrinketCycleLockMap=new Map(); const getTodayStr=()=> '2026-08-23'; ${names.map(source).join('\n')}; return {${names.join(',')}} })()`);
}

const group = (account, name, quantity = 1) => ({
    priceKey: JSON.stringify([account, 'shiny', 'special', name]), account, name,
    colorType: 'shiny', backCardType: 'special', label: `異色特別背卡${name}`, quantity
});

test('price identity uses full account and excludes quantity', () => {
    const { getInventoryGroupingKey } = helpers();
    const base = { colorType: 'shiny', backCardType: 'special', name: '噴火龍' };
    assert.notEqual(getInventoryGroupingKey({ ...base, account: 'abcdef111' }), getInventoryGroupingKey({ ...base, account: 'abcdef222' }));
    assert.equal(getInventoryGroupingKey({ ...base, account: 'A', quantity: 1 }), getInventoryGroupingKey({ ...base, account: 'A', quantity: 5 }));
});

test('saved lookup supports partial prices and independent accounts', () => {
    const { getSavedCopyPrices, buildStockCopyLines } = helpers();
    const groups = [group('account-A', '噴火龍'), group('account-B', '噴火龍'), group('account-C', '夢幻')];
    const prices = getSavedCopyPrices(groups, new Map([[groups[0].priceKey, 350], [groups[2].priceKey, 450]]));
    assert.deepEqual(Array.from(prices), [350, undefined, 450]);
    const output = buildStockCopyLines(groups, prices);
    assert.match(output, /噴火龍｜1隻350元/);
    assert.match(output, /夢幻｜1隻450元/);
    assert.doesNotMatch(output, /undefined|null|1隻0元/);
    assert.deepEqual(Array.from(getSavedCopyPrices(groups.slice(0, 2), new Map([[groups[0].priceKey, 350], [groups[1].priceKey, 400]]))), [350, 400]);
});

test('missing-price batches map any positive number of prices to the first displayed targets', () => {
    const { getMissingCopyPriceTargets, getCopyPriceBatchResult } = helpers();
    const groups = ['A', 'B', 'C', 'D', 'E'].map(name => group(name, name));
    const targets = getMissingCopyPriceTargets(groups, new Map());
    assert.deepEqual(Array.from(targets, x => x.account), ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(Array.from(getCopyPriceBatchResult(targets, '100 200').entries, entry => [entry.group.account, entry.price]), [
        ['A', 100], ['B', 200]
    ]);
    assert.deepEqual(Array.from(getCopyPriceBatchResult(targets, '500').entries, entry => [entry.group.account, entry.price]), [['A', 500]]);
    assert.equal(getCopyPriceBatchResult(targets, '100 200 300 400 500').entries.length, 5);
});

test('missing-price batches reject empty, malformed, and excess input without entries', () => {
    const { getCopyPriceBatchResult } = helpers();
    const targets = ['A', 'B', 'C', 'D', 'E'].map(name => group(name, name));
    assert.deepEqual({ ...getCopyPriceBatchResult(targets, '') }, { ok: false, message: '請至少輸入 1 個價格' });
    assert.deepEqual({ ...getCopyPriceBatchResult(targets, '1 2 3 4 5 6') }, { ok: false, message: '尚未設定價格只有 5 項，目前輸入 6 個' });
    const malformed = getCopyPriceBatchResult(targets, '100 nope 200');
    assert.equal(malformed.ok, false);
    assert.equal('entries' in malformed, false);
});

test('partial batches produce only submitted writes and leave saved and remaining targets untouched', () => {
    const { getMissingCopyPriceTargets, getCopyPriceBatchResult } = helpers();
    const groups = ['A', 'B', 'C', 'D', 'E'].map(name => group(name, name));
    const prices = new Map([[groups[2].priceKey, 999]]);
    const targets = getMissingCopyPriceTargets(groups, prices);
    const firstBatch = getCopyPriceBatchResult(targets, '100 200');
    assert.equal(firstBatch.entries.length, 2, 'Firestore batch should receive exactly two writes');
    firstBatch.entries.forEach(entry => prices.set(entry.group.priceKey, entry.price));
    assert.equal(prices.get(groups[2].priceKey), 999);
    assert.deepEqual(Array.from(getMissingCopyPriceTargets(groups, prices), x => x.account), ['D', 'E']);
});

test('repeated partial batches recalculate the missing order', () => {
    const { getMissingCopyPriceTargets, getCopyPriceBatchResult } = helpers();
    const groups = ['A', 'B', 'C', 'D'].map(name => group(name, name));
    const prices = new Map();
    for (const entry of getCopyPriceBatchResult(getMissingCopyPriceTargets(groups, prices), '100 200').entries) prices.set(entry.group.priceKey, entry.price);
    for (const entry of getCopyPriceBatchResult(getMissingCopyPriceTargets(groups, prices), '300').entries) prices.set(entry.group.priceKey, entry.price);
    assert.deepEqual(groups.map(group => prices.get(group.priceKey)), [100, 200, 300, undefined]);
    assert.deepEqual(Array.from(getMissingCopyPriceTargets(groups, prices), x => x.account), ['D']);
});

test('partial rendering prices saved products without adding a suffix to missing products', () => {
    const { getSavedCopyPrices, buildStockCopyLines } = helpers();
    const groups = ['A', 'B', 'C'].map(name => group(name, name));
    const output = buildStockCopyLines(groups, getSavedCopyPrices(groups, new Map([[groups[0].priceKey, 100], [groups[1].priceKey, 200]])));
    assert.match(output, /異色特別背卡A｜1隻100元/);
    assert.match(output, /異色特別背卡B｜1隻200元/);
    assert.match(output, /🔥 異色特別背卡C(?:\n|$)/);
});

test('all-price edit mode remains exact-count only', () => {
    const { getCopyPriceBatchResult } = helpers();
    const targets = ['A', 'B', 'C'].map(name => group(name, name));
    assert.deepEqual({ ...getCopyPriceBatchResult(targets, '100 200', true) }, { ok: false, message: '需要 3 個價格，目前只有 2 個' });
    assert.equal(getCopyPriceBatchResult(targets, '100 200 300', true).entries.length, 3);
});

test('new products alone are missing, sold-out cache remains reusable, and quantity shares unit price', () => {
    const { getMissingCopyPriceTargets, getSavedCopyPrices } = helpers();
    const existing = [group('A', '1'), group('A', '2'), group('A', '3'), group('A', '4')];
    const newcomer = group('B', '5', 5);
    const soldOut = group('old', 'gone');
    const cache = new Map(existing.map((g, i) => [g.priceKey, 100 + i]));
    cache.set(soldOut.priceKey, 999);
    assert.deepEqual(Array.from(getMissingCopyPriceTargets([...existing, newcomer], cache), x => x.priceKey), [newcomer.priceKey]);
    assert.deepEqual(Array.from(getSavedCopyPrices([newcomer], cache)), [undefined]);
    assert.deepEqual(Array.from(getSavedCopyPrices([soldOut], cache)), [999]);
    cache.set(newcomer.priceKey, 380);
    assert.deepEqual(Array.from(getSavedCopyPrices([newcomer], cache)), [380]);
});

test('all-price edit preserves displayed group and prefill order', () => {
    const { getAllCopyPriceEditState } = helpers();
    const groups = [group('A', '甲'), group('B', '乙')];
    const state = getAllCopyPriceEditState(groups, new Map([[groups[0].priceKey, 450], [groups[1].priceKey, 350]]));
    assert.deepEqual(Array.from(state.targets), groups);
    assert.equal(state.prefill, '450\n350');
});

test('production wires one realtime collection cache and atomic deterministic writes', () => {
    assert.match(script, /writeBatch/);
    assert.match(script, /onSnapshot\(collection\(db, ["']stockCopyPrices["']\)/);
    assert.match(script, /doc\(db, ["']stockCopyPrices["'], encodeURIComponent\(group\.priceKey\)\)/);
    assert.match(script, /priceKey:\s*group\.priceKey[\s\S]*account:\s*group\.account[\s\S]*price[\s\S]*updatedAt:\s*Date\.now\(\)/);
    assert.doesNotMatch(script, /(?:addDoc|setDoc)\(collection\(db, ["']inventory["']\)[\s\S]{0,300}\b(?:price|stockPrice|copyPrice)\s*:/);
});

test('modal automatically applies cache, exposes missing and all-price batch controls', () => {
    assert.match(html, /id="copyPriceSummary"/);
    assert.match(html, /id="copyPriceTargets"/);
    assert.match(html, /批次儲存價格/);
    assert.match(html, /id="editAllCopyPricesBtn"[^>]*>[\s\S]*批次修改全部價格/);
    const handler = script.slice(script.indexOf("document.getElementById('generateCopyBtn').addEventListener"), script.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.match(source('refreshStockCopyPriceUi'), /getSavedCopyPrices\(currentCopyGroups, stockCopyPriceMap\)/);
    assert.doesNotMatch(handler, /價格已套用/);
});

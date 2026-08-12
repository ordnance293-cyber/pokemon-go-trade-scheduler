import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(moduleScript);

function functionSource(name) {
    const start = moduleScript.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} helper should exist`);
    const brace = moduleScript.indexOf('{', start);
    let depth = 1;
    let end = brace + 1;
    while (depth && end < moduleScript.length) {
        if (moduleScript[end] === '{') depth += 1;
        if (moduleScript[end] === '}') depth -= 1;
        end += 1;
    }
    return moduleScript.slice(start, end);
}

function loadHelpers() {
    const names = ['normalizeInventoryYear', 'normalizeColorType', 'normalizeBackCardType', 'formatInventoryMetadata', 'formatInventoryCopyText', 'getInventoryGroupingKey', 'getStockInventoryCount', 'parseCopyPrices', 'buildStockCopyLines', 'getCopyPriceResult', 'insertPriceSeparator'];
    const source = names.map(functionSource).join('\n');
    return vm.runInNewContext(`(() => { ${source}; return { ${names.join(',')} }; })()`);
}

test('color type is a shiny-default native select with exact options', () => {
    const select = html.match(/<select[^>]*id="colorTypeSelect"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'colorTypeSelect should be a native select');
    assert.deepEqual(
        [...select[1].matchAll(/<option\s+value="([^"]+)"([^>]*)>([^<]+)<\/option>/g)]
            .map(([, value, attributes, label]) => ({ value, label, selected: /\bselected\b/.test(attributes) })),
        [
            { value: 'normal', label: '普色', selected: false },
            { value: 'shiny', label: '異色', selected: true }
        ]
    );
    for (const oldId of ['normalColorBtn', 'shinyColorBtn', 'colorTypeInput']) {
        assert.doesNotMatch(html, new RegExp(oldId));
    }
    assert.doesNotMatch(moduleScript, /setColorType\s*\(/);
});

test('optimistic add reads and normalizes the native color select', () => {
    assert.match(moduleScript, /const colorType = normalizeColorType\(document\.getElementById\('colorTypeSelect'\)\.value\)/);
});

test('color normalization defaults unknown and legacy values to normal', () => {
    const { normalizeColorType } = loadHelpers();
    assert.equal(normalizeColorType('normal'), 'normal');
    assert.equal(normalizeColorType('shiny'), 'shiny');
    assert.equal(normalizeColorType(undefined), 'normal');
    assert.equal(normalizeColorType('unknown'), 'normal');
});

test('metadata includes year, color, then back-card and supports legacy records', () => {
    const { formatInventoryMetadata } = loadHelpers();
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'normal', backCardType: 'none' }), '26年 | 普色');
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'shiny', backCardType: 'special' }), '26年 | 異色 | 特別背卡');
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'shiny', backCardType: 'commemorative' }), '26年 | 異色 | 紀念背卡');
    assert.equal(formatInventoryMetadata({ name: '超夢' }), '普色');
});

test('copy puts shiny after year and before back-card while normal and legacy stay clean', () => {
    const { formatInventoryCopyText } = loadHelpers();
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'normal', backCardType: 'none', name: '烈空坐' }), '26年烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'normal', backCardType: 'special', name: '烈空坐' }), '26年特別背卡烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'none', name: '烈空坐' }), '26年異色烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'special', name: '烈空坐' }), '26年異色特別背卡烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'commemorative', name: '烈空坐' }), '26年異色紀念背卡烈空坐');
    const legacy = formatInventoryCopyText({ name: '超夢' });
    assert.equal(legacy, '超夢');
    assert.doesNotMatch(legacy, /普色|異色|2026|26年|undefined/);
});

test('grouping separates variants and normalizes legacy color to normal', () => {
    const { getInventoryGroupingKey } = loadHelpers();
    const base = { year: 2026, backCardType: 'special', name: '烈空坐' };
    assert.notEqual(getInventoryGroupingKey({ ...base, colorType: 'normal' }), getInventoryGroupingKey({ ...base, colorType: 'shiny' }));
    assert.equal(getInventoryGroupingKey(base), getInventoryGroupingKey({ ...base, colorType: 'normal' }));
});

test('stock count counts individual stock records only', () => {
    const { getStockInventoryCount } = loadHelpers();
    assert.equal(getStockInventoryCount([{ status: 'stock' }, { status: 'stock' }, { status: 'trading' }, { status: 'done' }]), 2);
});

test('copy modal count uses the same effective pokemons snapshot', () => {
    assert.match(html, /id="copyStockCount"/);
    const handler = moduleScript.slice(moduleScript.indexOf("document.getElementById('generateCopyBtn').addEventListener"), moduleScript.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.match(handler, /const stockItems = pokemons\.filter\(p => p\.status === 'stock'\)/);
    assert.doesNotMatch(handler, /syncedPokemons/);
    assert.match(handler, /copyStockCount'\)\.textContent = `總庫存：\$\{getStockInventoryCount\(stockItems\)\} 隻`/);
});

test('stock copy prefixes grouped lines while preserving quantity and the empty message', () => {
    const { buildStockCopyLines } = loadHelpers();
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 1 }]), '🔥 A');
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 2 }]), '🔥 A（現貨2隻）');
    assert.equal(buildStockCopyLines([]), '目前無現貨寶可夢。');
});

test('copy prices accept spaces, commas, and newlines', () => {
    const { parseCopyPrices } = loadHelpers();
    assert.deepEqual(Array.from(parseCopyPrices('450 350 400')), [450, 350, 400]);
    assert.deepEqual(Array.from(parseCopyPrices('450,350,400')), [450, 350, 400]);
    assert.deepEqual(Array.from(parseCopyPrices('450\n350\n400')), [450, 350, 400]);
    for (const invalid of ['abc', '-100', '12.5', '0']) assert.equal(parseCopyPrices(invalid), null);
});

test('copy prices are paired with grouped lines in display order', () => {
    const { buildStockCopyLines } = loadHelpers();
    const groups = [
        { label: 'A', quantity: 1 },
        { label: 'B', quantity: 1 },
        { label: 'C', quantity: 1 }
    ];
    assert.equal(
        buildStockCopyLines(groups, [450, 350, 400]),
        '🔥 A｜1隻450元\n🔥 B｜1隻350元\n🔥 C｜1隻400元'
    );
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 2 }], [400]), '🔥 A（現貨2隻）｜1隻400元');
});

test('price count mismatch is rejected without producing partial copy', () => {
    const { getCopyPriceResult } = loadHelpers();
    const groups = Array.from({ length: 8 }, (_, index) => ({ label: String(index), quantity: 1 }));
    assert.deepEqual(
        { ...getCopyPriceResult(groups, '1 2 3 4 5 6 7') },
        { ok: false, message: '需要 8 個價格，目前只有 7 個' }
    );
    assert.deepEqual(
        { ...getCopyPriceResult(groups, '1 2 3 4 5 6 7 8 9') },
        { ok: false, message: '需要 8 個價格，目前有 9 個' }
    );
});

test('reapplying prices rebuilds copy from the original groups', () => {
    const { getCopyPriceResult } = loadHelpers();
    const groups = [{ label: 'A', quantity: 1 }];
    assert.equal(getCopyPriceResult(groups, '450').text, '🔥 A｜1隻450元');
    assert.equal(getCopyPriceResult(groups, '500').text, '🔥 A｜1隻500元');
});

test('empty stock rejects prices and keeps the empty stock copy', () => {
    const { buildStockCopyLines, getCopyPriceResult } = loadHelpers();
    assert.equal(buildStockCopyLines([]), '目前無現貨寶可夢。');
    assert.deepEqual(
        { ...getCopyPriceResult([], '400') },
        { ok: false, message: '目前沒有現貨文案可套用價格' }
    );
});

test('copy price controls are modal-only and do not write inventory data', () => {
    assert.match(html, /id="copyPriceInput"[^>]*inputmode="numeric"/);
    assert.match(html, /id="insertPriceSeparatorBtn"[^>]*type="button"[^>]*>\s*,\s*<\/button>/);
    assert.match(html, /id="applyCopyPricesBtn"[^>]*>套用價格<\/button>/);
    const priceHandler = moduleScript.slice(moduleScript.indexOf("document.getElementById('applyCopyPricesBtn').addEventListener"), moduleScript.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.doesNotMatch(priceHandler, /addDoc|setDoc|updateDoc|localStorage|price\s*:/);
    assert.match(priceHandler, /if \(result\.ok\) document\.getElementById\('copyTextarea'\)\.value = result\.text/);
});

test('price separator inserts at the caret, replaces selections, and restores focus', () => {
    const { insertPriceSeparator } = loadHelpers();
    const makeInput = (value, selectionStart, selectionEnd) => ({
        value,
        selectionStart,
        selectionEnd,
        focused: false,
        setRangeText(replacement, start, end) {
            this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
            this.selectionStart = this.selectionEnd = start + replacement.length;
        },
        focus() { this.focused = true; }
    });

    for (const [value, start, end, expected] of [
        ['450350', 3, 3, '450,350'],
        ['450', 3, 3, '450,'],
        ['450999350', 3, 6, '450,350']
    ]) {
        const input = makeInput(value, start, end);
        insertPriceSeparator(input);
        assert.equal(input.value, expected);
        assert.equal(input.selectionStart, 4);
        assert.equal(input.selectionEnd, 4);
        assert.equal(input.focused, true);
    }
});

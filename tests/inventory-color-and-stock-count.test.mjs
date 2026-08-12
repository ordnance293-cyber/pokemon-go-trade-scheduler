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
    const names = ['normalizeInventoryYear', 'normalizeColorType', 'normalizeBackCardType', 'formatInventoryMetadata', 'formatInventoryCopyText', 'getInventoryGroupingKey', 'getStockInventoryCount'];
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

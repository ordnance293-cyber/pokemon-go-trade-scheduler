import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

assert.ok(moduleScript, 'index.html should contain an inline module script');

function selectMarkup(id) {
    const match = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
    assert.ok(match, `${id} should exist`);
    return { openingTag: match[0].match(/^<select[^>]*>/)[0], options: match[1] };
}

function optionValues(markup) {
    return [...markup.matchAll(/<option\s+value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
        .map(([, value, label]) => ({ value, label: label.trim() }));
}

function loadMetadataHelpers() {
    const names = [
        'normalizeInventoryYear',
        'normalizeColorType',
        'normalizeBackCardType',
        'formatInventoryMetadata',
        'formatInventoryCopyText',
        'getInventoryGroupingKey'
    ];
    const declarations = names.map(name => {
        const match = moduleScript.match(new RegExp(`function ${name}\\([^]*?\\n        }`));
        assert.ok(match, `${name} helper should exist`);
        return match[0];
    }).join('\n');
    return vm.runInNewContext(`(() => { ${declarations}; return { ${names.join(',')} }; })()`);
}

test('year and back-card selectors have the exact option and default contracts', () => {
    const year = selectMarkup('yearSelect');
    assert.match(html, /<label[^>]*>年份<\/label>/);
    assert.deepEqual(
        optionValues(year.options),
        Array.from({ length: 11 }, (_, index) => {
            const value = String(2016 + index);
            return { value, label: value };
        })
    );
    assert.match(year.options, /<option value="2026" selected>2026<\/option>/);

    const backCard = selectMarkup('backCardSelect');
    assert.match(html, /<label[^>]*>背卡<\/label>/);
    assert.deepEqual(optionValues(backCard.options), [
        { value: 'none', label: '無' },
        { value: 'special', label: '特別背卡' },
        { value: 'commemorative', label: '紀念背卡' }
    ]);
    assert.match(backCard.options, /<option value="none" selected>無<\/option>/);
});

test('new inventory records persist metadata with all existing fields', () => {
    assert.match(moduleScript, /const year = Number\(document\.getElementById\('yearSelect'\)\.value\)/);
    assert.match(moduleScript, /const backCardType = document\.getElementById\('backCardSelect'\)\.value/);
    assert.match(moduleScript, /\{ account: acc, name, year, colorType, backCardType, quantity: 1, status: 'stock', partner: '', tradeDate: '', createdAt:/);
});

test('successful add keeps account and resets all other inventory controls', () => {
    const handler = moduleScript.match(/document\.getElementById\('addPokemonBtn'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n        \}\);/);
    assert.ok(handler, 'add inventory handler should exist');
    assert.doesNotMatch(handler[1], /accountSelect'\)\.value\s*=/);
    assert.match(handler[1], /pokemonInput'\)\.value = ''/);
    assert.match(handler[1], /quantityInput'\)\.value = '1'/);
    assert.match(handler[1], /yearSelect'\)\.value = '2026'/);
    assert.match(handler[1], /backCardSelect'\)\.value = 'none'/);
    assert.match(handler[1], /colorTypeSelect'\)\.value = 'shiny'/);
});

test('metadata helpers format copy without whitespace and keep groups independent', () => {
    const helpers = loadMetadataHelpers();
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'none', name: '烈空坐' }), '26年烈空坐');
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'special', name: '烈空坐' }), '26年特別背卡烈空坐');
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'commemorative', name: '烈空坐' }), '26年紀念背卡烈空坐');

    const keys = [
        { year: 2025, backCardType: 'special', name: '烈空坐' },
        { year: 2026, backCardType: 'special', name: '烈空坐' },
        { year: 2026, backCardType: 'commemorative', name: '烈空坐' }
    ].map(helpers.getInventoryGroupingKey);
    assert.equal(new Set(keys).size, 3);
});

test('legacy records render and copy without invented or broken metadata', () => {
    const helpers = loadMetadataHelpers();
    const legacy = { name: '超夢', status: 'stock' };
    assert.equal(helpers.normalizeInventoryYear(legacy.year), null);
    assert.equal(helpers.normalizeBackCardType(legacy.backCardType), 'none');
    assert.equal(helpers.formatInventoryMetadata(legacy), '普色');
    assert.equal(helpers.formatInventoryCopyText(legacy), '超夢');
    assert.doesNotMatch(helpers.formatInventoryCopyText(legacy), /undefined|2026|26年/);
    assert.notEqual(
        helpers.getInventoryGroupingKey(legacy),
        helpers.getInventoryGroupingKey({ ...legacy, year: 2026 })
    );
});

test('inventory cards expose metadata for stock, trading, and done items', () => {
    assert.match(
        moduleScript,
        /const inventoryMetadata = formatInventoryMetadata\(p\);/,
        'card metadata must not be restricted to stock records'
    );
    assert.doesNotMatch(moduleScript, /p\.status === 'stock' \? formatInventoryMetadata\(p\)/);
});

test('schedule timeline identifies the exact metadata variant', () => {
    assert.match(
        moduleScript,
        /\$\{formatInventoryCopyText\(p\)\}➔\$\{p\.partner\}/
    );
});

test('completion confirmation identifies the exact metadata variant', () => {
    assert.match(
        moduleScript,
        /completePokemonName\.textContent = formatInventoryCopyText\(item\) \|\| '此寶可夢';/
    );
});

test('workflow labels preserve legacy names without invented metadata', () => {
    const helpers = loadMetadataHelpers();
    const legacy = { name: '超夢', status: 'trading', partner: '買家' };
    assert.equal(`${helpers.formatInventoryCopyText(legacy)}➔${legacy.partner}`, '超夢➔買家');
    assert.equal(helpers.formatInventoryCopyText(legacy), '超夢');
    assert.doesNotMatch(helpers.formatInventoryCopyText(legacy), /undefined|2026|26年/);
});

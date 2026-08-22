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

test('year control is absent and back-card selector has the exact option and default contract', () => {
    assert.doesNotMatch(html, /id="yearSelect"/);
    const addForm = html.slice(html.indexOf('<h2 class="text-lg md:text-xl font-bold text-gray-800">新增庫存</h2>'), html.indexOf('<div class="glass-panel p-5 md:p-6 rounded-3xl shadow-2xl border-t-8'));
    assert.doesNotMatch(addForm, />年份<\/label>/);
    const backCard = selectMarkup('backCardSelect');
    assert.match(html, /<label[^>]*>背卡<\/label>/);
    assert.deepEqual(optionValues(backCard.options), [
        { value: 'none', label: '無' },
        { value: 'special', label: '特別背卡' },
        { value: 'commemorative', label: '紀念背卡' },
        { value: 'costume', label: '裝扮' }
    ]);
    assert.match(backCard.options, /<option value="none" selected>無<\/option>/);
});

test('new inventory records omit year while persisting the remaining metadata', () => {
    assert.doesNotMatch(moduleScript, /yearSelect/);
    assert.match(moduleScript, /const backCardType = document\.getElementById\('backCardSelect'\)\.value/);
    assert.match(moduleScript, /\{ account: acc, name, colorType, backCardType, quantity: 1, status: 'stock', partner: '', tradeDate: '', createdAt:/);
});

test('successful add keeps account and resets all other inventory controls', () => {
    const handler = moduleScript.match(/document\.getElementById\('addPokemonBtn'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n        \}\);/);
    assert.ok(handler, 'add inventory handler should exist');
    assert.doesNotMatch(handler[1], /accountSelect'\)\.value\s*=/);
    assert.match(handler[1], /pokemonInput'\)\.value = ''/);
    assert.match(handler[1], /quantityInput'\)\.value = '1'/);
    assert.doesNotMatch(handler[1], /yearSelect/);
    assert.match(handler[1], /backCardSelect'\)\.value = 'none'/);
    assert.match(handler[1], /colorTypeSelect'\)\.value = 'shiny'/);
});

test('metadata helpers format copy without whitespace and keep groups independent', () => {
    const helpers = loadMetadataHelpers();
    assert.equal(helpers.normalizeBackCardType('costume'), 'costume');
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'none', name: '烈空坐' }), '烈空坐');
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'special', name: '烈空坐' }), '特別背卡烈空坐');
    assert.equal(helpers.formatInventoryCopyText({ year: 2026, backCardType: 'commemorative', name: '烈空坐' }), '紀念背卡烈空坐');
    assert.equal(helpers.formatInventoryCopyText({ year: 2025, colorType: 'shiny', backCardType: 'costume', name: '皮卡丘' }), '異色裝扮皮卡丘');

    const keys = [
        { year: 2025, backCardType: 'special', name: '烈空坐' },
        { year: 2026, backCardType: 'special', name: '烈空坐' },
        { year: 2026, backCardType: 'commemorative', name: '烈空坐' }
    ].map(helpers.getInventoryGroupingKey);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
});

test('legacy records render and copy without invented or broken metadata', () => {
    const helpers = loadMetadataHelpers();
    const legacy = { name: '超夢', status: 'stock' };
    assert.equal(helpers.normalizeBackCardType(legacy.backCardType), 'none');
    assert.equal(helpers.formatInventoryMetadata(legacy), '普色');
    assert.equal(helpers.formatInventoryCopyText(legacy), '超夢');
    assert.doesNotMatch(helpers.formatInventoryCopyText(legacy), /undefined|2026|26年/);
    assert.equal(
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

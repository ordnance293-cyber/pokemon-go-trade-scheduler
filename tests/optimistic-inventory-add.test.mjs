import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

assert.ok(moduleScript, 'index.html should contain an inline module script');

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

function loadMergeHelper() {
    const source = functionSource('mergeInventoryItems');
    return vm.runInNewContext(`(() => { ${source}; return mergeInventoryItems; })()`);
}

function addHandlerSource() {
    const marker = "document.getElementById('addPokemonBtn').addEventListener('click',";
    const start = moduleScript.indexOf(marker);
    assert.notEqual(start, -1, 'add inventory handler should exist');
    const end = moduleScript.indexOf("\n        });", start);
    assert.notEqual(end, -1, 'add inventory handler should have a closing boundary');
    return moduleScript.slice(start, end + 12);
}

test('inventory add does not sequentially await addDoc or block on persistence', () => {
    const handler = addHandlerSource();
    assert.doesNotMatch(handler, /await\s+addDoc\s*\(/);
    assert.doesNotMatch(handler, /await\s+setDoc\s*\(/);
    assert.match(handler, /setTimeout\s*\(/, 'writes should start outside the immediate interaction task');
});

test('inventory uses client-generated Firestore IDs and setDoc while accounts retain addDoc', () => {
    const handler = addHandlerSource();
    assert.match(handler, /doc\(collection\(db, "inventory"\)\)/);
    assert.match(handler, /setDoc\(ref, data\)/);
    assert.match(moduleScript, /addDoc\(collection\(db, "accounts"\)/);
});

test('optimistic items rebuild and render before persistence begins', () => {
    const handler = addHandlerSource();
    const stage = handler.indexOf('pendingInventoryItems.set(ref.id, item)');
    const rebuild = handler.indexOf('rebuildEffectiveInventory()');
    const render = handler.indexOf('render()');
    const persist = handler.indexOf('setTimeout(');
    assert.ok(stage !== -1 && rebuild > stage && render > rebuild && persist > render);
});

test('form resets immediately without clearing the selected account', () => {
    const handler = addHandlerSource();
    const persist = handler.indexOf('setTimeout(');
    const immediate = handler.slice(0, persist);
    assert.match(immediate, /pokemonInput'\)\.value = ''/);
    assert.match(immediate, /quantityInput'\)\.value = '1'/);
    assert.doesNotMatch(handler, /yearSelect/);
    assert.match(immediate, /backCardSelect'\)\.value = 'none'/);
    assert.match(immediate, /colorTypeSelect'\)\.value = 'shiny'/);
    assert.doesNotMatch(handler, /accountSelect'\)\.value\s*=/);
});

test('quantity loop stages one unit item and unique ref for every background write', () => {
    const handler = addHandlerSource();
    assert.match(handler, /for \(let i = 0; i < qty; i\+\+\)[\s\S]*?const ref = doc\(collection\(db, "inventory"\)\)[\s\S]*?quantity: 1[\s\S]*?pendingInventoryItems\.set\(ref\.id, item\)[\s\S]*?writes\.push\(\{ ref, data \}\)/);
    assert.match(handler, /writes\.map\(\(\{ ref, data \}\) => setDoc\(ref, data\)/);
});

test('color and back-card types are part of year-free data before optimistic staging and persistence', () => {
    const handler = addHandlerSource();
    const data = handler.indexOf('const data = { account: acc, name, colorType, backCardType');
    const stage = handler.indexOf('pendingInventoryItems.set(ref.id, item)');
    const persist = handler.indexOf('setDoc(ref, data)');
    assert.ok(data !== -1 && stage > data && persist > stage);
    assert.doesNotMatch(handler, /\byear\b/);
});

test('snapshot reconciliation deduplicates synced IDs without dropping other pending IDs', () => {
    const mergeInventoryItems = loadMergeHelper();
    const result = mergeInventoryItems(
        [{ id: 'A', name: 'synced A' }],
        new Map([
            ['A', { id: 'A', name: 'pending A' }],
            ['B', { id: 'B', name: 'pending B' }]
        ])
    );
    assert.deepEqual(Array.from(result, item => item.id), ['A', 'B']);
    assert.equal(result[0].name, 'synced A');
});

test('removing one failed pending ID preserves synced and unrelated pending items', () => {
    const mergeInventoryItems = loadMergeHelper();
    const pending = new Map([
        ['failed', { id: 'failed' }],
        ['other', { id: 'other' }]
    ]);
    pending.delete('failed');
    const result = mergeInventoryItems([{ id: 'saved' }], pending);
    assert.deepEqual(Array.from(result, item => item.id), ['saved', 'other']);
});

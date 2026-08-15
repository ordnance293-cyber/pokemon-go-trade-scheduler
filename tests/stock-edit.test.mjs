import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
const stockModal = html.slice(html.indexOf('<div id="editStockModal"'), html.indexOf('<div id="editTradeModal"'));
const renderStockBranch = script.match(/if \(p\.status === 'stock'\) \{[\s\S]*?\} else if \(p\.status === 'trading'\)/)?.[0] || '';
const tradingBranch = script.match(/else if \(p\.status === 'trading'\) \{[\s\S]*?\} else if \(p\.status === 'done'\)/)?.[0] || '';
const doneBranch = script.match(/else if \(p\.status === 'done'\) \{[\s\S]*?\n                \}/)?.[0] || '';
const saveHandler = script.match(/saveEditStockBtn\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n        \}\);/)?.[1] || '';

function valuesFor(id) {
    const body = stockModal.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1] || '';
    return [...body.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
}

test('stock cards alone expose touch-friendly Edit beside Arrange', () => {
    assert.match(renderStockBranch, /<button type="button" onclick="openStockEdit\('\$\{p\.id\}'\)"[^>]*min-h-11[^>]*>編輯<\/button><button[^>]*openTrade[^>]*>安排<\/button>/);
    assert.doesNotMatch(tradingBranch, /openStockEdit/);
    assert.doesNotMatch(doneBranch, /openStockEdit/);
});

test('dedicated stock modal has only focused inventory controls', () => {
    for (const id of ['editStockModal', 'editStockAccountSelect', 'editStockPokemonInput', 'editStockYearSelect', 'editStockColorTypeSelect', 'editStockBackCardSelect', 'cancelEditStockBtn', 'saveEditStockBtn']) {
        assert.match(stockModal, new RegExp(`id="${id}"`));
    }
    assert.doesNotMatch(stockModal, /quantity|tradeDate|partner|luckyTrinket/i);
    assert.match(stockModal, /id="cancelEditStockBtn" type="button"/);
    assert.match(stockModal, /id="saveEditStockBtn" type="button"/);
});

test('stock edit selectors reuse canonical schemas', () => {
    assert.deepEqual(valuesFor('editStockYearSelect'), Array.from({ length: 11 }, (_, index) => String(2016 + index)));
    assert.deepEqual(valuesFor('editStockColorTypeSelect'), ['normal', 'shiny']);
    assert.deepEqual(valuesFor('editStockBackCardSelect'), ['none', 'special', 'commemorative']);
});

test('opening validates stock state and prefills normalized current values', () => {
    const opener = script.match(/window\.openStockEdit = \(id\) => \{([\s\S]*?)\n        \};/)?.[1] || '';
    assert.match(opener, /pokemons\.find\(p => p\.id === id\)/);
    assert.match(opener, /!item \|\| item\.status !== 'stock'\) return/);
    assert.match(opener, /editingStockId = item\.id/);
    assert.match(opener, /populateEditStockAccountSelect\(item\.account \|\| ''\)/);
    assert.match(opener, /editStockPokemonInput\.value = item\.name \|\| ''/);
    assert.match(opener, /normalizeInventoryYear\(item\.year\)/);
    assert.match(opener, /normalizeColorType\(item\.colorType\)/);
    assert.match(opener, /normalizeBackCardType\(item\.backCardType\)/);
});

test('account options reuse savedAccounts and preserve an absent legacy account', () => {
    const population = script.match(/function populateEditStockAccountSelect\(currentAccount = ''\) \{([\s\S]*?)\n        \}/)?.[1] || '';
    assert.match(population, /savedAccounts\.map\(account => account\.name\)/);
    assert.match(population, /currentAccount && !accountNames\.includes\(currentAccount\)/);
    assert.match(population, /accountNames\.unshift\(currentAccount\)/);
    assert.equal((script.match(/onSnapshot\(collection\(db, "accounts"\)/g) || []).length, 1);
});

test('save rejects blank names, revalidates stock, and writes only five fields', () => {
    assert.match(saveHandler, /const name = editStockPokemonInput\.value\.trim\(\)/);
    assert.match(saveHandler, /if \(!name\) return alert\("請填寫寶可夢名稱"\)/);
    assert.match(saveHandler, /pokemons\.find\(p => p\.id === editingStockId\)/);
    assert.match(saveHandler, /!item \|\| item\.status !== 'stock'/);
    assert.match(saveHandler, /updateDoc\(doc\(db, "inventory", editingStockId\), \{\s*account,\s*name,\s*year,\s*colorType,\s*backCardType\s*\}\)/);
    assert.doesNotMatch(saveHandler, /status:|partner:|tradeDate:|createdAt:|luckyTrinket:|completedAt:|quantity:|findNextAvailableDate/);
});

test('cancel only closes its modal and stock edit state stays isolated', () => {
    assert.match(script, /let editingStockId = null;/);
    assert.match(script, /let editingTradeId = null;/);
    assert.match(script, /cancelEditStockBtn\.addEventListener\('click', \(\) => editStockModal\.classList\.add\('hidden'\)\)/);
    const cancel = script.match(/cancelEditStockBtn\.addEventListener\('click',[^\n]+/)?.[0] || '';
    assert.doesNotMatch(cancel, /updateDoc|editingTradeId/);
    assert.doesNotMatch(saveHandler, /editingTradeId/);
});

test('inline module JavaScript passes node syntax validation', () => {
    const path = join(root, '.stock-edit-inline-check.mjs');
    const syntaxOnly = script.replace(/^\s*import .*;$/gm, '');
    writeFileSync(path, syntaxOnly);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    unlinkSync(path);
    assert.equal(result.status, 0, result.stderr);
});

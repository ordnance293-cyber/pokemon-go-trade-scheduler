import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

test('timeline edit button and focused modal have stable accessible controls', () => {
    assert.match(script, /<button type="button" onclick="openTradeEdit\('\$\{p\.id\}'\)"[^>]*>編輯<\/button>/);
    for (const id of ['editTradeModal', 'editTradeAccountLabel', 'editTradePokemonLabel', 'editTradePartnerInput', 'editLuckyTrinketBuyerBtn', 'editLuckyTrinketSellerBtn', 'cancelEditTradeBtn', 'saveEditTradeBtn']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    const modal = html.match(/<div id="editTradeModal"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.doesNotMatch(modal, /tradeDate|type="date"/);
    assert.match(modal, /id="editLuckyTrinketBuyerBtn" type="button" aria-pressed="false"/);
    assert.match(modal, /id="editLuckyTrinketSellerBtn" type="button" aria-pressed="false"/);
});

test('edit opening validates trading item and prefills current values', () => {
    assert.match(script, /window\.openTradeEdit = \(id\) => \{[\s\S]*?pokemons\.find\(p => p\.id === id\)[\s\S]*?!item \|\| item\.status !== 'trading'\) return;[\s\S]*?editingTradeId = item\.id;[\s\S]*?editTradePartnerInput\.value = item\.partner \|\| '';[\s\S]*?setEditingLuckyTrinketSelection\(item\.luckyTrinket\)/);
    assert.match(script, /function normalizeLuckyTrinket\(value\)[\s\S]*?value === 'buyer' \|\| value === 'seller' \? value : null/);
});

test('edit selection is isolated, toggleable, and mutually exclusive', () => {
    assert.match(script, /let editingLuckyTrinket = null;/);
    assert.match(script, /function setEditingLuckyTrinketSelection\(value\)[\s\S]*?editingLuckyTrinket = normalizeLuckyTrinket\(value\)[\s\S]*?updateLuckyTrinketButtons/);
    assert.match(script, /editingLuckyTrinket === 'buyer' \? null : 'buyer'/);
    assert.match(script, /editingLuckyTrinket === 'seller' \? null : 'seller'/);
});

test('save revalidates stale items and delegates to transaction-safe trinket editing', () => {
    const handler = script.match(/saveEditTradeBtn\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n        \}\);/)?.[1] || '';
    assert.match(handler, /const rawPartner = editTradePartnerInput\.value;[\s\S]*?!rawPartner\.trim\(\)[\s\S]*?const partner = rawPartner/);
    assert.match(handler, /pokemons\.find\(p => p\.id === editingTradeId\)/);
    assert.match(handler, /!item \|\| item\.status !== 'trading'/);
    assert.match(handler, /await updateLuckyTrinketTrade\(item, partner, editingLuckyTrinket\)/);
    assert.doesNotMatch(handler, /tradeDate|findNextAvailableDate|status:|account:|name:/);
    assert.match(script, /cancelEditTradeBtn\.addEventListener\('click', \(\) => editTradeModal\.classList\.add\('hidden'\)\)/);
    assert.match(script, /async function updateLuckyTrinketTrade[\s\S]*?runTransaction[\s\S]*?lockSnapshot\.data\(\)\.state === 'reserved'[\s\S]*?transaction\.delete\(lockRef\)/);
});

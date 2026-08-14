import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

test('arrange modal exposes optional mutually exclusive lucky-trinket controls', () => {
    const partner = html.indexOf('id="partnerInput"');
    const buyer = html.indexOf('id="luckyTrinketBuyerBtn"');
    const seller = html.indexOf('id="luckyTrinketSellerBtn"');
    const actions = html.indexOf('id="cancelTradeBtn"');
    assert.ok(partner < buyer && buyer < seller && seller < actions);
    assert.match(html, /id="luckyTrinketBuyerBtn" type="button" aria-pressed="false"[^>]*>亮晶晶首飾（他出）<\/button>/);
    assert.match(html, /id="luckyTrinketSellerBtn" type="button" aria-pressed="false"[^>]*>亮晶晶首飾（我出）<\/button>/);
    assert.match(script, /let selectedLuckyTrinket = null;/);
    assert.match(script, /function setLuckyTrinketSelection\(value\)[\s\S]*?normalizeLuckyTrinket\(value\)[\s\S]*?updateLuckyTrinketButtons/);
    assert.match(script, /setAttribute\('aria-pressed', String\(isSelected\)\)/);
    assert.match(script, /selectedLuckyTrinket === 'buyer' \? null : 'buyer'/);
    assert.match(script, /selectedLuckyTrinket === 'seller' \? null : 'seller'/);
});

test('opening and saving an arranged trade resets and persists the single selection', () => {
    assert.match(script, /window\.openTrade = \(id, accName\) => \{[\s\S]*?partnerInput'\)\.value = '';[\s\S]*?setLuckyTrinketSelection\(null\);/);
    assert.match(script, /updateDoc\(doc\(db, "inventory", selectedId\), \{ status: 'trading', partner, tradeDate: autoDate, luckyTrinket: selectedLuckyTrinket \}\)/);
});

test('formatters ignore legacy values and both render locations use their labels', () => {
    assert.match(script, /function getLuckyTrinketLabel\(value\)[\s\S]*?value === 'buyer'[\s\S]*?value === 'seller'[\s\S]*?return '';/);
    assert.match(script, /function getLuckyTrinketShortLabel\(value\)[\s\S]*?getLuckyTrinketLabel\(value\)/);
    assert.match(script, /✨ \$\{luckyTrinketLabel\}/);
    assert.match(script, /p\.status === 'trading' \? getLuckyTrinketLabel\(p\.luckyTrinket\) : ''/);
});

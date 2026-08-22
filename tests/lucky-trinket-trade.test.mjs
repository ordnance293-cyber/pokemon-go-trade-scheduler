import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

function extractFunction(name) {
    const start = script.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing ${name}`);
    const bodyStart = script.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < script.length; index += 1) {
        if (script[index] === '{') depth += 1;
        if (script[index] === '}') depth -= 1;
        if (depth === 0) return script.slice(start, index + 1);
    }
    throw new Error(`unterminated ${name}`);
}

const accountViewer = html.match(/<div class="glass-panel overflow-hidden[\s\S]*?<\/table>\s*<\/div>/)?.[0] || '';

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

test('Lucky Trinket viewer contains only account and availability columns', () => {
    assert.match(accountViewer, /<th[^>]*>帳號<\/th>/);
    assert.match(accountViewer, /<th[^>]*>首飾狀態<\/th>/);
    assert.match(accountViewer, /id="luckyTrinketAccountList"/);
    assert.doesNotMatch(accountViewer, /買家|buyer|寶可夢|tradeDate|交易日期|完成日期|completedAt|待交換|已完成|在庫|seller|紀錄|重複|警告|筆數|切換|button/i);

    const renderer = extractFunction('renderLuckyTrinketAccounts');
    assert.match(renderer, /accountCell\.textContent = name/);
    assert.match(renderer, /statusCell\.textContent = unavailable \? '🔴 無' : '🟢 有'/);
    assert.doesNotMatch(renderer, /innerHTML|updateDoc|setDoc|addDoc|deleteDoc|transaction|partner|tradeDate|completedAt|\.name\b(?!\s*;)/i);
});

test('account availability uses exact full names, all statuses, and seller trinkets only', () => {
    const normalizeSource = extractFunction('normalizeLuckyTrinket');
    const rowsSource = extractFunction('getLuckyTrinketAccountRows');
    const getRows = Function(`${normalizeSource}; ${rowsSource}; return getLuckyTrinketAccountRows;`)();
    const accounts = [
        { name: 'khang5xxxxxx' },
        { name: 'chuc02xxxxxx' },
        { name: 'khang5yyyyyy' },
        { name: 'khang5xxxxxx' },
        { name: 'free-account' }
    ];
    const inventory = [
        { account: 'chuc02xxxxxx', status: 'trading', luckyTrinket: 'seller' },
        { account: 'khang5xxxxxx', status: 'done', luckyTrinket: 'buyer' },
        { account: 'khang5yyyyyy', status: 'legacy-status', luckyTrinket: 'seller' },
        { account: 'free-account', status: 'stock', luckyTrinket: 'invalid' }
    ];

    assert.deepEqual(getRows(accounts, inventory), [
        { name: 'chuc02xxxxxx', unavailable: true },
        { name: 'khang5yyyyyy', unavailable: true },
        { name: 'khang5xxxxxx', unavailable: false },
        { name: 'free-account', unavailable: false }
    ]);
});

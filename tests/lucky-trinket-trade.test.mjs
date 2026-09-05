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
    assert.match(script, /transaction\.update\(inventoryRef, \{ status: 'trading', partner, tradeDate: autoDate, luckyTrinket: 'seller', luckyTrinketTaskCompleted: selectedLuckyTrinketTaskCompleted, luckyTrinketCycleId: cycle\.id,[\s\S]*?weeklyChallengeTaskId: exemptionSnapshot\.exists\(\) \? deleteField\(\) : taskRef\.id/);
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
    assert.match(renderer, /accountCell\.textContent = getLuckyTrinketAccountDisplayName\(account\)/);
    assert.match(renderer, /statusCell\.textContent = hasTrinket \? '🟢 有首飾' : '🔴 無首飾'/);
    assert.doesNotMatch(renderer, /accountCell\.textContent = account/);
    assert.doesNotMatch(renderer, /innerHTML|updateDoc|setDoc|addDoc|deleteDoc|transaction|partner|tradeDate|completedAt|\.name\b(?!\s*;)/i);
});

test('Lucky Trinket account display names contain at most the first six characters', () => {
    const displayNameSource = extractFunction('getLuckyTrinketAccountDisplayName');
    const getDisplayName = Function(`${displayNameSource}; return getLuckyTrinketAccountDisplayName;`)();

    assert.equal(getDisplayName('tu696218ub;Bestpoke27@'), 'tu6962');
    assert.equal(getDisplayName('khang562570qw;Bestpoke27@'), 'khang5');
    assert.equal(getDisplayName('abc'), 'abc');
});

test('account availability uses exact full names, all statuses, and seller trinkets only', () => {
    const normalizeSource = extractFunction('normalizeLuckyTrinket');
    const helpers = ['getLuckyTrinketCycleLockKey', 'isActiveLuckyTrinketCycleLock', 'timestampToLocalDate', 'isLegacySellerRecordRelevantToCycle'].map(extractFunction).join(';');
    const availabilitySource = extractFunction('accountHasLuckyTrinket');
    const rowsSource = extractFunction('getLuckyTrinketAccountRows');
    const getRows = Function(`const LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID='2026-08-go-pass'; ${normalizeSource}; ${helpers}; ${availabilitySource}; ${rowsSource}; return (a,i)=>getLuckyTrinketAccountRows(a,i,{id:'2026-08-go-pass',startDate:'2026-08-04',endDate:'2026-09-08'},new Map());`)();
    const accounts = [
        { name: 'abcdef111111' },
        { name: 'abcdef222222' },
        { name: 'accountA' },
        { name: 'accountB' },
        { name: 'accountA' }
    ];
    const inventory = [
        { account: 'abcdef111111', status: 'done', tradeDate: '2026-08-05', luckyTrinket: 'seller' },
        { account: 'accountA', status: 'trading', tradeDate: '2026-08-06', luckyTrinket: 'seller' },
        { account: 'accountB', status: 'trading', luckyTrinket: 'buyer' }
    ];

    assert.deepEqual(getRows(accounts, inventory), [
        { account: 'abcdef111111', hasTrinket: false },
        { account: 'accountA', hasTrinket: false },
        { account: 'abcdef222222', hasTrinket: true },
        { account: 'accountB', hasTrinket: true }
    ]);
});

test('shared account availability helper is safe for viewer and stock-copy reuse', () => {
    const normalizeSource = extractFunction('normalizeLuckyTrinket');
    const helpers = ['getLuckyTrinketCycleLockKey', 'isActiveLuckyTrinketCycleLock', 'timestampToLocalDate', 'isLegacySellerRecordRelevantToCycle'].map(extractFunction).join(';');
    const availabilitySource = extractFunction('accountHasLuckyTrinket');
    const accountHasLuckyTrinket = Function(`const LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID='2026-08-go-pass'; ${normalizeSource}; ${helpers}; ${availabilitySource}; return (a,i)=>accountHasLuckyTrinket(a,i,{id:'2026-08-go-pass',startDate:'2026-08-04',endDate:'2026-09-08'},new Map());`)();
    const items = [
        { account: 'seller-account', status: 'done', tradeDate: '2026-08-05', luckyTrinket: 'seller' },
        { account: 'buyer-account', status: 'trading', luckyTrinket: 'buyer' },
        { account: 'invalid-account', status: 'legacy', luckyTrinket: 'unknown' }
    ];
    assert.equal(accountHasLuckyTrinket('seller-account', items), false);
    assert.equal(accountHasLuckyTrinket('buyer-account', items), true);
    assert.equal(accountHasLuckyTrinket('invalid-account', items), true);
    assert.equal(accountHasLuckyTrinket('seller', items), true, 'matching must use the exact full account');
});

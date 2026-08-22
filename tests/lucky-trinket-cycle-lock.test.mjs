import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
function extract(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = script.indexOf('{', start); let depth = 0;
  for (let i = open; i < script.length; i++) {
    if (script[i] === '{') depth++;
    if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
}

test('explicit GO Pass boundaries have no monthly fallback', () => {
  const config = script.match(/const LUCKY_TRINKET_CYCLES = \[[\s\S]*?\n        \];/)?.[0] || '';
  const fn = extract('getLuckyTrinketCycleForDate');
  const getCycle = Function(`${config}; ${fn}; return getLuckyTrinketCycleForDate`)();
  assert.equal(getCycle('2026-08-03'), null);
  for (const date of ['2026-08-04', '2026-08-23', '2026-09-08']) assert.equal(getCycle(date)?.id, '2026-08-go-pass');
  assert.equal(getCycle('2026-09-09'), null);
});

test('lock key uses the complete account and cycle', () => {
  const fn = extract('getLuckyTrinketCycleLockKey');
  const key = Function(`${fn}; return getLuckyTrinketCycleLockKey`)();
  assert.equal(key('abcdef111111', 'cycle'), key('abcdef111111', 'cycle'));
  assert.notEqual(key('abcdef111111', 'cycle'), key('abcdef111111', 'other'));
  assert.notEqual(key('abcdef111111', 'cycle'), key('abcdef222222', 'cycle'));
});

test('source uses one authoritative collection listener and transactions', () => {
  assert.equal((script.match(/onSnapshot\(collection\(db, "luckyTrinketCycleLocks"\)/g) || []).length, 1);
  assert.match(script, /runTransaction/);
  assert.match(script, /encodeURIComponent\(getLuckyTrinketCycleLockKey\(accountName, cycleId\)\)/);
  assert.match(script, /state: 'reserved'/);
  assert.match(script, /state: 'used'/);
  assert.match(script, /luckyTrinketCycleId/);
  assert.match(html, /id="tradeLuckyTrinketMessage"/);
  assert.match(html, /id="luckyTrinketCycleSubtitle"/);
});

test('arrange seller control exposes native disabled accessibility and visual states', () => {
  const modal = html.match(/<div id="tradeModal"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  const seller = modal.match(/<button id="luckyTrinketSellerBtn"[^>]*>/)?.[0] || '';
  assert.match(seller, /type="button"/);
  assert.match(seller, /aria-describedby="tradeLuckyTrinketMessage"/);
  for (const className of ['disabled:cursor-not-allowed', 'disabled:border-gray-200', 'disabled:bg-gray-100', 'disabled:text-gray-400', 'disabled:opacity-60']) assert.match(seller, new RegExp(className.replace(':', '\\:')));
  assert.match(modal, /id="tradeLuckyTrinketMessage"[^>]*aria-live="polite"/);
});

test('pure arrange UI state fails closed and shares current-cycle availability', () => {
  const names = ['normalizeLuckyTrinket', 'getLuckyTrinketCycleLockKey', 'isActiveLuckyTrinketCycleLock', 'timestampToLocalDate', 'isLegacySellerRecordRelevantToCycle', 'accountHasLuckyTrinket', 'getArrangeSellerTrinketUiState'];
  const getState = Function(`const LEGACY_LUCKY_TRINKET_ROLLOUT_CYCLE_ID='2026-08-go-pass'; ${names.map(extract).join(';')}; return getArrangeSellerTrinketUiState`)();
  const cycle = { id: '2026-08-go-pass', label: '2026年8月 GO Pass', startDate: '2026-08-04', endDate: '2026-09-08' };
  const key = JSON.stringify([cycle.id, 'abcdef111111']);
  assert.deepEqual(getState('abcdef111111', [], cycle, new Map(), false, true), { canSelectSeller: false, message: '首飾資料同步中，請稍後再試', tone: 'syncing' });
  assert.deepEqual(getState('abcdef111111', [], cycle, new Map(), true, false), { canSelectSeller: false, message: '首飾資料同步中，請稍後再試', tone: 'syncing' });
  assert.deepEqual(getState('abcdef111111', [], null, new Map(), true, true), { canSelectSeller: false, message: '目前未設定 GO Pass 首飾週期，暫時無法使用「我出首飾」', tone: 'unavailable' });
  assert.deepEqual(getState('abcdef111111', [], cycle, new Map(), true, true), { canSelectSeller: true, message: '本期首飾可用｜2026年8月 GO Pass', tone: 'available' });
  for (const state of ['reserved', 'used']) {
    const locks = new Map([[key, { cycleId: cycle.id, account: 'abcdef111111', state }]]);
    assert.deepEqual(getState('abcdef111111', [], cycle, locks, true, true), { canSelectSeller: false, message: '本期首飾已預約或使用，無法再選「我出首飾」', tone: 'unavailable' });
  }
  const oldLocks = new Map([[JSON.stringify(['old-cycle', 'abcdef111111']), { cycleId: 'old-cycle', account: 'abcdef111111', state: 'used' }]]);
  assert.equal(getState('abcdef111111', [], cycle, oldLocks, true, true).canSelectSeller, true);
});

test('arrange modal opens from latest full stock item and refreshes live safely', () => {
  const refresh = extract('refreshArrangeLuckyTrinketAvailability');
  assert.match(refresh, /pokemons\.find\(item => item\.id === selectedId && item\.status === 'stock'\)/);
  assert.match(refresh, /item\?\.account/);
  assert.doesNotMatch(refresh, /slice\(0,\s*6\)/);
  assert.match(refresh, /luckyTrinketSellerBtn\.disabled = !state\.canSelectSeller/);
  assert.match(refresh, /setAttribute\('aria-disabled', String\(!state\.canSelectSeller\)\)/);
  assert.match(refresh, /selectedLuckyTrinket === 'seller'[\s\S]*?setLuckyTrinketSelection\(null\)/);
  assert.doesNotMatch(refresh, /luckyTrinketBuyerBtn\.disabled/);
  assert.match(script, /window\.openTrade = \(id, accName\) => \{[\s\S]*?pokemons\.find[\s\S]*?item\.status !== 'stock'[\s\S]*?selectedAccName = item\.account[\s\S]*?refreshArrangeLuckyTrinketAvailability\(\)/);
  assert.match(script, /luckyTrinketCycleLockSnapshotReady = true;[\s\S]*?refreshArrangeLuckyTrinketAvailability\(\)/);
  assert.match(script, /rebuildEffectiveInventory\(\);[\s\S]*?inventorySnapshotReady = true;[\s\S]*?refreshArrangeLuckyTrinketAvailability\(\)/);
  assert.match(script, /luckyTrinketSellerBtn\.addEventListener\('click', \(\) => \{[\s\S]*?if \(luckyTrinketSellerBtn\.disabled\) return;/);
});

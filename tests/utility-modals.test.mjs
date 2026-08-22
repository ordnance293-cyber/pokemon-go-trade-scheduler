import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

function elementById(id) {
    const start = html.search(new RegExp(`<div\\s+[^>]*id="${id}"`));
    assert.notEqual(start, -1, `missing ${id}`);
    const tagPattern = /<\/?div\b[^>]*>/g;
    tagPattern.lastIndex = start;
    let depth = 0;
    for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return html.slice(start, tagPattern.lastIndex);
    }
    throw new Error(`unterminated ${id}`);
}

function countId(id) {
    return (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
}

test('three compact utility shortcuts are available near the page header', () => {
    for (const [id, label] of [
        ['openAccountManagementBtn', '帳號管理'],
        ['openScheduleOverviewBtn', '待交換清單'],
        ['openLuckyTrinketStatusBtn', '亮晶晶首飾']
    ]) {
        assert.match(html, new RegExp(`id="${id}"[^>]*>[\\s\\S]*?${label}`));
    }
    assert.match(html, /id="openAccountManagementBtn"[^>]*min-h-11/);
    assert.match(html, /flex[^"\n]*flex-wrap[^"\n]*["'][^>]*>\s*<button id="openAccountManagementBtn"/);
});

test('each utility modal owns its single authoritative existing content', () => {
    const expected = {
        accountManagementModal: ['newAccountInput', 'saveAccountBtn', 'accountTags'],
        scheduleOverviewModal: ['scheduleTimeline'],
        luckyTrinketStatusModal: ['luckyTrinketAccountList']
    };
    for (const [modalId, ids] of Object.entries(expected)) {
        const modal = elementById(modalId);
        for (const id of ids) {
            assert.match(modal, new RegExp(`id="${id}"`));
            assert.equal(countId(id), 1, `${id} must remain unique`);
        }
    }
});

test('utility modals start hidden and have mobile-safe scrolling content and close controls', () => {
    const controls = {
        accountManagementModal: 'closeAccountManagementModalBtn',
        scheduleOverviewModal: 'closeScheduleOverviewModalBtn',
        luckyTrinketStatusModal: 'closeLuckyTrinketStatusBtn'
    };
    for (const [modalId, closeId] of Object.entries(controls)) {
        const modal = elementById(modalId);
        assert.match(modal, new RegExp(`<div id="${modalId}" class="[^"]*\\bhidden\\b`));
        assert.match(modal, /<div class="[^"]*max-h-\[90vh\][^"]*overflow-y-auto|<div class="[^"]*overflow-y-auto[^"]*max-h-\[90vh\]/);
        assert.match(modal, new RegExp(`id="${closeId}"`));
    }
});

test('open handlers refresh viewers and isolate utility modal visibility', () => {
    assert.match(script, /const utilityModals = \[[\s\S]*?'accountManagementModal'[\s\S]*?'scheduleOverviewModal'[\s\S]*?'luckyTrinketStatusModal'[\s\S]*?\];/);
    assert.match(script, /function openUtilityModal\(targetModal\)[\s\S]*?utilityModals\.forEach[\s\S]*?classList\.add\('hidden'\)[\s\S]*?targetModal\.classList\.remove\('hidden'\)/);
    assert.match(script, /openAccountManagementBtn[\s\S]*?openUtilityModal\(accountManagementModal\)/);
    assert.match(script, /openScheduleOverviewBtn[\s\S]*?renderTimeline\(\)[\s\S]*?openUtilityModal\(scheduleOverviewModal\)/);
    assert.match(script, /openLuckyTrinketStatusBtn[\s\S]*?renderLuckyTrinketAccounts\(\)[\s\S]*?openUtilityModal\(luckyTrinketStatusModal\)/);
});

test('utility reorganization does not duplicate Firestore listeners', () => {
    assert.equal((script.match(/onSnapshot\(collection\(db, "accounts"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(query\(collection\(db, "inventory"\)\)/g) || []).length, 1);
});

test('account save and delete behavior still targets authoritative controls', () => {
    assert.match(script, /getElementById\('saveAccountBtn'\)\.addEventListener\('click'/);
    assert.match(script, /getElementById\('newAccountInput'\)/);
    assert.match(script, /getElementById\('accountTags'\)/);
    assert.match(script, /window\.deleteAccount/);
});

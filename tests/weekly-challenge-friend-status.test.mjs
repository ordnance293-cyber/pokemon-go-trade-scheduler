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

test('friend identity uses the full account and exact raw customer name', () => {
    const helpers = Function(`${extractFunction('getWeeklyChallengeExactCustomerName')};${extractFunction('getWeeklyChallengeFriendStatusKey')};${extractFunction('getWeeklyChallengeFriendStatusDocumentId')};return { getWeeklyChallengeFriendStatusKey, getWeeklyChallengeFriendStatusDocumentId };`)();
    const { getWeeklyChallengeFriendStatusKey: key, getWeeklyChallengeFriendStatusDocumentId: id } = helpers;
    assert.equal(key('abcdef111111', 'Danny Yi'), key('abcdef111111', 'Danny Yi'));
    assert.notEqual(key('abcdef111111', 'Danny Yi'), key('abcdef111111', 'danny yi'));
    assert.notEqual(key('abcdef111111', 'Danny Yi'), key('abcdef111111', 'Danny Yi '));
    assert.notEqual(key('abcdef111111', 'Danny Yi'), key('abcdef222222', 'Danny Yi'));
    assert.equal(id('abcdef111111', 'Danny Yi'), id('abcdef111111', 'Danny Yi'));
    assert.notEqual(id('abcdef111111', 'Danny Yi'), id('abcdef222222', 'Danny Yi'));
    assert.doesNotMatch(key('abcdef111111', 'Danny Yi'), /weekId|2026-08-25/);
    for (const forbidden of [/\.trim\(/, /\.toLowerCase\(/, /\.toLocaleLowerCase\(/, /\.normalize\(/, /\.replace\(/]) {
        assert.doesNotMatch(extractFunction('getWeeklyChallengeFriendStatusKey'), forbidden);
    }
});

test('friend status uses one deterministic collection listener and readiness cache', () => {
    assert.equal((script.match(/onSnapshot\(collection\(db, ["']weeklyChallengeFriendStatuses["']\)/g) || []).length, 1);
    assert.match(script, /let weeklyChallengeFriendStatusMap = new Map\(\)/);
    assert.match(script, /let weeklyChallengeFriendStatusSnapshotReady = false/);
    assert.match(script, /state === 'added'/);
    assert.match(script, /weeklyChallengeFriendStatusSnapshotReady = true/);
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeTasks"\)/g) || []).length, 1);
    assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeCompletions"\)/g) || []).length, 1);
});

test('shared customer row owns one control set and all required UI wording', () => {
    const row = extractFunction('createWeeklyChallengeCustomerRow');
    assert.match(row, /createWeeklyChallengeFriendStatusControls\(customer\)/);
    assert.equal((row.match(/createWeeklyChallengeFriendStatusControls\(customer\)/g) || []).length, 1);
    assert.match(row, /customer\.tasks\.forEach/);
    assert.ok((script.match(/createWeeklyChallengeCustomerRow\(customer\)/g) || []).length >= 3, 'standalone, merged, and queued rows share the helper');
    for (const wording of ['標記已加', '✅ 已加好友', '退回', '好友狀態同步中', '好友狀態更新失敗，請稍後再試', '未填買家，無法標記好友']) assert.ok(script.includes(wording), wording);
    const controls = extractFunction('createWeeklyChallengeFriendStatusControls');
    assert.match(controls, /weeklyChallengeFriendStatusSnapshotReady/);
    assert.match(controls, /const partner = getWeeklyChallengeExactCustomerName\(customer\.partner\);[\s\S]*?partner === ''/);
    assert.match(controls, /標記買家已加好友/);
    assert.match(controls, /退回未加好友狀態/);
});

test('mark writes only an added deterministic status and blank partners cannot write', () => {
    const source = extractFunction('markWeeklyChallengeFriendAdded');
    assert.match(source, /getWeeklyChallengeExactCustomerName\(customer\.partner\)/);
    assert.match(source, /partner === ''/);
    assert.match(source, /getWeeklyChallengeFriendStatusRef\(customer\.account, partner\)/);
    assert.match(source, /setDoc\(/);
    assert.match(source, /state:\s*'added'/);
    assert.match(source, /identityVersion:\s*WEEKLY_CUSTOMER_IDENTITY_VERSION/);
    assert.doesNotMatch(source, /weeklyChallengeTasks|inventory|weekId/);
});

test('undo deletes only the deterministic friend status document', () => {
    const source = extractFunction('undoWeeklyChallengeFriendAdded');
    assert.match(source, /getWeeklyChallengeFriendStatusRef\(customer\.account, partner\)/);
    assert.match(source, /deleteDoc\(/);
    assert.doesNotMatch(source, /weeklyChallengeTasks|inventory|weeklyChallengeMergeGroups|weeklyChallengeStartedSessions|weeklyChallengeCompletions/);
});

test('writes are tap-safe, update local cache, refresh the modal, and report failures', () => {
    assert.match(script, /const weeklyChallengeFriendStatusBusyKeys = new Set\(\)/);
    for (const name of ['markWeeklyChallengeFriendAdded', 'undoWeeklyChallengeFriendAdded']) {
        const source = extractFunction(name);
        assert.match(source, /weeklyChallengeFriendStatusBusyKeys\.has/);
        assert.match(source, /weeklyChallengeFriendStatusBusyKeys\.add/);
        assert.match(source, /處理中\.\.\./);
        assert.match(source, /refreshWeeklyChallengeIfOpen\(\)/);
        assert.match(source, /finally[\s\S]*weeklyChallengeFriendStatusBusyKeys\.delete/);
        assert.match(source, /好友狀態更新失敗，請稍後再試/);
    }
});

test('friend status is permanent and informational only', () => {
    const lifecycle = ['completeWeeklyChallengeGroup', 'completeMergedWeeklyChallengeGroup', 'cancelWeeklyChallengeStart', 'dismantleWeeklyChallengeMergeGroup'];
    lifecycle.forEach(name => assert.doesNotMatch(extractFunction(name), /weeklyChallengeFriendStatus/));
    for (const name of ['startWeeklyChallengeGroup', 'startMergedWeeklyChallengeGroup', 'createWeeklyChallengeMergeGroup']) {
        assert.doesNotMatch(extractFunction(name), /isWeeklyChallengeFriendAdded|weeklyChallengeFriendStatus/);
    }
    assert.equal((script.match(/['"]weeklyChallengeFriendStatuses['"]/g) || []).length, 2, 'collection is referenced only by its ref helper and single listener');
});

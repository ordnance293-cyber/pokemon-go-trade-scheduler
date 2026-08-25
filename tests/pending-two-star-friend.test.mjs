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

test('weekly completion helper accepts only valid positive numeric timestamps', () => {
    const source = extractFunction('hasCompletedWeeklyChallenge');
    const helper = Function(`${source}; return hasCompletedWeeklyChallenge;`)();
    assert.equal(helper({ weeklyChallengeCompletedAt: 1780000000000 }), true);
    for (const item of [{}, { weeklyChallengeCompletedAt: 0 }, { weeklyChallengeCompletedAt: -1 }, { weeklyChallengeCompletedAt: '1780000000000' }, { weeklyChallengeCompletedAt: Number.NaN }, null]) {
        assert.equal(helper(item), false);
    }
    assert.match(source, /weeklyChallengeCompletedAt/);
    assert.doesNotMatch(source, /weeklyChallengeTaskId|weeklyChallengeStarted|weeklyChallengeFriendStatus|luckyTrinket|tradeDate|merge/i);
});

test('main pending cards use the shared helper and exact two-star badge', () => {
    const render = extractFunction('render');
    const tradingStart = render.indexOf("p.status === 'trading'");
    const doneStart = render.indexOf("p.status === 'done'", tradingStart);
    assert.ok(tradingStart >= 0 && doneStart > tradingStart, 'trading and done branches exist');
    const tradingBranch = render.slice(tradingStart, doneStart);
    assert.match(tradingBranch, /hasCompletedWeeklyChallenge\(p\)/);
    assert.match(tradingBranch, /⭐️⭐️ 2星好友/);
    assert.doesNotMatch(render.slice(0, tradingStart), /⭐️⭐️ 2星好友/);
    assert.doesNotMatch(render.slice(doneStart), /⭐️⭐️ 2星好友/);
});

test('pending timeline cards use the same helper and exact badge', () => {
    const timeline = extractFunction('renderTimeline');
    assert.match(timeline, /p\.status === 'trading'/);
    assert.match(timeline, /hasCompletedWeeklyChallenge\(p\)/);
    assert.match(timeline, /⭐️⭐️ 2星好友/);
    assert.equal((script.match(/⭐️⭐️ 2星好友/g) || []).length, 2, 'only the two pending views render the badge');
});

test('standalone completion marks every surviving member inventory document', () => {
    const completion = extractFunction('completeWeeklyChallengeGroup');
    assert.match(completion, /const inventoryRefs=members\.map/);
    assert.match(completion, /inventories\.forEach\(\(snap,index\)=>\{if\(snap\?\.exists\(\)\)transaction\.update\(inventoryRefs\[index\],\{weeklyChallengeCompletedWeekId:weekId,weeklyChallengeCompletedAt:completedAt/);
    assert.doesNotMatch(completion, /inventories\[0\]|inventoryRefs\[0\]/);
});

test('merged completion marks every surviving member inventory document', () => {
    const completion = extractFunction('completeMergedWeeklyChallengeGroup');
    assert.match(completion, /const inventoryRefs=members\.map/);
    assert.match(completion, /inventories\.forEach\(\(snap,index\)=>\{if\(snap\?\.exists\(\)\)transaction\.update\(inventoryRefs\[index\],\{weeklyChallengeCompletedWeekId:weekId,weeklyChallengeCompletedAt:completedAt/);
    assert.doesNotMatch(completion, /inventories\[0\]|inventoryRefs\[0\]/);
});

test('two-star display adds no Firestore collection or listener', () => {
    for (const forbidden of ['twoStarFriends', 'weeklyChallengeTwoStarStatuses', 'friendshipLevels']) assert.doesNotMatch(script, new RegExp(forbidden, 'i'));
    assert.equal((script.match(/onSnapshot\(query\(collection\(db, "inventory"\)\)/g) || []).length, 1);
});

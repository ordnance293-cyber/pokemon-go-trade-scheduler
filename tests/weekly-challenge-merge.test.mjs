import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

test('merge storage uses full-account deterministic locks and one listener', () => {
  assert.match(script, /function getWeeklyChallengeMergeMembershipKey/);
  assert.match(script, /weeklyChallengeMergeMemberships/);
  assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeMergeGroups"\)/g) || []).length, 1);
  assert.notEqual(JSON.stringify(['abcdef111111']), JSON.stringify(['abcdef222222']));
});

test('manual merge lifecycle is transactional and never automatic', () => {
  assert.match(script, /selectedWeeklyMergeAccounts = new Set/);
  assert.match(script, /selectedWeeklyMergeAccounts\.size >= 2/);
  assert.match(script, /請選擇 2 個 2\/4 帳號/);
  assert.match(script, /async function createWeeklyChallengeMergeGroup/);
  assert.match(script, /async function dismantleWeeklyChallengeMergeGroup/);
  assert.match(script, /async function completeMergedWeeklyChallengeGroup/);
  assert.doesNotMatch(script, /auto.*Weekly.*Merge/i);
});

test('merged completion shares a session and performs complete cleanup', () => {
  assert.match(script, /type:\s*'merged',groupId,accounts,customerKeys,taskIds/);
  assert.match(script, /mode:\s*'merged'/);
  assert.match(script, /peopleCount:\s*4/);
  assert.match(script, /missingPeopleAtCompletion:\s*0/);
  assert.match(script, /transaction\.delete\(groupRef\)/);
  assert.match(script, /dissolveWeeklyChallengeMergeForTask/);
  assert.match(script, /customerKeys/);
  assert.doesNotMatch(script, /taskIds\?\.length!==2/);
});

test('UI documents flexible groups, manual selection, and session dedupe', () => {
  assert.match(html, /每組最多 4 人（包含自己的帳號）/);
  assert.match(html, /只有 2\/4 \+ 2\/4 可以跨帳號合併/);
  assert.match(script, /建立合併組/);
  assert.match(script, /拆除合併/);
  assert.match(script, /new Set\(.*sessionId/s);
});

test('merged groups have transactional start, cancellation, and started cleanup', () => {
  assert.match(script, /async function startMergedWeeklyChallengeGroup/);
  assert.match(script, /🟦 合併解題中/);
  assert.match(script, /此合併組已在解題中/);
  assert.match(script, /startedMembershipRefs/);
  assert.match(script, /transaction\.delete\(startedSessionRef\)/);
});

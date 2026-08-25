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

function mergeHelpers() {
  return Function(`${['getWeeklyChallengeExactCustomerName','getWeeklyChallengePhysicalBuyerKey','buildWeeklyChallengeMergePreview'].map(extractFunction).join(';')}; return { getWeeklyChallengePhysicalBuyerKey, buildWeeklyChallengeMergePreview };`)();
}

const state = (account, names, extra = {}) => ({ account, activeCustomers: names.map((partner, index) => ({ key: JSON.stringify([account, partner]), account, partner, taskIds: [`${account}-${index}`] })), ...extra });

test('physical merge preview dedupes only byte-exact raw buyer names', () => {
  const h = mergeHelpers();
  for (const [left, right, expected] of [['Danny Yi','Danny Yi',1],['Danny Yi','danny yi',2],['Danny Yi','Danny  Yi',2],['Danny Yi','Danny Yi ',2]]) {
    assert.equal(h.buildWeeklyChallengeMergePreview([state('A',[left]),state('B',[right])]).buyerCount, expected);
  }
});

test('merge preview supports shared buyers, under-full groups, and rejects over four', () => {
  const h = mergeHelpers();
  let preview = h.buildWeeklyChallengeMergePreview([state('A',['Danny']),state('B',['Danny','林羿顥'])]);
  assert.deepEqual({buyerCount:preview.buyerCount,selfCount:preview.selfCount,peopleCount:preview.peopleCount,missingPeople:preview.missingPeople,canMerge:preview.canMerge,sharedBuyerNames:preview.sharedBuyerNames},{buyerCount:2,selfCount:2,peopleCount:4,missingPeople:0,canMerge:true,sharedBuyerNames:['Danny']});
  preview = h.buildWeeklyChallengeMergePreview([state('A',['Danny','Alice']),state('B',['Danny','Alice'])]);
  assert.equal(preview.peopleCount,4); assert.equal(preview.canMerge,true);
  preview = h.buildWeeklyChallengeMergePreview([state('A',['Danny']),state('B',['Danny'])]);
  assert.equal(preview.peopleCount,3); assert.equal(preview.missingPeople,1); assert.equal(preview.canMerge,true);
  preview = h.buildWeeklyChallengeMergePreview([state('A',['Danny']),state('B',['Alice'])]);
  assert.equal(preview.peopleCount,4); assert.equal(preview.canMerge,true);
  preview = h.buildWeeklyChallengeMergePreview([state('A',['Danny','Alice']),state('B',['Danny','Bob'])]);
  assert.equal(preview.peopleCount,5); assert.equal(preview.canMerge,false); assert.equal(preview.reason,'合併後會超過 4 人，無法建立合併組');
  for (const extra of [{started:true},{completed:true},{merged:true}]) assert.equal(h.buildWeeklyChallengeMergePreview([state('A',['Danny'],extra),state('B',['Danny'])]).canMerge,false);
  assert.equal(h.buildWeeklyChallengeMergePreview([state('A',['Danny','Alice','Bob']),state('B',['Danny'])]).canMerge,false);
});

test('merge storage uses full-account deterministic locks and one listener', () => {
  assert.match(script, /function getWeeklyChallengeMergeMembershipKey/);
  assert.match(script, /weeklyChallengeMergeMemberships/);
  assert.equal((script.match(/onSnapshot\(collection\(db, "weeklyChallengeMergeGroups"\)/g) || []).length, 1);
  assert.notEqual(JSON.stringify(['abcdef111111']), JSON.stringify(['abcdef222222']));
});

test('manual merge lifecycle is transactional and never automatic', () => {
  assert.match(script, /selectedWeeklyMergeAccounts = new Set/);
  assert.match(script, /selectedWeeklyMergeAccounts\.size >= 2/);
  assert.match(script, /請選擇 2 個帳號/);
  assert.match(script, /async function createWeeklyChallengeMergeGroup/);
  assert.match(script, /async function dismantleWeeklyChallengeMergeGroup/);
  assert.match(script, /async function completeMergedWeeklyChallengeGroup/);
  assert.doesNotMatch(script, /auto.*Weekly.*Merge/i);
});

test('merged completion shares a session and performs complete cleanup', () => {
  assert.match(script, /type:\s*'merged',groupId,accounts,customerIdentityVersion:WEEKLY_CUSTOMER_IDENTITY_VERSION,customerKeys,taskIds/);
  assert.match(script, /mode:\s*'merged'/);
  assert.doesNotMatch(extractFunction('completeMergedWeeklyChallengeGroup'), /peopleCount:\s*4/);
  assert.doesNotMatch(extractFunction('completeMergedWeeklyChallengeGroup'), /missingPeopleAtCompletion:\s*0/);
  assert.match(script, /transaction\.delete\(groupRef\)/);
  assert.match(script, /dissolveWeeklyChallengeMergeForTask/);
  assert.match(script, /customerKeys/);
  assert.doesNotMatch(script, /taskIds\?\.length!==2/);
  assert.match(script, /WEEKLY_CUSTOMER_IDENTITY_VERSION\s*=\s*'raw-exact-v1'/);
  assert.match(script, /customerIdentityVersion:\s*WEEKLY_CUSTOMER_IDENTITY_VERSION/);
  const creation = extractFunction('createWeeklyChallengeMergeGroup');
  assert.match(creation, /preview\.customers\.map\(customer => customer\.key\)/);
  assert.match(creation, /physicalBuyerNames:verifiedPreview\.uniqueBuyerNames/);
  assert.doesNotMatch(creation, /activeCustomers\[0\]/);
  for (const lifecycle of ['startMergedWeeklyChallengeGroup','completeMergedWeeklyChallengeGroup']) {
    const source = extractFunction(lifecycle);
    assert.match(source, /buildWeeklyChallengeMergePreview/);
    assert.doesNotMatch(source, /customerKeys\.length!==2|customers\.length!==2/);
  }
  assert.match(extractFunction('completeMergedWeeklyChallengeGroup'), /taskRefs\.forEach\(ref=>transaction\.delete\(ref\)\)/);
});

test('legacy sessions and merges derive exact identity from referenced tasks', () => {
  assert.match(script, /function getWeeklyChallengeRecordCustomerKeys/);
  assert.match(script, /record\?\.customerIdentityVersion\s*===\s*WEEKLY_CUSTOMER_IDENTITY_VERSION/);
  assert.match(script, /groupWeeklyChallengeTasksByCustomer\(referencedTasks\)/);
  assert.match(script, /客人名稱比對規則已更新，請重新開始或重新建立合併組/);
});

test('UI documents flexible groups, manual selection, and session dedupe', () => {
  assert.match(html, /每組最多 4 人（包含自己的帳號）/);
  assert.doesNotMatch(html, /只有 2\/4 \+ 2\/4 可以跨帳號合併/);
  assert.match(html, /跨帳號合併最多4人，同名買家只算1人/);
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

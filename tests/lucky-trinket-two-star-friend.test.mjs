import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';
function extract(name) { const start=script.indexOf(`function ${name}(`); assert.notEqual(start,-1); const open=script.indexOf('{',start); let depth=0; for(let i=open;i<script.length;i++){if(script[i]==='{')depth++;if(script[i]==='}')depth--;if(!depth)return script.slice(start,i+1);} }
const helpers=(names, result)=>Function(`${names.map(extract).join(';')};return ${result}`)();

test('two-star identity is exact account, partner, and cycle',()=>{
 const h=helpers(['normalizeLuckyTrinket','tradeNeedsWeeklyChallenge','getLuckyTrinketTwoStarFriendKey','getLuckyTrinketTwoStarFriendDocumentId','isLuckyTrinketTwoStarFriend','tradeNeedsWeeklyChallengeForPair'],'{getLuckyTrinketTwoStarFriendDocumentId,tradeNeedsWeeklyChallengeForPair}');
 const map=new Map([[h.getLuckyTrinketTwoStarFriendDocumentId('A','Danny','X'),{}]]);
 assert.equal(h.tradeNeedsWeeklyChallengeForPair({account:'A',partner:'Danny',luckyTrinket:'buyer',luckyTrinketCycleId:'X'},map),false);
 for(const item of [{account:'B',partner:'Danny',luckyTrinket:'buyer',luckyTrinketCycleId:'X'},{account:'A',partner:'Rey',luckyTrinket:'seller',luckyTrinketCycleId:'X'},{account:'A',partner:'Danny',luckyTrinket:'seller',luckyTrinketCycleId:'Y'}]) assert.equal(h.tradeNeedsWeeklyChallengeForPair(item,map),true);
 assert.equal(h.tradeNeedsWeeklyChallengeForPair({account:'A',partner:'Danny',luckyTrinket:null,luckyTrinketCycleId:'X'},map),false);
});

test('runtime transactions consult exemption and persist cycle for buyer and seller',()=>{
 assert.match(script,/collection\(db, "luckyTrinketTwoStarFriends"\)/);
 assert.match(script,/selectedLuckyTrinket === 'buyer'[\s\S]*?getLuckyTrinketTwoStarFriendRef\(accountName, partner, cycle\.id\)[\s\S]*?if \(!exemptionSnapshot\.exists\(\)\) transaction\.set\(taskRef/);
 assert.match(script,/selectedLuckyTrinket === 'seller'[\s\S]*?getLuckyTrinketTwoStarFriendRef\(accountName, partner, cycle\.id\)[\s\S]*?if \(!exemptionSnapshot\.exists\(\)\) transaction\.set\(taskRef/);
 assert.match(script,/luckyTrinketTwoStarFriendCycleId: exemptionSnapshot\.exists\(\) \? cycle\.id/);
});

test('single and merged completion write deterministic pair-cycle qualifications',()=>{
 for(const name of ['completeWeeklyChallengeGroup','completeMergedWeeklyChallengeGroup']) {
  const source=extract(name); assert.match(source,/qualifiedPairs=new Map/); assert.match(source,/source:'weekly-challenge-completion'/); assert.match(source,/getLuckyTrinketTwoStarFriendRef/);
 }
});

test('edit recalculates and cleans stale task state in its transaction',()=>{
 const source=extract('updateLuckyTrinketTrade');
 assert.match(source,/exemptionSnapshot = exemptionRef \? await transaction\.get/);
 assert.match(source,/customerIdentityChanged \|\| !willNeedWeekly/);
 assert.match(source,/dissolveWeeklyChallengeMergeForTask/);
 assert.match(source,/if \(taskSnapshot\.exists\(\)\) transaction\.delete\(taskRef\)/);
 assert.match(source,/else transaction\.set\(taskRef/);
});

test('backfill only uses completed inventory with an explicit cycle and is deterministic',()=>{
 const source=extract('reconcileLegacyLuckyTrinketTwoStarFriends');
 assert.match(source,/item\.weeklyChallengeCompletedAt/); assert.match(source,/item\.luckyTrinketCycleId/); assert.match(source,/new Map/); assert.match(source,/if \(!existing\.exists\(\)\)/);
});

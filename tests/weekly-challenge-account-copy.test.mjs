import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

function extractFunction(name) {
    const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\(`);
    const match = marker.exec(script);
    assert.ok(match, `missing ${name}`);
    const start = match.index;
    const bodyStart = script.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < script.length; index += 1) {
        if (script[index] === '{') depth += 1;
        if (script[index] === '}') depth -= 1;
        if (depth === 0) return script.slice(start, index + 1);
    }
    throw new Error(`unterminated ${name}`);
}

test('weekly account display is first-six while copy text remains exact', () => {
    const baseDisplaySource = extractFunction('getLuckyTrinketAccountDisplayName');
    const displaySource = extractFunction('getWeeklyChallengeAccountDisplayName');
    const copySource = extractFunction('getWeeklyChallengeAccountCopyText');
    const helpers = Function(`${baseDisplaySource};${displaySource};${copySource};return { getWeeklyChallengeAccountDisplayName, getWeeklyChallengeAccountCopyText };`)();
    const first = 'abcdef111111;PasswordA';
    const second = 'abcdef222222;PasswordB';

    assert.equal(helpers.getWeeklyChallengeAccountDisplayName('la542657lh;Bestpoke27@'), 'la5426');
    assert.equal(helpers.getWeeklyChallengeAccountCopyText('la542657lh;Bestpoke27@'), 'la542657lh;Bestpoke27@');
    assert.equal(helpers.getWeeklyChallengeAccountCopyText('user name;P@ss word!'), 'user name;P@ss word!');
    assert.equal(helpers.getWeeklyChallengeAccountDisplayName(first), 'abcdef');
    assert.equal(helpers.getWeeklyChallengeAccountDisplayName(second), 'abcdef');
    assert.equal(helpers.getWeeklyChallengeAccountCopyText(first), first);
    assert.equal(helpers.getWeeklyChallengeAccountCopyText(second), second);
    assert.match(copySource, /return String\(account \?\? ''\)/);
    assert.doesNotMatch(copySource, /slice|trim|toLowerCase|toUpperCase|normalize|replace|split/);
});

test('account header creates an accessible closure-backed copy button without credential attributes', () => {
    const header = extractFunction('createWeeklyChallengeAccountHeader');
    assert.match(header, /getWeeklyChallengeAccountDisplayName\(account\)/);
    assert.match(header, /heading\.textContent\s*=\s*`【\$\{displayName\}】`/);
    assert.match(header, /self\.textContent\s*=\s*`👤 自己｜\$\{displayName\}`/);
    assert.match(header, /copyButton\.type\s*=\s*'button'/);
    assert.match(header, /copyButton\.textContent\s*=\s*'複製帳密'/);
    assert.match(header, /copyButton\.setAttribute\('aria-label',\s*'複製完整帳號密碼'\)/);
    assert.match(header, /copyButton\.addEventListener\('click',\s*\(\)\s*=>\s*\{?\s*copyWeeklyChallengeAccountCredentials\(account,\s*copyButton\)/);
    assert.doesNotMatch(header, /dataset|\.title|\.id|\.value|\.name|innerHTML|onclick|href/);
    assert.doesNotMatch(header, /setDoc|updateDoc|addDoc|writeBatch|runTransaction|deleteDoc/);
});

test('credential copy uses Clipboard API with busy and safe feedback states only', () => {
    const copy = extractFunction('copyWeeklyChallengeAccountCredentials');
    assert.match(copy, /const fullAccount\s*=\s*getWeeklyChallengeAccountCopyText\(account\)/);
    assert.match(copy, /navigator\.clipboard\?\.writeText/);
    assert.match(copy, /await navigator\.clipboard\.writeText\(fullAccount\)/);
    assert.doesNotMatch(copy, /writeText\([^)]*(?:DisplayName|slice)/);
    assert.match(copy, /找不到完整帳號密碼/);
    assert.match(copy, /已複製/);
    assert.match(copy, /複製失敗，請再試一次/);
    assert.match(copy, /button\.disabled\s*=\s*true/);
    assert.match(copy, /button\.isConnected/);
    assert.doesNotMatch(copy, /createElement\(['"]textarea['"]\)|execCommand\(['"]copy['"]\)/);
    assert.doesNotMatch(copy, /setDoc|updateDoc|addDoc|writeBatch|runTransaction|deleteDoc/);
});

test('standalone and both merged account paths share the weekly header helper', () => {
    const render = extractFunction('renderWeeklyChallenge');
    assert.match(render, /\(group\.accounts \|\| \[\]\)[\s\S]*?createWeeklyChallengeAccountHeader\(account\)/);
    assert.match(render, /states\.filter[\s\S]*?createWeeklyChallengeAccountHeader\(state\.account\)/);
    assert.doesNotMatch(render, /account\.slice\(0,\s*6\)|state\.account\.slice\(0,\s*6\)/);
});

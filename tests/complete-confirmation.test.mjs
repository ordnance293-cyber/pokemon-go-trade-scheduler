import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);

assert.ok(moduleMatch, 'index.html should contain one inline module script');
const moduleScript = moduleMatch[1];

test('inline module remains valid JavaScript', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'pokemon-trade-test-'));
    const modulePath = join(tempDirectory, 'index-module.mjs');

    try {
        writeFileSync(modulePath, moduleScript, 'utf8');
        execFileSync(process.execPath, ['--check', modulePath], {
            encoding: 'utf8',
            stdio: 'pipe'
        });
    } finally {
        rmSync(tempDirectory, { recursive: true, force: true });
    }
});

test('trading completion button opens the custom confirmation modal', () => {
    assert.match(html, /id="completeModal"/);
    assert.match(html, /id="completePokemonName"/);
    assert.match(html, /id="cancelCompleteBtn"/);
    assert.match(html, /id="confirmCompleteBtn"/);
    assert.match(
        html,
        /onclick="openCompleteConfirmation\('\$\{p\.id\}'\)"/
    );

    const tradingBranch = html.match(
        /} else if \(p\.status === 'trading'\) \{([\s\S]*?)} else if \(p\.status === 'done'\)/
    );

    assert.ok(tradingBranch, 'trading card rendering branch should exist');
    assert.doesNotMatch(
        tradingBranch[1],
        /onclick="updateStatus\([^\n]*'done'\)"/,
        'the card must not complete the trade directly'
    );
});

test('opening confirmation validates the current item and displays its name safely', () => {
    assert.match(
        moduleScript,
        /window\.openCompleteConfirmation = \(id\) => \{[\s\S]*?pokemons\.find\(p => p\.id === id\)[\s\S]*?item\.status !== 'trading'[\s\S]*?completePokemonName\.textContent = item\.name \|\| '此寶可夢';[\s\S]*?pendingCompleteId = item\.id;[\s\S]*?completeModal\.classList\.remove\('hidden'\);[\s\S]*?\};/
    );
});

test('cancel and backdrop clicks only close the confirmation modal', () => {
    assert.match(
        moduleScript,
        /cancelCompleteBtn\.addEventListener\('click', requestCloseCompleteModal\);/
    );
    assert.match(
        moduleScript,
        /completeModal\.addEventListener\('click', \(event\) => \{[\s\S]*?event\.target === completeModal[\s\S]*?requestCloseCompleteModal\(\);[\s\S]*?\}\);/
    );
});

test('confirmation prevents duplicate submission and completes only after approval', () => {
    assert.match(
        moduleScript,
        /confirmCompleteBtn\.addEventListener\('click', async \(\) => \{[\s\S]*?if \(isCompleting \|\| !pendingCompleteId\) return;[\s\S]*?item\.status !== 'trading'[\s\S]*?setCompleteModalBusy\(true\);[\s\S]*?await window\.updateStatus\(item\.id, 'done'\);[\s\S]*?hideCompleteModal\(\);[\s\S]*?setCompleteModalBusy\(false\);[\s\S]*?\}\);/
    );
});

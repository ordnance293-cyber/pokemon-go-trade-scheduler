import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

assert.ok(moduleScript, 'index.html should contain an inline module script');

test('completion checks Firestore for exactly stock and trading inventory', () => {
    const cleanupFunction = moduleScript.match(
        /async function removeAccountIfNoActiveInventory\(accountName\) \{([\s\S]*?)\n        \}/
    );

    assert.ok(cleanupFunction, 'account cleanup helper should exist');
    assert.match(cleanupFunction[1], /collection\(db, "inventory"\)/);
    assert.match(cleanupFunction[1], /where\("account", "==", accountName\)/);
    assert.match(cleanupFunction[1], /\['stock', 'trading'\]\.includes\(inventoryDoc\.data\(\)\.status\)/);
    assert.match(cleanupFunction[1], /if \(hasActiveInventory\) return;/);
});

test('cleanup deletes only matching account documents and preserves inventory', () => {
    assert.match(moduleScript, /collection\(db, "accounts"\),\s*where\("name", "==", accountName\)/);
    assert.match(moduleScript, /deleteDoc\(doc\(db, "accounts", accountDoc\.id\)\)/);

    const cleanupFunction = moduleScript.match(
        /async function removeAccountIfNoActiveInventory\(accountName\) \{([\s\S]*?)\n        \}/
    );
    assert.doesNotMatch(cleanupFunction[1], /deleteDoc\(doc\(db, "inventory"/);
});

test('account cleanup runs only after a successful done update', () => {
    assert.match(
        moduleScript,
        /await updateDoc\(doc\(db, "inventory", id\), updates\);\s*if \(status === 'done' && item\) \{\s*await removeAccountIfNoActiveInventory\(item\.account\);/
    );
});

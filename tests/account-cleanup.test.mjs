import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

assert.ok(moduleScript, 'index.html should contain an inline module script');

const activeStatusFunction = moduleScript.match(
    /function isActiveInventoryStatus\(status\) \{([\s\S]*?)\n        \}/
);

assert.ok(activeStatusFunction, 'active inventory status helper should exist');
const isActiveInventoryStatus = new Function(
    'status',
    activeStatusFunction[1]
);

const hasActiveInventoryFunction = moduleScript.match(
    /function hasActiveInventory\(items\) \{([\s\S]*?)\n        \}/
);

assert.ok(hasActiveInventoryFunction, 'active inventory helper should exist');
const hasActiveInventory = new Function(
    'isActiveInventoryStatus',
    `return function (items) {${hasActiveInventoryFunction[1]}};`
)(isActiveInventoryStatus);

test('only stock and trading are active inventory statuses', () => {
    assert.equal(isActiveInventoryStatus('stock'), true);
    assert.equal(isActiveInventoryStatus('trading'), true);
    assert.equal(isActiveInventoryStatus('done'), false);
    assert.equal(isActiveInventoryStatus('pending'), false);
    assert.equal(isActiveInventoryStatus(undefined), false);
});

test('stock remaining keeps the account registered', () => {
    assert.equal(hasActiveInventory([
        { status: 'done' },
        { status: 'stock' }
    ]), true);
});

test('another trade remaining keeps the account registered', () => {
    assert.equal(hasActiveInventory([
        { status: 'done' },
        { status: 'trading' }
    ]), true);
});

test('only completed records allow account removal', () => {
    assert.equal(hasActiveInventory([
        { status: 'done' },
        { status: 'done' }
    ]), false);
});

test('completion checks Firestore for exactly stock and trading inventory', () => {
    const cleanupFunction = moduleScript.match(
        /async function removeAccountIfNoActiveInventory\(accountName\) \{([\s\S]*?)\n        \}/
    );

    assert.ok(cleanupFunction, 'account cleanup helper should exist');
    assert.match(cleanupFunction[1], /collection\(db, "inventory"\)/);
    assert.match(cleanupFunction[1], /where\("account", "==", accountName\)/);
    assert.match(cleanupFunction[1], /hasActiveInventory\([\s\S]*?accountInventory\.docs\.map\(inventoryDoc => inventoryDoc\.data\(\)\)/);
    assert.match(cleanupFunction[1], /if \(accountHasActiveInventory\) return;/);
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

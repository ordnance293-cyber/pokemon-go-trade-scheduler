# Stock Copy Fire Prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every generated non-empty 「現貨文案」 item line begin with exactly `🔥 ` while preserving all existing grouping, quantity, stock-count, empty-state, and clipboard behavior.

**Architecture:** Keep the existing single-file UI and its current stock grouping loop. Add the exact prefix only at final line assembly in `index.html`, and extend the focused Node test file with source-level assertions that distinguish `🔥 ` from the current incorrect `🔥` without a space.

**Tech Stack:** HTML, browser JavaScript, Firebase Firestore, Node.js built-in `node:test` and `node:assert/strict`.

## Global Constraints

- Prefix every non-empty stock item line with exactly `🔥 ` (fire emoji followed by one normal space).
- Do not change inventory cards, displayed Pokémon names, or Firestore inventory data.
- Do not change grouping rules or year / color / back-card formatting.
- Do not change total stock count behavior.
- Keep `（現貨X隻）` only when quantity is greater than 1.
- Keep the empty-stock message exactly `目前無現貨寶可夢。` without a fire prefix.
- Keep clipboard behavior copying the textarea value unchanged.
- Do not change scheduling, trading, completion, search, or account behavior.

---

### Task 1: Lock the exact stock-copy prefix with a focused regression test

**Files:**
- Modify: `tests/inventory-color-and-stock-count.test.mjs`
- Read-only reference: `index.html` stock-copy generation block near the `generateCopyBtn` click handler

**Interfaces:**
- Consumes: the existing `moduleScript` string extracted from `index.html` by the test file.
- Produces: a regression test proving both quantity branches use the exact `🔥 ` prefix and the empty-state string remains unchanged.

- [ ] **Step 1: Write the failing test**

Append a focused test using the existing `moduleScript` variable:

```js
test('stock copy lines use fire emoji followed by exactly one space', () => {
    assert.match(moduleScript, /text \+= `🔥 \$\{label\}\\n`/);
    assert.match(moduleScript, /text \+= `🔥 \$\{label\}（現貨\$\{quantity\}隻）\\n`/);
    assert.doesNotMatch(moduleScript, /text \+= `🔥\$\{label\}/);
    assert.match(moduleScript, /if \(!text\) text = "目前無現貨寶可夢。"/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/inventory-color-and-stock-count.test.mjs
```

Expected: FAIL because current PR code uses `🔥${label}` without the required normal space.

- [ ] **Step 3: Commit the regression test**

```bash
git add tests/inventory-color-and-stock-count.test.mjs
git commit -m "test: require spaced fire prefix in stock copy"
```

### Task 2: Add the required one-space prefix in the generated stock copy

**Files:**
- Modify: `index.html` in the `generateCopyBtn` click handler, inside the existing `for (const { label, quantity } of groups.values())` loop
- Test: `tests/inventory-color-and-stock-count.test.mjs`

**Interfaces:**
- Consumes: existing `label` and `quantity` values produced by the current grouping logic.
- Produces: textarea text where quantity-1 lines are `🔥 ${label}` and quantity-greater-than-1 lines are `🔥 ${label}（現貨${quantity}隻）`.

- [ ] **Step 1: Make the minimal implementation change**

Change only the two line-assembly expressions:

```js
if (quantity === 1) {
    text += `🔥 ${label}\n`;
} else {
    text += `🔥 ${label}（現貨${quantity}隻）\n`;
}
```

Leave the existing grouping loop, quantity rules, `text.trim()`, empty-state fallback, stock count, and clipboard handler unchanged.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/inventory-color-and-stock-count.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the full repository test suite**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 4: Commit the implementation**

```bash
git add index.html
git commit -m "fix: space fire prefix in stock copy"
```

### Task 3: Verify PR #15 scope before handoff

**Files:**
- Verify only: `index.html`
- Verify only: `tests/inventory-color-and-stock-count.test.mjs`
- Verify only: `docs/superpowers/specs/2026-08-12-stock-copy-fire-prefix-design.md`
- Verify only: `docs/superpowers/plans/2026-08-12-stock-copy-fire-prefix.md`

**Interfaces:**
- Consumes: completed branch `codex/add-fire-prefix-to-stock-copy`.
- Produces: a verified, unmerged PR #15 ready for user review/merge.

- [ ] **Step 1: Compare the branch against `main`**

```bash
git diff main...HEAD -- index.html tests/inventory-color-and-stock-count.test.mjs docs/superpowers/specs/2026-08-12-stock-copy-fire-prefix-design.md docs/superpowers/plans/2026-08-12-stock-copy-fire-prefix.md
```

Expected functional diff: only the stock-copy prefix spacing plus the focused regression test; documentation files describe the same scope.

- [ ] **Step 2: Verify PR state and CI**

Confirm PR #15 remains open and unmerged, then verify the latest head commit checks complete successfully.

- [ ] **Step 3: Handoff without merging**

Report the final branch/head SHA, files changed, exact generated format, test results, and PR #15 status. Do not merge the pull request.

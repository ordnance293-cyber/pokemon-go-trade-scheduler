# 完成交換前確認視窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 點擊待交換卡片的「完成」後，必須先通過自訂確認視窗，確認後才寫入完成狀態。

**Architecture:** 保留單一 `index.html` 架構，在既有交易與文案視窗旁新增完成確認視窗。以一個待確認項目 ID 與一個送出中旗標管理狀態，確認按鈕重用既有 `window.updateStatus(id, 'done')`，因此 Firestore 寫入、完成時間與排程遞補邏輯不重複實作。

**Tech Stack:** HTML、Tailwind CSS CDN、原生 JavaScript ES module、Firebase Firestore、Node.js built-in test runner。

## Global Constraints

- 不改動 Firebase 設定與 Firestore collection 名稱。
- 完成時仍寫入 `{ status: 'done', completedAt: Date.now() }`。
- 完成成功後仍依既有流程重新排列同帳號待交換排程。
- 不影響恢復在庫、刪除、安排交換、搜尋、排序及文案功能。
- 確認視窗必須使用自訂頁面樣式，不使用瀏覽器原生 `confirm()`。
- 取消或點擊遮罩只能關閉視窗，不得觸發 Firestore 更新。
- 送出期間必須阻止重複確認。

---

### Task 1: 建立完成確認流程的回歸測試

**Files:**
- Create: `tests/complete-confirmation.test.mjs`
- Create: `.github/workflows/complete-confirmation-tests.yml`

**Interfaces:**
- Consumes: `index.html` 的自訂視窗 markup 與 inline module script。
- Produces: `node --test tests/complete-confirmation.test.mjs`，驗證完成按鈕入口、視窗元素、狀態驗證、重複送出防護及 JavaScript 語法。

- [ ] **Step 1: 建立會先失敗的測試**

測試必須讀取實際 `index.html`，並要求以下內容存在：

```javascript
assert.match(html, /id="completeModal"/);
assert.match(html, /onclick="openCompleteConfirmation\('\$\{p\.id\}'\)"/);
assert.match(moduleScript, /if \(isCompleting \|\| !pendingCompleteId\) return;/);
assert.match(moduleScript, /await window\.updateStatus\(item\.id, 'done'\);/);
```

另外將 inline module script 寫入暫存 `.mjs`，執行：

```bash
node --check /tmp/pokemon-go-trade-scheduler-module.mjs
```

- [ ] **Step 2: 執行測試並確認因功能尚未實作而失敗**

Run:

```bash
node --test tests/complete-confirmation.test.mjs
```

Expected: FAIL，原因為 `completeModal` 或 `openCompleteConfirmation` 尚不存在；語法檢查仍應通過。

- [ ] **Step 3: 提交測試與 CI workflow**

```bash
git add tests/complete-confirmation.test.mjs .github/workflows/complete-confirmation-tests.yml
git commit -m "test: cover completion confirmation flow"
```

---

### Task 2: 實作自訂完成確認視窗

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `pokemons` snapshot、既有 `window.updateStatus(id, status)`。
- Produces: `window.openCompleteConfirmation(id)`、`hideCompleteModal()`、`requestCloseCompleteModal()`、`setCompleteModalBusy(busy)`。

- [ ] **Step 1: 新增視窗 markup**

在 `copyModal` 前新增：

```html
<div id="completeModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
    <div class="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-[320px] text-center">
        <h2 class="text-xl font-black text-gray-800 tracking-tight">確認完成交換</h2>
        <p class="text-sm text-gray-500 font-bold mt-3 leading-relaxed">確定已完成「<span id="completePokemonName" class="text-gray-800"></span>」的交換嗎？</p>
        <div class="flex gap-2 mt-5">
            <button id="cancelCompleteBtn" type="button" class="flex-1 py-2 text-gray-400 font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed">取消</button>
            <button id="confirmCompleteBtn" type="button" class="flex-[2] bg-green-600 text-white py-2 rounded-2xl font-bold hover:bg-green-700 active:scale-95 shadow-md text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">確認完成</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: 將卡片完成按鈕改為只開啟視窗**

將：

```html
onclick="updateStatus('${p.id}', 'done')"
```

改為：

```html
onclick="openCompleteConfirmation('${p.id}')"
```

- [ ] **Step 3: 新增視窗狀態與開關函式**

新增待確認 ID、送出中旗標與 DOM references。`window.openCompleteConfirmation(id)` 必須確認項目存在且 `status === 'trading'`，使用 `textContent` 顯示名稱，避免 HTML 注入。

- [ ] **Step 4: 新增取消與遮罩關閉行為**

`cancelCompleteBtn` 與 `event.target === completeModal` 時呼叫 `requestCloseCompleteModal()`；送出中不可關閉。

- [ ] **Step 5: 新增確認送出行為**

確認 handler 必須：

```javascript
if (isCompleting || !pendingCompleteId) return;
```

再次驗證項目仍為 `trading`，停用按鈕後執行：

```javascript
await window.updateStatus(item.id, 'done');
```

成功後清除狀態並關閉；失敗時保留視窗、顯示錯誤並恢復按鈕。

- [ ] **Step 6: 執行測試並確認通過**

Run:

```bash
node --test tests/complete-confirmation.test.mjs
```

Expected: PASS，所有完成確認流程測試與 inline module 語法檢查通過。

- [ ] **Step 7: 提交實作**

```bash
git add index.html
git commit -m "feat: confirm before completing trades"
```

---

### Task 3: 最終驗證與 PR 檢查

**Files:**
- Verify: `index.html`
- Verify: `tests/complete-confirmation.test.mjs`
- Verify: `.github/workflows/complete-confirmation-tests.yml`

**Interfaces:**
- Consumes: Task 1 與 Task 2 的提交。
- Produces: 僅包含本功能的可合併分支與 Pull Request。

- [ ] **Step 1: 重跑完整測試**

```bash
node --test tests/*.test.mjs
```

Expected: PASS。

- [ ] **Step 2: 檢查分支差異**

確認 `index.html` 只新增確認視窗、狀態管理及完成按鈕入口變更；Firestore 更新內容與排程遞補邏輯維持原樣。

- [ ] **Step 3: 檢查 PR 狀態**

確認 CI 成功、無合併衝突，並在 PR 說明列出取消、遮罩關閉、確認完成與防重複送出行為。

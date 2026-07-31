import { readFileSync, writeFileSync } from 'node:fs';

const indexPath = 'index.html';
let html = readFileSync(indexPath, 'utf8');

function replaceOnce(source, needle, replacement, label) {
    const firstIndex = source.indexOf(needle);
    if (firstIndex === -1) {
        throw new Error(`找不到 ${label} 的修改位置`);
    }

    if (source.indexOf(needle, firstIndex + needle.length) !== -1) {
        throw new Error(`${label} 的修改位置不唯一`);
    }

    return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + needle.length);
}

if (html.includes('id="completeModal"')) {
    console.log('完成確認視窗已存在，不需重複套用。');
    process.exit(0);
}

const copyModalStart = '    <div id="copyModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">';
const completeModal = `    <div id="completeModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
        <div class="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-[320px] text-center">
            <h2 class="text-xl font-black text-gray-800 tracking-tight">確認完成交換</h2>
            <p class="text-sm text-gray-500 font-bold mt-3 leading-relaxed">確定已完成「<span id="completePokemonName" class="text-gray-800"></span>」的交換嗎？</p>
            <div class="flex gap-2 mt-5">
                <button id="cancelCompleteBtn" type="button" class="flex-1 py-2 text-gray-400 font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed">取消</button>
                <button id="confirmCompleteBtn" type="button" class="flex-[2] bg-green-600 text-white py-2 rounded-2xl font-bold hover:bg-green-700 active:scale-95 shadow-md text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">確認完成</button>
            </div>
        </div>
    </div>`;

html = replaceOnce(
    html,
    copyModalStart,
    `${completeModal}\n\n${copyModalStart}`,
    '完成確認視窗'
);

const doneSortReference = "        const doneSortSelect = document.getElementById('doneSortSelect');";
const completionState = `        const completeModal = document.getElementById('completeModal');
        const completePokemonName = document.getElementById('completePokemonName');
        const cancelCompleteBtn = document.getElementById('cancelCompleteBtn');
        const confirmCompleteBtn = document.getElementById('confirmCompleteBtn');
        let pendingCompleteId = null;
        let isCompleting = false;`;

html = replaceOnce(
    html,
    doneSortReference,
    `${doneSortReference}\n${completionState}`,
    '完成確認狀態'
);

const openTradeBlock = `        window.openTrade = (id, accName) => {
            selectedId = id; selectedAccName = accName;
            document.getElementById('targetAccLabel').innerText = \`@\${accName}\`;
            document.getElementById('partnerInput').value = '';
            document.getElementById('tradeModal').classList.remove('hidden');
        };`;

const completionHandlers = `

        function setCompleteModalBusy(busy) {
            isCompleting = busy;
            cancelCompleteBtn.disabled = busy;
            confirmCompleteBtn.disabled = busy;
            confirmCompleteBtn.textContent = busy ? '處理中...' : '確認完成';
        }

        function hideCompleteModal() {
            pendingCompleteId = null;
            completePokemonName.textContent = '';
            completeModal.classList.add('hidden');
        }

        function requestCloseCompleteModal() {
            if (isCompleting) return;
            hideCompleteModal();
        }

        window.openCompleteConfirmation = (id) => {
            if (isCompleting) return;

            const item = pokemons.find(p => p.id === id);
            if (!item || item.status !== 'trading') {
                alert('找不到可完成的交換項目，請重新整理後再試。');
                return;
            }

            completePokemonName.textContent = item.name || '此寶可夢';
            pendingCompleteId = item.id;
            completeModal.classList.remove('hidden');
        };

        cancelCompleteBtn.addEventListener('click', requestCloseCompleteModal);

        completeModal.addEventListener('click', (event) => {
            if (event.target === completeModal) {
                requestCloseCompleteModal();
            }
        });

        confirmCompleteBtn.addEventListener('click', async () => {
            if (isCompleting || !pendingCompleteId) return;

            const item = pokemons.find(p => p.id === pendingCompleteId);
            if (!item || item.status !== 'trading') {
                hideCompleteModal();
                alert('這筆交換已經變更，請重新整理後再試。');
                return;
            }

            setCompleteModalBusy(true);
            try {
                await window.updateStatus(item.id, 'done');
                hideCompleteModal();
            } catch (error) {
                console.error('完成交換失敗：', error);
                alert('完成交換失敗，請檢查網路後再試一次。');
            } finally {
                setCompleteModalBusy(false);
            }
        });`;

html = replaceOnce(
    html,
    openTradeBlock,
    `${openTradeBlock}${completionHandlers}`,
    '完成確認事件處理'
);

const directCompletionAction = "onclick=\"updateStatus('\${p.id}', 'done')\"";
const confirmationAction = "onclick=\"openCompleteConfirmation('\${p.id}')\"";
html = replaceOnce(
    html,
    directCompletionAction,
    confirmationAction,
    '完成按鈕入口'
);

writeFileSync(indexPath, html, 'utf8');
console.log('已套用完成交換確認視窗。');

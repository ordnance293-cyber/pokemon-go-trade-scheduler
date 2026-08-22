import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(moduleScript);

function functionSource(name) {
    const start = moduleScript.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} helper should exist`);
    const brace = moduleScript.indexOf('{', start);
    let depth = 1;
    let end = brace + 1;
    while (depth && end < moduleScript.length) {
        if (moduleScript[end] === '{') depth += 1;
        if (moduleScript[end] === '}') depth -= 1;
        end += 1;
    }
    return moduleScript.slice(start, end);
}

function loadHelpers() {
    const names = ['normalizeLuckyTrinket', 'accountHasLuckyTrinket', 'getLuckyTrinketAccountDisplayName', 'buildStockCopyAccountHeader', 'normalizeColorType', 'normalizeBackCardType', 'formatInventoryMetadata', 'formatInventoryCopyText', 'getInventoryGroupingKey', 'getStockInventoryCount', 'parseCopyPrices', 'buildStockCopyLines', 'getStockCopyPreamble', 'buildFullStockCopyText', 'getCopyPriceResult', 'insertPriceSeparator'];
    const source = names.map(functionSource).join('\n');
    return vm.runInNewContext(`(() => { ${source}; return { ${names.join(',')} }; })()`);
}

test('color type is a shiny-default native select with exact options', () => {
    const select = html.match(/<select[^>]*id="colorTypeSelect"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'colorTypeSelect should be a native select');
    assert.deepEqual(
        [...select[1].matchAll(/<option\s+value="([^"]+)"([^>]*)>([^<]+)<\/option>/g)]
            .map(([, value, attributes, label]) => ({ value, label, selected: /\bselected\b/.test(attributes) })),
        [
            { value: 'normal', label: '普色', selected: false },
            { value: 'shiny', label: '異色', selected: true }
        ]
    );
    for (const oldId of ['normalColorBtn', 'shinyColorBtn', 'colorTypeInput']) {
        assert.doesNotMatch(html, new RegExp(oldId));
    }
    assert.doesNotMatch(moduleScript, /setColorType\s*\(/);
});

test('optimistic add reads and normalizes the native color select', () => {
    assert.match(moduleScript, /const colorType = normalizeColorType\(document\.getElementById\('colorTypeSelect'\)\.value\)/);
});

test('color normalization defaults unknown and legacy values to normal', () => {
    const { normalizeColorType } = loadHelpers();
    assert.equal(normalizeColorType('normal'), 'normal');
    assert.equal(normalizeColorType('shiny'), 'shiny');
    assert.equal(normalizeColorType(undefined), 'normal');
    assert.equal(normalizeColorType('unknown'), 'normal');
});

test('metadata ignores year and includes color then back-card while supporting legacy records', () => {
    const { formatInventoryMetadata } = loadHelpers();
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'normal', backCardType: 'none' }), '普色');
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'shiny', backCardType: 'special' }), '異色 | 特別背卡');
    assert.equal(formatInventoryMetadata({ year: 2026, colorType: 'shiny', backCardType: 'commemorative' }), '異色 | 紀念背卡');
    assert.equal(formatInventoryMetadata({ name: '超夢' }), '普色');
});

test('copy ignores year and puts shiny before back-card while normal and legacy stay clean', () => {
    const { formatInventoryCopyText } = loadHelpers();
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'normal', backCardType: 'none', name: '烈空坐' }), '烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'normal', backCardType: 'special', name: '烈空坐' }), '特別背卡烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'none', name: '烈空坐' }), '異色烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'special', name: '烈空坐' }), '異色特別背卡烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2026, colorType: 'shiny', backCardType: 'commemorative', name: '烈空坐' }), '異色紀念背卡烈空坐');
    assert.equal(formatInventoryCopyText({ year: 2025, colorType: 'shiny', backCardType: 'costume', name: '皮卡丘' }), '異色裝扮皮卡丘');
    const legacy = formatInventoryCopyText({ name: '超夢' });
    assert.equal(legacy, '超夢');
    assert.doesNotMatch(legacy, /普色|異色|2026|26年|undefined/);
});

test('grouping separates variants and normalizes legacy color to normal', () => {
    const { getInventoryGroupingKey } = loadHelpers();
    const base = { year: 2026, backCardType: 'special', name: '烈空坐' };
    assert.notEqual(getInventoryGroupingKey({ ...base, colorType: 'normal' }), getInventoryGroupingKey({ ...base, colorType: 'shiny' }));
    assert.equal(getInventoryGroupingKey(base), getInventoryGroupingKey({ ...base, colorType: 'normal' }));
});

test('stock count counts individual stock records only', () => {
    const { getStockInventoryCount } = loadHelpers();
    assert.equal(getStockInventoryCount([{ status: 'stock' }, { status: 'stock' }, { status: 'trading' }, { status: 'done' }]), 2);
});

test('copy modal count uses the same effective pokemons snapshot', () => {
    assert.match(html, /id="copyStockCount"/);
    const handler = moduleScript.slice(moduleScript.indexOf("document.getElementById('generateCopyBtn').addEventListener"), moduleScript.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.match(handler, /const stockItems = pokemons\.filter\(p => p\.status === 'stock'\)/);
    assert.doesNotMatch(handler, /syncedPokemons/);
    assert.match(handler, /copyStockCount'\)\.textContent = `總庫存：\$\{getStockInventoryCount\(stockItems\)\} 隻`/);
});

test('copy modal shows the fixed sales notice between its stock count and price input', () => {
    const stockCountIndex = html.indexOf('id="copyStockCount"');
    const noticeIndex = html.indexOf('id="copyNoticeBox"');
    const priceInputIndex = html.indexOf('id="copyPriceInput"');
    assert.notEqual(noticeIndex, -1, 'copyNoticeBox should exist');
    assert.ok(stockCountIndex < noticeIndex, 'notice should follow copyStockCount');
    assert.ok(noticeIndex < priceInputIndex, 'notice should precede copyPriceInput');

    const notice = html.match(/<div[^>]*id="copyNoticeBox"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(notice);
    for (const exactText of [
        '出售一些色違裝扮,背卡寶可夢',
        '⚠️ 注意事項',
        '✨ 首飾 +200',
        '✨ 亮晶晶寶可夢 +50',
        '付款方式 ✅Linepay ✅8591實收'
    ]) assert.match(notice, new RegExp(exactText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('stock copy preamble has the exact fixed sales information', () => {
    const { getStockCopyPreamble } = loadHelpers();
    assert.equal(
        getStockCopyPreamble(),
        '出售一些色違裝扮,背卡寶可夢\n\n⚠️ 注意事項\n✨ 首飾 +200\n✨ 亮晶晶寶可夢 +50\n付款方式 ✅Linepay ✅8591實收'
    );
});

test('full stock copy adds one preamble and exactly one blank line before the body', () => {
    const { getStockCopyPreamble, buildFullStockCopyText } = loadHelpers();
    const body = '【帳號前6碼】\n🔥 寶可夢文案';
    const expected = `${getStockCopyPreamble()}\n\n${body}`;
    assert.equal(buildFullStockCopyText(body), expected);
    assert.equal(buildFullStockCopyText(expected), expected);
    assert.equal(buildFullStockCopyText(`\r\n${expected}\r\n`), expected);
    assert.equal(buildFullStockCopyText('  '), getStockCopyPreamble());
    assert.equal(expected.match(/出售一些色違裝扮,背卡寶可夢/g)?.length, 1);
    assert.doesNotMatch(expected, /\n$/);
});

test('priced stock remains body-only and full copy wraps it once when prices are reapplied', () => {
    const { getCopyPriceResult, buildFullStockCopyText } = loadHelpers();
    const groups = [{ account: 'abcdef123456', label: '寶可夢文案', quantity: 1 }];
    const first = getCopyPriceResult(groups, '450', groups).text;
    assert.equal(first, '【abcdef｜🟢 有首飾】\n🔥 寶可夢文案｜1隻450元');
    assert.doesNotMatch(first, /出售一些/);
    assert.equal(
        buildFullStockCopyText(first),
        '出售一些色違裝扮,背卡寶可夢\n\n⚠️ 注意事項\n✨ 首飾 +200\n✨ 亮晶晶寶可夢 +50\n付款方式 ✅Linepay ✅8591實收\n\n【abcdef｜🟢 有首飾】\n🔥 寶可夢文案｜1隻450元'
    );
    const reapplied = buildFullStockCopyText(getCopyPriceResult(groups, '500', groups).text);
    assert.equal(reapplied.match(/出售一些色違裝扮,背卡寶可夢/g)?.length, 1);
    assert.match(reapplied, /🔥 寶可夢文案｜1隻500元$/);
});

test('copy button builds the full clipboard text without mutating the textarea', () => {
    const handler = moduleScript.slice(
        moduleScript.indexOf("document.getElementById('doCopyBtn').addEventListener"),
        moduleScript.indexOf('function setupFilterCopyButton')
    );
    assert.match(handler, /navigator\.clipboard\.writeText\(buildFullStockCopyText\(document\.getElementById\('copyTextarea'\)\.value\)\)/);
    assert.doesNotMatch(handler, /copyTextarea'\)\.value\s*=/);
});

test('stock copy prefixes grouped lines while preserving quantity and the empty message', () => {
    const { buildStockCopyLines } = loadHelpers();
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 1 }]), '🔥 A');
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 2 }]), '🔥 A（現貨2隻）');
    assert.equal(buildStockCopyLines([]), '目前無現貨寶可夢。');
});


test('stock copy grouping key keeps full accounts separate when the displayed prefixes match', () => {
    const { getInventoryGroupingKey } = loadHelpers();
    const variant = { year: 2026, colorType: 'shiny', backCardType: 'none', name: '皮卡丘' };
    assert.notEqual(
        getInventoryGroupingKey({ ...variant, account: 'abcdef111111' }),
        getInventoryGroupingKey({ ...variant, account: 'abcdef222222' })
    );
});

test('stock copy headers use full-history trinket status and display exact six-character format', () => {
    const { buildStockCopyLines } = loadHelpers();
    const groups = [
        { account: 'abcdef111111', label: '異色皮卡丘', quantity: 2 },
        { account: 'xyz789654321', label: '異色夢幻', quantity: 1 },
        { account: 'abcdef111111', label: '異色烈空坐', quantity: 1 },
        { account: 'abcdef222222', label: '異色超夢', quantity: 1 }
    ];
    const inventory = [
        ...groups.map(group => ({ ...group, status: 'stock' })),
        { account: 'xyz789654321', status: 'trading', luckyTrinket: 'seller' },
        { account: 'abcdef111111', status: 'trading', luckyTrinket: 'buyer' }
    ];
    const result = buildStockCopyLines(groups, null, inventory);
    assert.equal(
        result,
        '【abcdef｜🟢 有首飾】\n🔥 異色皮卡丘（現貨2隻）\n🔥 異色烈空坐\n\n【xyz789｜🔴 無首飾】\n🔥 異色夢幻\n\n【abcdef｜🟢 有首飾】\n🔥 異色超夢'
    );
    assert.doesNotMatch(result, /abcdef111111|abcdef222222|xyz789654321/);

    const handler = moduleScript.slice(
        moduleScript.indexOf("document.getElementById('generateCopyBtn').addEventListener"),
        moduleScript.indexOf("document.getElementById('closeCopyModalBtn')")
    );
    assert.match(handler, /account:\s*String\(p\.account \|\| ''\)/);
});

test('account-grouped prices follow displayed Pokemon lines rather than account sections', () => {
    const { getCopyPriceResult } = loadHelpers();
    const groups = [
        { account: 'abcdef111111', label: '異色皮卡丘', quantity: 1 },
        { account: 'xyz789654321', label: '異色夢幻', quantity: 1 },
        { account: 'abcdef111111', label: '異色烈空坐', quantity: 1 }
    ];
    assert.equal(
        getCopyPriceResult(groups, '150 300 200', [{ account: 'xyz789654321', status: 'done', luckyTrinket: 'seller' }]).text,
        '【abcdef｜🟢 有首飾】\n🔥 異色皮卡丘｜1隻150元\n🔥 異色烈空坐｜1隻300元\n\n【xyz789｜🔴 無首飾】\n🔥 異色夢幻｜1隻200元'
    );
    assert.deepEqual(
        { ...getCopyPriceResult(groups, '150 300') },
        { ok: false, message: '需要 3 個價格，目前只有 2 個' }
    );
});

test('stock copy includes stock accounts only while full history controls availability', () => {
    const { buildStockCopyLines } = loadHelpers();
    const stockGroups = [
        { account: 'dfVYS8H0Gp9o2Xi7;Bestmoonvn@2024', label: '異色蓋歐卡', quantity: 1 },
        { account: 'vet085608gg;Bestpoke27@', label: '異色皮卡丘', quantity: 1 }
    ];
    const allItems = [
        ...stockGroups.map(group => ({ ...group, status: 'stock' })),
        { account: stockGroups[0].account, status: 'trading', luckyTrinket: 'buyer' },
        { account: stockGroups[1].account, status: 'trading', luckyTrinket: 'seller' },
        { account: 'savedOnly123', status: 'done', luckyTrinket: 'seller' }
    ];
    const result = buildStockCopyLines(stockGroups, null, allItems);
    assert.equal(result, '【dfVYS8｜🟢 有首飾】\n🔥 異色蓋歐卡\n\n【vet085｜🔴 無首飾】\n🔥 異色皮卡丘');
    assert.doesNotMatch(result, /savedOnly/);
    assert.doesNotMatch(result, /\(|\)|\||dfVYS8H0Gp9o2Xi7|vet085608gg/);
});

test('stock copy preserves chronological group and account-section order with status headers', () => {
    const { buildStockCopyLines } = loadHelpers();
    const chronologicallyGroupedStock = [
        { account: 'olderA123', label: '最早加入', quantity: 1 },
        { account: 'olderA123', label: '同帳號稍晚加入', quantity: 1 },
        { account: 'newerB456', label: '較晚帳號', quantity: 1 }
    ];
    assert.equal(
        buildStockCopyLines(chronologicallyGroupedStock, null, chronologicallyGroupedStock),
        '【olderA｜🟢 有首飾】\n🔥 最早加入\n🔥 同帳號稍晚加入\n\n【newerB｜🟢 有首飾】\n🔥 較晚帳號'
    );
});

test('copy prices accept spaces, commas, and newlines', () => {
    const { parseCopyPrices } = loadHelpers();
    assert.deepEqual(Array.from(parseCopyPrices('450 350 400')), [450, 350, 400]);
    assert.deepEqual(Array.from(parseCopyPrices('450,350,400')), [450, 350, 400]);
    assert.deepEqual(Array.from(parseCopyPrices('450\n350\n400')), [450, 350, 400]);
    for (const invalid of ['abc', '-100', '12.5', '0']) assert.equal(parseCopyPrices(invalid), null);
});

test('copy prices are paired with grouped lines in display order', () => {
    const { buildStockCopyLines } = loadHelpers();
    const groups = [
        { label: 'A', quantity: 1 },
        { label: 'B', quantity: 1 },
        { label: 'C', quantity: 1 }
    ];
    assert.equal(
        buildStockCopyLines(groups, [450, 350, 400]),
        '🔥 A｜1隻450元\n🔥 B｜1隻350元\n🔥 C｜1隻400元'
    );
    assert.equal(buildStockCopyLines([{ label: 'A', quantity: 2 }], [400]), '🔥 A（現貨2隻）｜1隻400元');
});

test('price count mismatch is rejected without producing partial copy', () => {
    const { getCopyPriceResult } = loadHelpers();
    const groups = Array.from({ length: 8 }, (_, index) => ({ label: String(index), quantity: 1 }));
    assert.deepEqual(
        { ...getCopyPriceResult(groups, '1 2 3 4 5 6 7') },
        { ok: false, message: '需要 8 個價格，目前只有 7 個' }
    );
    assert.deepEqual(
        { ...getCopyPriceResult(groups, '1 2 3 4 5 6 7 8 9') },
        { ok: false, message: '需要 8 個價格，目前有 9 個' }
    );
});

test('reapplying prices rebuilds copy from the original groups', () => {
    const { getCopyPriceResult } = loadHelpers();
    const groups = [{ label: 'A', quantity: 1 }];
    assert.equal(getCopyPriceResult(groups, '450').text, '🔥 A｜1隻450元');
    assert.equal(getCopyPriceResult(groups, '500').text, '🔥 A｜1隻500元');
});

test('empty stock rejects prices and keeps the empty stock copy', () => {
    const { buildStockCopyLines, getCopyPriceResult } = loadHelpers();
    assert.equal(buildStockCopyLines([]), '目前無現貨寶可夢。');
    assert.deepEqual(
        { ...getCopyPriceResult([], '400') },
        { ok: false, message: '目前沒有現貨文案可套用價格' }
    );
});

test('copy price controls persist only to the dedicated pricing collection', () => {
    assert.match(html, /id="copyPriceInput"[^>]*inputmode="numeric"/);
    assert.match(html, /id="insertPriceSeparatorBtn"[^>]*type="button"[^>]*>\s*,\s*<\/button>/);
    assert.match(html, /id="applyCopyPricesBtn"[^>]*>批次儲存價格<\/button>/);
    const priceHandler = moduleScript.slice(moduleScript.indexOf("document.getElementById('applyCopyPricesBtn').addEventListener"), moduleScript.indexOf("document.getElementById('closeCopyModalBtn')"));
    assert.match(priceHandler, /writeBatch\(db\)/);
    assert.match(priceHandler, /doc\(db, "stockCopyPrices", encodeURIComponent\(group\.priceKey\)\)/);
    assert.doesNotMatch(priceHandler, /doc\(db, "inventory"|localStorage/);
});

test('price separator inserts at the caret, replaces selections, and restores focus', () => {
    const { insertPriceSeparator } = loadHelpers();
    const makeInput = (value, selectionStart, selectionEnd) => ({
        value,
        selectionStart,
        selectionEnd,
        focused: false,
        setRangeText(replacement, start, end) {
            this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
            this.selectionStart = this.selectionEnd = start + replacement.length;
        },
        focus() { this.focused = true; }
    });

    for (const [value, start, end, expected] of [
        ['450350', 3, 3, '450,350'],
        ['450', 3, 3, '450,'],
        ['450999350', 3, 6, '450,350']
    ]) {
        const input = makeInput(value, start, end);
        insertPriceSeparator(input);
        assert.equal(input.value, expected);
        assert.equal(input.selectionStart, 4);
        assert.equal(input.selectionEnd, 4);
        assert.equal(input.focused, true);
    }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${repoRoot}/index.html`, 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

assert.ok(style, 'index.html should contain an inline style block');
assert.ok(moduleScript, 'index.html should contain an inline module script');

function rulesWithDeclaration(css, declaration) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => body.includes(declaration));
}

function mobileMediaRules(css) {
    const rules = [];
    const mediaPattern = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g;
    let match;

    while ((match = mediaPattern.exec(css)) !== null) {
        let depth = 1;
        let end = mediaPattern.lastIndex;
        for (; end < css.length && depth > 0; end += 1) {
            if (css[end] === '{') depth += 1;
            if (css[end] === '}') depth -= 1;
        }
        rules.push({ maxWidth: Number(match[1]), body: css.slice(mediaPattern.lastIndex, end - 1) });
    }

    return rules;
}

test('viewport remains scalable so two-finger pinch zoom is available', () => {
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"\s*\/?>/i);

    assert.ok(viewport, 'a viewport meta tag should exist');
    assert.match(viewport[1], /(?:^|,)\s*width=device-width\s*(?:,|$)/i);
    assert.match(viewport[1], /(?:^|,)\s*initial-scale=1\.0\s*(?:,|$)/i);
    assert.doesNotMatch(viewport[1], /user-scalable\s*=\s*no/i);
    assert.doesNotMatch(viewport[1], /maximum-scale\s*=\s*1(?:\.0)?(?:\s|,|$)/i);
});

test('interactive controls use touch-action manipulation', () => {
    const manipulationRules = rulesWithDeclaration(style, 'touch-action: manipulation');
    const selectors = manipulationRules.flatMap(([, selectorList]) =>
        selectorList.split(',').map(selector => selector.trim())
    );

    for (const control of ['button', 'a', 'input', 'select', 'textarea']) {
        assert.ok(selectors.includes(control), `${control} should use touch-action: manipulation`);
    }
});

test('mobile form controls use a font size of at least 16px', () => {
    const fontRules = mobileMediaRules(style)
        .filter(({ maxWidth }) => maxWidth <= 767)
        .flatMap(({ body }) => rulesWithDeclaration(body, 'font-size: 16px'));
    const selectors = fontRules.flatMap(([, selectorList]) =>
        selectorList.split(',').map(selector => selector.trim())
    );

    for (const control of ['input', 'select', 'textarea']) {
        assert.ok(selectors.includes(control), `${control} should use a 16px mobile font size`);
    }
});

test('drag items retain their vertical-pan touch behavior', () => {
    assert.match(style, /\.drag-item\s*\{[^}]*touch-action:\s*pan-y\s*;[^}]*\}/);
    assert.doesNotMatch(style, /\.drag-item\s*\{[^}]*touch-action:\s*manipulation\s*;[^}]*\}/);
});

test('JavaScript does not install generic touch or double-click zoom blockers', () => {
    const blockingHandler = /addEventListener\(\s*['"](?:touchstart|touchend|dblclick)['"][\s\S]*?preventDefault\s*\(\s*\)[\s\S]*?\}\s*\)/i;

    assert.doesNotMatch(moduleScript, blockingHandler);
});

import type {
    ObservedElement,
} from '@ai-web-test-engine/core';

/** 页面脚本采集后返回给 Node.js 侧的可交互元素摘要。 */
export type CapturedInteractiveElement = ObservedElement;

export const MAX_INTERACTIVE_ELEMENTS = 200;
export const RUNTIME_CANDIDATE_ATTRIBUTE =
    'data-ai-web-test-candidate';

export const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[aria-haspopup]',
    '[aria-controls]',
    '[style*="cursor" i]',
    '[class*="avatar" i]',
    '[class*="user-head" i]',
    '[class*="portrait" i]',
    '[class*="profile-icon" i]',
    '[class*="account-icon" i]',
    'img',
    'svg'
].join(',');

const SELECTOR_LITERAL = JSON.stringify(INTERACTIVE_SELECTOR);
const CANDIDATE_ATTRIBUTE_LITERAL =
    JSON.stringify(RUNTIME_CANDIDATE_ATTRIBUTE);

/**
 * 以字符串隔离页面内 DOM 采集逻辑，避免 Node 覆盖率插桩污染浏览器执行上下文。
 */
export const INTERACTIVE_ELEMENT_SCRIPT = String.raw`(() => {
    const selector = ${ SELECTOR_LITERAL };
    const candidateAttribute = ${ CANDIDATE_ATTRIBUTE_LITERAL };
    const maxElements = ${ MAX_INTERACTIVE_ELEMENTS };
    const semanticClassPattern = new RegExp([
        '(?:^|[-_])(?:',
        'avatar|portrait|',
        'user[-_](?:avatar|head)|',
        'profile[-_](?:avatar|icon)|',
        'account[-_](?:avatar|icon)',
        ')(?:$|[-_])'
    ].join(''), 'iu');
    const cleanText = (value) => {
        const normalized = value && value.replace(/\s+/gu, ' ').trim();
        return normalized ? normalized.slice(0, 200) : undefined;
    };
    const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            box.width > 0 && box.height > 0;
    };
    const getSemanticClass = (element) => {
        let current = element;
        for (let depth = 0; current && depth < 3; depth += 1) {
            const tokens = String(current.getAttribute('class') || '')
                .split(/\s+/u)
                .filter(Boolean);
            const token = tokens.find((item) => semanticClassPattern.test(item));
            if (token) {
                return token.slice(0, 100);
            }
            current = current.parentElement;
        }
        return undefined;
    };
    const hasNativeInteraction = (element) => element.matches([
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[contenteditable="true"]',
        '[role]',
        '[tabindex]:not([tabindex="-1"])'
    ].join(','));
    const isLikelyInteractive = (element) => {
        if (!isVisible(element)) {
            return false;
        }
        if (hasNativeInteraction(element)) {
            return true;
        }
        if (
            element.hasAttribute('onclick') ||
            element.hasAttribute('aria-haspopup') ||
            element.hasAttribute('aria-controls')
        ) {
            return true;
        }
        const style = window.getComputedStyle(element);
        return style.cursor === 'pointer' || Boolean(getSemanticClass(element));
    };
    const inferRole = (element, likelyInteractive) => {
        const explicitRole = element.getAttribute('role');
        if (explicitRole) {
            return explicitRole;
        }
        const tag = element.tagName.toLowerCase();
        if (tag === 'button') {
            return 'button';
        }
        if (tag === 'a') {
            return 'link';
        }
        if (tag === 'select') {
            return 'combobox';
        }
        if (tag === 'textarea') {
            return 'textbox';
        }
        if (tag !== 'input') {
            return likelyInteractive ? 'button' : undefined;
        }
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            return type;
        }
        return type === 'button' || type === 'submit' ? 'button' : 'textbox';
    };
    const getLabels = (element) => {
        if (!('labels' in element) || !element.labels) {
            return undefined;
        }
        return cleanText(Array.from(element.labels)
            .map((label) => label.innerText)
            .join(' '));
    };
    const getValueState = (element, tag, type) => {
        const hasValue = tag === 'input' || tag === 'textarea' ||
            tag === 'select' || element.isContentEditable;
        if (!hasValue) {
            return undefined;
        }
        const value = 'value' in element
            ? String(element.value || '')
            : element.innerText;
        if (!value) {
            return 'empty';
        }
        return type.toLowerCase() === 'password' ? 'masked' : 'filled';
    };
    const getLocatorHints = (
        id,
        semanticClass,
        tag,
        testId,
        label,
        placeholder,
        role,
        name,
        text
    ) => {
        const hints = [];
        hints.push({ strategy: 'css', value: tag });
        if (id) {
            hints.push({ strategy: 'css', value: '#' + CSS.escape(id) });
        }
        if (semanticClass) {
            hints.push({
                strategy: 'css',
                value: '.' + CSS.escape(semanticClass)
            });
        }
        if (testId) {
            hints.push({ strategy: 'test-id', value: testId });
        }
        if (label) {
            hints.push({ strategy: 'label', value: label });
        }
        if (placeholder) {
            hints.push({ strategy: 'placeholder', value: placeholder });
        }
        if (role && name) {
            hints.push({ strategy: 'role-name', value: role + '|' + name });
        }
        if (text && (role === 'button' || role === 'link')) {
            hints.push({ strategy: 'text', value: text });
        }
        return hints;
    };
    const getRelatedName = (element) => {
        const descendant = element.querySelector(
            '[aria-label], img[alt], [title]'
        );
        const ancestor = element.parentElement?.closest(
            '[aria-label], [title]'
        );
        return cleanText(
            descendant?.getAttribute('aria-label') ||
            descendant?.getAttribute('alt') ||
            descendant?.getAttribute('title') ||
            ancestor?.getAttribute('aria-label') ||
            ancestor?.getAttribute('title')
        );
    };
    const serializeElement = (element, candidateIndex) => {
        const box = element.getBoundingClientRect();
        const visible = isVisible(element);
        if (!visible) {
            return undefined;
        }
        const label = getLabels(element);
        const placeholder = cleanText(element.getAttribute('placeholder'));
        const text = cleanText(element.innerText);
        const semanticClass = getSemanticClass(element);
        const semanticName = semanticClass
            ? semanticClass.replace(/[-_]+/gu, ' ')
            : undefined;
        const name = cleanText(
            element.getAttribute('aria-label') || label ||
            element.getAttribute('alt') || element.getAttribute('title') ||
            placeholder || text || getRelatedName(element) || semanticName
        );
        const role = inferRole(element, true);
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute('type') || '';
        const valueState = getValueState(element, tag, type);
        const testId = element.getAttribute('data-testid') || '';
        const parentText = cleanText(element.parentElement?.innerText);
        const candidateId = 'e' + (candidateIndex + 1);
        element.setAttribute(candidateAttribute, candidateId);
        const attributes = Object.fromEntries([
            ['id', element.id],
            ['name', element.getAttribute('name') || ''],
            ['type', type],
            ['data-testid', testId],
            ['autocomplete', element.getAttribute('autocomplete') || ''],
            ['aria-haspopup', element.getAttribute('aria-haspopup') || ''],
            ['aria-expanded', element.getAttribute('aria-expanded') || ''],
            ['class', semanticClass || '']
        ].filter((entry) => entry[1]));
        return {
            candidateId,
            tag,
            ...(role ? { role } : {}),
            ...(name ? { name } : {}),
            ...(text ? { text } : {}),
            ...(label ? { label } : {}),
            ...(placeholder ? { placeholder } : {}),
            ...(valueState ? { valueState } : {}),
            disabled: 'disabled' in element
                ? Boolean(element.disabled)
                : element.getAttribute('aria-disabled') === 'true',
            ...('checked' in element
                ? { checked: Boolean(element.checked) }
                : {}),
            visible,
            inViewport: box.bottom > 0 && box.right > 0 &&
                box.top < window.innerHeight && box.left < window.innerWidth,
            attributes,
            nearbyText: parentText && parentText !== text ? [parentText] : [],
            boundingBox: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height
            },
            locatorHints: getLocatorHints(
                element.id,
                semanticClass,
                tag,
                testId,
                label,
                placeholder,
                role,
                name,
                text
            )
        };
    };

    document.querySelectorAll('[' + candidateAttribute + ']')
        .forEach((element) => element.removeAttribute(candidateAttribute));
    const interactiveElements = Array.from(document.querySelectorAll(selector))
        .filter(isLikelyInteractive);
    const interactiveSet = new Set(interactiveElements);
    return interactiveElements
        .filter((element) => {
            const tag = element.tagName.toLowerCase();
            if (tag !== 'img' && tag !== 'svg') {
                return true;
            }
            const ancestor = element.parentElement?.closest(selector);
            return !ancestor || !interactiveSet.has(ancestor);
        })
        .slice(0, maxElements)
        .map(serializeElement)
        .filter(Boolean);
})()`;

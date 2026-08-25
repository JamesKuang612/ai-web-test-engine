import type {
    ObservedElement,
} from '@ai-web-test-engine/core';

/** 页面脚本采集后返回给 Node.js 侧的可交互元素摘要。 */
export interface CapturedInteractiveElement extends ObservedElement {
    sourceIndex: number;
}

export const MAX_INTERACTIVE_ELEMENTS = 200;

export const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[role]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

const SELECTOR_LITERAL = JSON.stringify(INTERACTIVE_SELECTOR);

/**
 * 以字符串隔离页面内 DOM 采集逻辑，避免 Node 覆盖率插桩污染浏览器执行上下文。
 */
export const INTERACTIVE_ELEMENT_SCRIPT = String.raw`(() => {
    const selector = ${ SELECTOR_LITERAL };
    const maxElements = ${ MAX_INTERACTIVE_ELEMENTS };
    const cleanText = (value) => {
        const normalized = value && value.replace(/\s+/gu, ' ').trim();
        return normalized ? normalized.slice(0, 200) : undefined;
    };
    const inferRole = (element) => {
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
            return undefined;
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
    const getLocatorHints = (testId, label, placeholder, role, name, text) => {
        const hints = [];
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
    const serializeElement = (element, sourceIndex) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const visible = style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            box.width > 0 && box.height > 0;
        if (!visible) {
            return undefined;
        }
        const label = getLabels(element);
        const placeholder = cleanText(element.getAttribute('placeholder'));
        const text = cleanText(element.innerText);
        const name = cleanText(
            element.getAttribute('aria-label') || label ||
            element.getAttribute('alt') || element.getAttribute('title') ||
            placeholder || text
        );
        const role = inferRole(element);
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute('type') || '';
        const valueState = getValueState(element, tag, type);
        const testId = element.getAttribute('data-testid') || '';
        const parentText = cleanText(element.parentElement?.innerText);
        const attributes = Object.fromEntries([
            ['id', element.id],
            ['name', element.getAttribute('name') || ''],
            ['type', type],
            ['data-testid', testId],
            ['autocomplete', element.getAttribute('autocomplete') || '']
        ].filter((entry) => entry[1]));
        return {
            sourceIndex,
            candidateId: 'e' + (sourceIndex + 1),
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
                testId,
                label,
                placeholder,
                role,
                name,
                text
            )
        };
    };
    return Array.from(document.querySelectorAll(selector))
        .slice(0, maxElements)
        .map(serializeElement)
        .filter(Boolean);
})()`;

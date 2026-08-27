import type {
    ObservedElement,
} from '@ai-web-test-engine/core';
import {
    INTERACTIVE_SELECTOR,
    RUNTIME_CANDIDATE_ATTRIBUTE,
} from './interactive_element_script';

/** 视觉坐标反查 DOM 后返回给 Node.js 的元素摘要。 */
export type CapturedVisualElement = ObservedElement;

/**
 * 创建独立页面脚本，把视觉坐标提升为可由现有 Locator 索引执行的 DOM 候选。
 *
 * 字符串脚本避免测试覆盖率插桩污染 Playwright 的页面执行上下文。
 */
// eslint-disable-next-line max-lines-per-function
export function createVisualElementScript(input: {
    candidateId: string,
    targetDescription: string,
    x: number,
    y: number
}): string {
    const inputLiteral = JSON.stringify(input);
    const selectorLiteral = JSON.stringify(INTERACTIVE_SELECTOR);
    const candidateAttributeLiteral = JSON.stringify(
        RUNTIME_CANDIDATE_ATTRIBUTE
    );

    return String.raw`(() => {
        const input = ${ inputLiteral };
        const interactiveSelector = ${ selectorLiteral };
        const candidateAttribute = ${ candidateAttributeLiteral };
        const runtimeSelector = '[' + candidateAttribute + ']';
        const cleanText = (value) => {
            const normalized = value && String(value)
                .replace(/\s+/gu, ' ')
                .trim();
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
        const isActionable = (element) => {
            if (!isVisible(element)) {
                return false;
            }
            return element.matches(interactiveSelector) ||
                element.hasAttribute('onclick') ||
                window.getComputedStyle(element).cursor === 'pointer';
        };
        const stack = document.elementsFromPoint(input.x, input.y);
        const existing = stack
            .map((element) => element.closest(runtimeSelector))
            .find((element) => element && isVisible(element));
        let target = existing;
        if (!target) {
            for (const element of stack) {
                let current = element;
                while (current && current !== document.body) {
                    if (isActionable(current)) {
                        target = current;
                        break;
                    }
                    current = current.parentElement;
                }
                if (target) {
                    break;
                }
            }
        }
        if (!target) {
            target = stack.find(isVisible);
        }
        if (!target) {
            return null;
        }

        const existingCandidateId = target.getAttribute(candidateAttribute);
        const candidateId = existingCandidateId || input.candidateId;
        target.setAttribute(candidateAttribute, candidateId);
        const box = target.getBoundingClientRect();
        const tag = target.tagName.toLowerCase();
        const type = target.getAttribute('type') || '';
        const label = 'labels' in target && target.labels
            ? cleanText(Array.from(target.labels)
                .map((item) => item.innerText)
                .join(' '))
            : undefined;
        const placeholder = cleanText(target.getAttribute('placeholder'));
        const text = cleanText(target.innerText || target.textContent);
        const related = target.querySelector('[aria-label], img[alt], [title]');
        const name = cleanText(
            target.getAttribute('aria-label') ||
            label ||
            target.getAttribute('alt') ||
            target.getAttribute('title') ||
            placeholder ||
            text ||
            related?.getAttribute('aria-label') ||
            related?.getAttribute('alt') ||
            related?.getAttribute('title')
        );
        const explicitRole = target.getAttribute('role');
        const role = explicitRole ||
            (tag === 'a' ? 'link' : undefined) ||
            (tag === 'input' && ['checkbox', 'radio'].includes(type)
                ? type
                : undefined) ||
            (tag === 'input' || tag === 'textarea'
                ? 'textbox'
                : undefined) ||
            (tag === 'select' ? 'combobox' : undefined) ||
            'button';
        const hasValue = tag === 'input' || tag === 'textarea' ||
            tag === 'select' || target.isContentEditable;
        const rawValue = hasValue
            ? ('value' in target ? String(target.value || '') : target.innerText)
            : '';
        const valueState = hasValue
            ? rawValue
                ? type.toLowerCase() === 'password' ? 'masked' : 'filled'
                : 'empty'
            : undefined;
        const testId = target.getAttribute('data-testid') || '';
        const classTokens = Array.from(target.classList)
            .filter(Boolean)
            .slice(0, 20);
        const locatorHints = [{ strategy: 'css', value: tag }];
        if (target.id) {
            locatorHints.push({
                strategy: 'css',
                value: '#' + CSS.escape(target.id)
            });
        }
        if (testId) {
            locatorHints.push({ strategy: 'test-id', value: testId });
        }
        if (label) {
            locatorHints.push({ strategy: 'label', value: label });
        }
        if (placeholder) {
            locatorHints.push({ strategy: 'placeholder', value: placeholder });
        }
        if (role && name) {
            locatorHints.push({
                strategy: 'role-name',
                value: role + '|' + name
            });
        }
        if (text && (role === 'button' || role === 'link')) {
            locatorHints.push({ strategy: 'text', value: text });
        }
        const uniqueClass = classTokens.find((token) => {
            try {
                return document.querySelectorAll('.' + CSS.escape(token))
                    .length === 1;
            } catch {
                return false;
            }
        });
        if (uniqueClass) {
            locatorHints.push({
                strategy: 'css',
                value: '.' + CSS.escape(uniqueClass)
            });
        }
        const buildCssPath = (element) => {
            const segments = [];
            let current = element;
            while (current && current !== document.body && segments.length < 8) {
                const currentTag = current.tagName.toLowerCase();
                const siblings = current.parentElement
                    ? Array.from(current.parentElement.children)
                        .filter((item) => item.tagName === current.tagName)
                    : [];
                const position = siblings.indexOf(current) + 1;
                segments.unshift(
                    siblings.length > 1
                        ? currentTag + ':nth-of-type(' + position + ')'
                        : currentTag
                );
                current = current.parentElement;
            }
            return 'body > ' + segments.join(' > ');
        };
        const cssPath = buildCssPath(target);
        if (cssPath !== 'body > ') {
            locatorHints.push({ strategy: 'css', value: cssPath });
        }
        const parentText = cleanText(target.parentElement?.innerText);
        const attributes = Object.fromEntries([
            ['id', target.id],
            ['name', target.getAttribute('name') || ''],
            ['type', type],
            ['data-testid', testId],
            ['aria-label', target.getAttribute('aria-label') || ''],
            ['class', classTokens[0] || '']
        ].filter((entry) => entry[1]));

        return {
            candidateId,
            discoverySource: 'vision-assisted',
            visualDescription: input.targetDescription,
            tag,
            ...(role ? { role } : {}),
            ...(name ? { name } : {}),
            ...(text ? { text } : {}),
            ...(label ? { label } : {}),
            ...(placeholder ? { placeholder } : {}),
            ...(valueState ? { valueState } : {}),
            disabled: 'disabled' in target
                ? Boolean(target.disabled)
                : target.getAttribute('aria-disabled') === 'true',
            ...('checked' in target
                ? { checked: Boolean(target.checked) }
                : {}),
            visible: isVisible(target),
            inViewport: box.bottom > 0 && box.right > 0 &&
                box.top < window.innerHeight && box.left < window.innerWidth,
            attributes,
            nearbyText: [
                ...(parentText && parentText !== text ? [parentText] : []),
                input.targetDescription
            ],
            boundingBox: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height
            },
            locatorHints
        };
    })()`;
}

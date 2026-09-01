import {
    createHash,
} from 'node:crypto';
import type {
    JsonValue,
    ModelProtocolDiagnostic,
    ModelProtocolFailureType,
    ModelProtocolSchemaIssue,
    ModelRole,
} from '@ai-web-test-engine/core';

const MAX_RAW_PREVIEW = 4_096;
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 30;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 6;
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|token)/iu;
const RAW_SECRET = /((?:authorization|cookie|password|secret|token)\s*["']?\s*[:=]\s*)[^\s,}\]]+/giu;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;

interface DiagnosticInput {
    modelRole: ModelRole;
    phase: 'initial' | 'repair';
    failureType: ModelProtocolFailureType;
    model?: string;
    requestId?: string;
    rawOutput?: string;
    parsedJson?: unknown;
    schemaIssues?: ModelProtocolSchemaIssue[];
}

/** 在模型/provider 边界完成脱敏与截断，调用方只能看到安全诊断。 */
export function createSafeModelProtocolDiagnostic(
    input: DiagnosticInput
): ModelProtocolDiagnostic {
    let truncated = false;
    const rawOutputPreview = input.rawOutput === undefined
        ? undefined
        : bound(sanitizeText(input.rawOutput), MAX_RAW_PREVIEW, () => {
            truncated = true;
        });
    const parsedJson = input.parsedJson === undefined
        ? undefined
        : sanitizeJson(input.parsedJson, 0, () => {
            truncated = true;
        });
    const schemaIssues = (input.schemaIssues ?? []).slice(0, 20).map(
        ({ path, code, message }) => ({
            path: bound(sanitizeText(path), 256, () => {
                truncated = true;
            }),
            code: bound(sanitizeText(code), 80, () => {
                truncated = true;
            }),
            message: bound(sanitizeText(message), 500, () => {
                truncated = true;
            })
        })
    );
    if ((input.schemaIssues?.length ?? 0) > schemaIssues.length) {
        truncated = true;
    }
    return {
        schemaVersion: 1,
        modelRole: input.modelRole,
        phase: input.phase,
        failureType: input.failureType,
        ...input.model ? { model: sanitizeText(input.model).slice(0, 200) } : {},
        ...input.requestId
            ? { requestId: sanitizeText(input.requestId).slice(0, 200) }
            : {},
        ...rawOutputPreview === undefined ? {} : { rawOutputPreview },
        ...input.rawOutput === undefined
            ? {}
            : {
                rawSha256: createHash('sha256')
                    .update(input.rawOutput)
                    .digest('hex')
            },
        ...parsedJson === undefined ? {} : { parsedJson },
        schemaIssues,
        sanitized: true,
        truncated
    };
}

function sanitizeJson(
    value: unknown,
    depth: number,
    markTruncated: () => void
): JsonValue {
    if (depth > MAX_DEPTH) {
        markTruncated();
        return '[TRUNCATED]';
    }
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === 'string') {
        return bound(sanitizeText(value), MAX_STRING_LENGTH, markTruncated);
    }
    if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_LENGTH) {
            markTruncated();
        }
        return value.slice(0, MAX_ARRAY_LENGTH).map((item) =>
            sanitizeJson(item, depth + 1, markTruncated));
    }
    if (typeof value !== 'object' || value === undefined) {
        return String(value);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_OBJECT_KEYS) {
        markTruncated();
    }
    return Object.fromEntries(entries.slice(0, MAX_OBJECT_KEYS).map(
        ([ key, item ]) => [
            sanitizeText(key).slice(0, 200),
            SENSITIVE_KEY.test(key)
                ? '[REDACTED]'
                : sanitizeJson(item, depth + 1, markTruncated)
        ]
    ));
}

function sanitizeText(value: string): string {
    return value
        .replace(RAW_SECRET, '$1[REDACTED]')
        .replace(URL_PATTERN, (candidate) => sanitizeUrl(candidate));
}

function sanitizeUrl(candidate: string): string {
    try {
        const parsed = new URL(candidate);
        return `${ parsed.origin }${ parsed.pathname }`;
    } catch {
        return '[REDACTED_URL]';
    }
}

function bound(
    value: string,
    limit: number,
    markTruncated: () => void
): string {
    if (value.length <= limit) {
        return value;
    }
    markTruncated();
    return `${ value.slice(0, limit) }…`;
}

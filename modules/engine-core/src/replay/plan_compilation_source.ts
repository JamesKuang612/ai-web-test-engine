import type {
    ActionResult,
    EffectVerification,
    EvidenceRef,
    JsonValue,
    LocatorHint,
    ObservedElement,
    PageNotice,
    PageObservation,
    ResolvedTarget,
    TabSummary,
} from '../contracts';
import {
    testIntentSchema,
} from '../intent';
import {
    actionCommandSchema,
    semanticActionSchema,
} from '../planning';
import type {
    CompilableTraceStep,
    CompilePlanInput,
} from './trace_plan_compiler';

/** 首次探索结束后保存、供用户稍后手动生成计划的稳定输入。 */
export interface PlanCompilationSource extends CompilePlanInput {
    schemaVersion: 1;
}

/** 表示持久化的计划生成输入已经损坏或不符合当前契约。 */
export class PlanCompilationSourceSchemaError extends Error {
    constructor(path: string, message: string) {
        super(`${ path }：${ message }`);
        this.name = 'PlanCompilationSourceSchemaError';
    }
}

/** 从内存执行记录创建不包含密码明文的计划生成输入。 */
export function createPlanCompilationSource(
    input: CompilePlanInput
): PlanCompilationSource {
    return {
        schemaVersion: 1,
        runId: input.runId,
        testId: input.testId,
        testIntent: structuredClone(input.testIntent),
        steps: structuredClone(input.steps)
    };
}

/** 严格读取本地产物，不直接信任磁盘中的未知 JSON。 */
export function parsePlanCompilationSource(
    value: unknown
): PlanCompilationSource {
    const object = requireObject(value, 'PlanCompilationSource');
    if (object.schemaVersion !== 1) {
        throw schemaError('PlanCompilationSource.schemaVersion', '必须等于 1');
    }
    const runId = requireIdentifier(
        object.runId,
        'PlanCompilationSource.runId'
    );
    const testId = requireIdentifier(
        object.testId,
        'PlanCompilationSource.testId'
    );
    const steps = requireArray(
        object.steps,
        'PlanCompilationSource.steps'
    ).map((step, index) => parseStep(
        step,
        `PlanCompilationSource.steps[${ index }]`
    ));

    return {
        schemaVersion: 1,
        runId,
        testId,
        testIntent: testIntentSchema.parse(object.testIntent),
        steps
    };
}

function parseStep(value: unknown, path: string): CompilableTraceStep {
    const object = requireObject(value, path);
    return {
        sequence: requirePositiveInteger(object.sequence, `${ path }.sequence`),
        ...object.semanticAction === undefined
            ? {}
            : {
                semanticAction: semanticActionSchema.parse(
                    object.semanticAction
                )
            },
        command: actionCommandSchema.parse(object.command),
        ...object.resolvedTarget === undefined
            ? {}
            : {
                resolvedTarget: parseResolvedTarget(
                    object.resolvedTarget,
                    `${ path }.resolvedTarget`
                )
            },
        actionResult: parseActionResult(
            object.actionResult,
            `${ path }.actionResult`
        ),
        effect: parseEffect(object.effect, `${ path }.effect`),
        beforeObservation: parseObservation(
            object.beforeObservation,
            `${ path }.beforeObservation`
        ),
        afterObservation: parseObservation(
            object.afterObservation,
            `${ path }.afterObservation`
        )
    };
}

function parseResolvedTarget(value: unknown, path: string): ResolvedTarget {
    const object = requireObject(value, path);
    const snapshotObject = requireObject(
        object.elementSnapshot,
        `${ path }.elementSnapshot`
    );
    const parsedSnapshotElement = parseObservedElement({
        candidateId: '__snapshot__',
        ...snapshotObject
    }, `${ path }.elementSnapshot`);
    const {
        candidateId: _candidateId,
        ...elementSnapshot
    } = parsedSnapshotElement;
    return {
        description: requireString(
            object.description,
            `${ path }.description`
        ),
        observationId: requireString(
            object.observationId,
            `${ path }.observationId`
        ),
        candidateId: requireString(
            object.candidateId,
            `${ path }.candidateId`
        ),
        elementSnapshot,
        strategy: requireEnum(object.strategy, [
            'candidate-id',
            'css',
            'label',
            'placeholder',
            'role-name',
            'test-id',
            'text',
            'vision'
        ] as const, `${ path }.strategy`),
        locatorData: parseJsonRecord(
            object.locatorData,
            `${ path }.locatorData`
        ),
        confidence: requireNumber(
            object.confidence,
            `${ path }.confidence`
        ),
        unique: requireBoolean(object.unique, `${ path }.unique`),
        actionable: requireBoolean(
            object.actionable,
            `${ path }.actionable`
        ),
        evidence: parseStringArray(object.evidence, `${ path }.evidence`)
    };
}

function parseActionResult(value: unknown, path: string): ActionResult {
    const object = requireObject(value, path);
    const status = requireEnum(object.status, [
        'executed',
        'failed',
        'rejected',
        'timed-out'
    ] as const, `${ path }.status`);
    const signals = requireObject(
        object.browserSignals,
        `${ path }.browserSignals`
    );
    const error = object.error === undefined
        ? undefined
        : requireObject(object.error, `${ path }.error`);
    return {
        status,
        startedAt: requireString(object.startedAt, `${ path }.startedAt`),
        finishedAt: requireString(object.finishedAt, `${ path }.finishedAt`),
        ...error
            ? {
                error: {
                    code: requireString(error.code, `${ path }.error.code`),
                    message: requireString(
                        error.message,
                        `${ path }.error.message`
                    )
                }
            }
            : {},
        browserSignals: {
            dialogOpened: requireBoolean(
                signals.dialogOpened,
                `${ path }.browserSignals.dialogOpened`
            ),
            downloadStarted: requireBoolean(
                signals.downloadStarted,
                `${ path }.browserSignals.downloadStarted`
            ),
            newTabOpened: requireBoolean(
                signals.newTabOpened,
                `${ path }.browserSignals.newTabOpened`
            ),
            urlChanged: requireBoolean(
                signals.urlChanged,
                `${ path }.browserSignals.urlChanged`
            )
        }
    };
}

function parseEffect(value: unknown, path: string): EffectVerification {
    const object = requireObject(value, path);
    return {
        status: requireEnum(object.status, [
            'confirmed',
            'contradicted',
            'not-observed',
            'uncertain'
        ] as const, `${ path }.status`),
        expectedEffect: requireString(
            object.expectedEffect,
            `${ path }.expectedEffect`
        ),
        evidence: requireArray(object.evidence, `${ path }.evidence`)
            .map((item, index) => parseEvidence(
                item,
                `${ path }.evidence[${ index }]`
            )),
        summary: requireString(object.summary, `${ path }.summary`)
    };
}

function parseEvidence(value: unknown, path: string): EvidenceRef {
    const object = requireObject(value, path);
    return {
        kind: requireEnum(object.kind, [
            'dom',
            'json',
            'model',
            'network',
            'screenshot',
            'trace'
        ] as const, `${ path }.kind`),
        ref: requireString(object.ref, `${ path }.ref`),
        ...object.mediaType === undefined
            ? {}
            : {
                mediaType: requireString(
                    object.mediaType,
                    `${ path }.mediaType`
                )
            },
        ...object.summary === undefined
            ? {}
            : { summary: requireString(object.summary, `${ path }.summary`) }
    };
}

function parseObservation(value: unknown, path: string): PageObservation {
    const object = requireObject(value, path);
    const page = requireObject(object.page, `${ path }.page`);
    const viewport = requireObject(page.viewport, `${ path }.page.viewport`);
    return {
        schemaVersion: requireSchemaVersion(
            object.schemaVersion,
            `${ path }.schemaVersion`
        ),
        observationId: requireString(
            object.observationId,
            `${ path }.observationId`
        ),
        capturedAt: requireString(object.capturedAt, `${ path }.capturedAt`),
        page: {
            loading: requireBoolean(page.loading, `${ path }.page.loading`),
            title: requireString(page.title, `${ path }.page.title`, true),
            url: requireString(page.url, `${ path }.page.url`, true),
            viewport: {
                height: requireNumber(
                    viewport.height,
                    `${ path }.page.viewport.height`
                ),
                width: requireNumber(
                    viewport.width,
                    `${ path }.page.viewport.width`
                )
            }
        },
        visibleText: parseStringArray(
            object.visibleText,
            `${ path }.visibleText`
        ),
        interactiveElements: requireArray(
            object.interactiveElements,
            `${ path }.interactiveElements`
        ).map((item, index) => parseObservedElement(
            item,
            `${ path }.interactiveElements[${ index }]`
        )),
        notices: requireArray(object.notices, `${ path }.notices`)
            .map((item, index) => parseNotice(
                item,
                `${ path }.notices[${ index }]`
            )),
        tabs: requireArray(object.tabs, `${ path }.tabs`)
            .map((item, index) => parseTab(
                item,
                `${ path }.tabs[${ index }]`
            )),
        ...object.screenshotRef === undefined
            ? {}
            : {
                screenshotRef: requireString(
                    object.screenshotRef,
                    `${ path }.screenshotRef`
                )
            },
        stateFingerprint: requireString(
            object.stateFingerprint,
            `${ path }.stateFingerprint`
        ),
        truncated: requireBoolean(object.truncated, `${ path }.truncated`)
    };
}

function parseObservedElement(value: unknown, path: string): ObservedElement {
    const object = requireObject(value, path);
    const boundingBox = object.boundingBox === undefined
        ? undefined
        : requireObject(object.boundingBox, `${ path }.boundingBox`);
    return {
        candidateId: requireString(object.candidateId, `${ path }.candidateId`),
        ...object.discoverySource === undefined
            ? {}
            : {
                discoverySource: requireEnum(object.discoverySource, [
                    'dom',
                    'vision-assisted'
                ] as const, `${ path }.discoverySource`)
            },
        ...optionalString(object, 'visualDescription', path),
        tag: requireString(object.tag, `${ path }.tag`),
        ...optionalString(object, 'role', path),
        ...optionalString(object, 'name', path),
        ...optionalString(object, 'text', path),
        ...optionalString(object, 'label', path),
        ...optionalString(object, 'placeholder', path),
        ...object.valueState === undefined
            ? {}
            : {
                valueState: requireEnum(object.valueState, [
                    'empty',
                    'filled',
                    'masked',
                    'unknown'
                ] as const, `${ path }.valueState`)
            },
        disabled: requireBoolean(object.disabled, `${ path }.disabled`),
        ...object.checked === undefined
            ? {}
            : { checked: requireBoolean(object.checked, `${ path }.checked`) },
        visible: requireBoolean(object.visible, `${ path }.visible`),
        inViewport: requireBoolean(object.inViewport, `${ path }.inViewport`),
        attributes: parseStringRecord(object.attributes, `${ path }.attributes`),
        nearbyText: parseStringArray(object.nearbyText, `${ path }.nearbyText`),
        ...boundingBox
            ? {
                boundingBox: {
                    height: requireNumber(
                        boundingBox.height,
                        `${ path }.boundingBox.height`
                    ),
                    width: requireNumber(
                        boundingBox.width,
                        `${ path }.boundingBox.width`
                    ),
                    x: requireNumber(boundingBox.x, `${ path }.boundingBox.x`),
                    y: requireNumber(boundingBox.y, `${ path }.boundingBox.y`)
                }
            }
            : {},
        locatorHints: requireArray(
            object.locatorHints,
            `${ path }.locatorHints`
        ).map((item, index) => parseLocatorHint(
            item,
            `${ path }.locatorHints[${ index }]`
        ))
    };
}

function parseLocatorHint(value: unknown, path: string): LocatorHint {
    const object = requireObject(value, path);
    return {
        strategy: requireEnum(object.strategy, [
            'css',
            'label',
            'placeholder',
            'role-name',
            'test-id',
            'text'
        ] as const, `${ path }.strategy`),
        value: requireString(object.value, `${ path }.value`)
    };
}

function parseNotice(value: unknown, path: string): PageNotice {
    const object = requireObject(value, path);
    return {
        level: requireEnum(object.level, [
            'error',
            'info',
            'success',
            'warning'
        ] as const, `${ path }.level`),
        text: requireString(object.text, `${ path }.text`)
    };
}

function parseTab(value: unknown, path: string): TabSummary {
    const object = requireObject(value, path);
    return {
        active: requireBoolean(object.active, `${ path }.active`),
        title: requireString(object.title, `${ path }.title`, true),
        url: requireString(object.url, `${ path }.url`, true)
    };
}

function optionalString(
    object: Record<string, unknown>,
    key: string,
    path: string
): Record<string, string> {
    return object[key] === undefined
        ? {}
        : { [key]: requireString(object[key], `${ path }.${ key }`) };
}

function parseStringArray(value: unknown, path: string): string[] {
    return requireArray(value, path).map((item, index) => requireString(
        item,
        `${ path }[${ index }]`,
        true
    ));
}

function parseStringRecord(
    value: unknown,
    path: string
): Record<string, string> {
    const object = requireObject(value, path);
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [
        key,
        requireString(item, `${ path }.${ key }`, true)
    ]));
}

function parseJsonRecord(
    value: unknown,
    path: string
): Record<string, JsonValue> {
    const object = requireObject(value, path);
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [
        key,
        parseJsonValue(item, `${ path }.${ key }`)
    ]));
}

function parseJsonValue(value: unknown, path: string): JsonValue {
    if (
        value === null
        || typeof value === 'boolean'
        || typeof value === 'string'
    ) {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) =>
            parseJsonValue(item, `${ path }[${ index }]`)
        );
    }
    if (typeof value === 'object') {
        return parseJsonRecord(value, path);
    }
    throw schemaError(path, '必须是合法 JSON 值');
}

function requireObject(
    value: unknown,
    path: string
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw schemaError(path, '必须是对象');
    }
    return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw schemaError(path, '必须是数组');
    }
    return value;
}

function requireString(
    value: unknown,
    path: string,
    allowEmpty = false
): string {
    if (
        typeof value !== 'string'
        || (!allowEmpty && value.trim().length === 0)
    ) {
        throw schemaError(path, '必须是非空字符串');
    }
    return value;
}

function requireIdentifier(value: unknown, path: string): string {
    const result = requireString(value, path);
    if (!/^[a-zA-Z0-9_-]+$/u.test(result)) {
        throw schemaError(path, '只能包含字母、数字、下划线或连字符');
    }
    return result;
}

function requirePositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) {
        throw schemaError(path, '必须是正整数');
    }
    return Number(value);
}

function requireNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw schemaError(path, '必须是有限数字');
    }
    return value;
}

function requireBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
        throw schemaError(path, '必须是布尔值');
    }
    return value;
}

function requireSchemaVersion(value: unknown, path: string): 1 {
    if (value !== 1) {
        throw schemaError(path, '必须等于 1');
    }
    return 1;
}

function requireEnum<const T extends readonly string[]>(
    value: unknown,
    allowed: T,
    path: string
): T[number] {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw schemaError(path, `必须是 ${ allowed.join('、') } 之一`);
    }
    return value as T[number];
}

function schemaError(
    path: string,
    message: string
): PlanCompilationSourceSchemaError {
    return new PlanCompilationSourceSchemaError(path, message);
}

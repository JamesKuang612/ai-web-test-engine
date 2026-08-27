import type {
    ArtifactStore,
    JsonValue,
} from '@ai-web-test-engine/core';
import {
    parsePlanCompilationSource,
    PlanCompilationSourceSchemaError,
    TracePlanCompileError,
    TracePlanCompiler,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import { LocalArtifactStore } from '../adapters/storage/local_artifact_store';
import { config } from '../config';

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;

export interface PlanGenerationResult {
    schemaVersion: 1;
    runId: string;
    status: 'FAILED' | 'SUCCEEDED';
    summary: string;
    compiledPlanRef?: string;
    failure?: {
        category: 'TRACE_COMPILE_ERROR',
        phase: 'COMPILING_PLAN',
        recoverable: true,
        summary: string
    };
}

/** 用户主动点击后，才把既有成功探索轨迹编译为结构化计划。 */
@service()
export class PlanGenerationService {
    constructor(
        private readonly artifactStore: Pick<
            ArtifactStore,
            'loadJson' | 'saveJson'
        > = new LocalArtifactStore(config.storage.artifact_root)
    ) {}

    public async generate(runId: string): Promise<PlanGenerationResult> {
        const normalizedRunId = this.requireRunId(runId);
        try {
            const source = parsePlanCompilationSource(
                await this.artifactStore.loadJson(
                    `${ normalizedRunId }/json/plan-compilation-source.json`
                )
            );
            if (source.runId !== normalizedRunId) {
                throw new PlanCompilationSourceSchemaError(
                    'PlanCompilationSource.runId',
                    '与请求的 Run ID 不一致'
                );
            }
            const plan = new TracePlanCompiler().compile(source);
            const planReference = await this.artifactStore.saveJson(
                normalizedRunId,
                'compiled-plan',
                toJsonValue(plan)
            );
            const result: PlanGenerationResult = {
                schemaVersion: 1,
                runId: normalizedRunId,
                status: 'SUCCEEDED',
                summary: `结构化计划已生成，共 ${ plan.steps.length } 个步骤。`,
                compiledPlanRef: planReference.ref
            };
            await this.saveGenerationResult(normalizedRunId, result);
            return result;
        } catch (error) {
            const summary = this.describeFailure(error);
            const result: PlanGenerationResult = {
                schemaVersion: 1,
                runId: normalizedRunId,
                status: 'FAILED',
                summary,
                failure: {
                    category: 'TRACE_COMPILE_ERROR',
                    phase: 'COMPILING_PLAN',
                    recoverable: true,
                    summary
                }
            };
            await this.saveGenerationResult(normalizedRunId, result)
                .catch(() => undefined);
            return result;
        }
    }

    private requireRunId(runId: string): string {
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new PlanGenerationInputError('Run ID 格式不合法。');
        }
        return runId;
    }

    private describeFailure(error: unknown): string {
        if (
            error instanceof TracePlanCompileError
            || error instanceof PlanCompilationSourceSchemaError
        ) {
            return error.message;
        }
        if (error instanceof Error && error.message.includes('ENOENT')) {
            return '该运行没有可用于生成计划的成功探索轨迹。';
        }
        return error instanceof Error
            ? `计划生成失败：${ error.message }`
            : '计划生成发生未知错误。';
    }

    private async saveGenerationResult(
        runId: string,
        result: PlanGenerationResult
    ): Promise<void> {
        await this.artifactStore.saveJson(
            runId,
            'plan-generation',
            toJsonValue(result)
        );
    }
}

export class PlanGenerationInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlanGenerationInputError';
    }
}

function toJsonValue(value: unknown): JsonValue {
    if (
        value === null
        || typeof value === 'boolean'
        || typeof value === 'number'
        || typeof value === 'string'
    ) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(toJsonValue);
    }
    if (typeof value === 'object') {
        const result: Record<string, JsonValue> = {};
        Object.entries(value).forEach(([key, item]) => {
            if (item !== undefined) {
                result[key] = toJsonValue(item);
            }
        });
        return result;
    }
    throw new Error('计划生成产物包含无法序列化的值。');
}

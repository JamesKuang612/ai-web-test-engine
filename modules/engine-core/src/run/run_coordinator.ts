import { randomUUID } from 'node:crypto';

import type {
    JsonValue,
    RunEvent,
    RunLifecycleState,
    RunResult,
    RunSnapshot,
    StartRunInput,
    TestIntent,
} from '../contracts';
import type {
    IntentBuilder,
} from '../intent';
import type {
    ArtifactStore,
    RunEventPublisher,
} from '../ports';
import type {
    ExecutionEngine,
} from './execution_engine';
import {
    RunLifecycle,
} from './run_lifecycle';

/**
 * 一次测试运行的总协调器，负责创建运行记录、推进生命周期并向外发布运行事件。
 * 具体的模型推理和浏览器执行会在后续阶段接入这里。
 */
export class RunCoordinator implements ExecutionEngine {
    /** 注入运行产物存储、事件发布和意图构建能力。 */
    constructor(
        private readonly artifactStore: ArtifactStore,
        private readonly eventPublisher: RunEventPublisher,
        private readonly intentBuilder: IntentBuilder
    ) {}

    /** 接收完整的运行输入，创建一次新的 Run 并启动它的执行流程。 */
    public async start(
        input: StartRunInput,
        signal: AbortSignal
    ): Promise<RunResult> {
        const runId = randomUUID();
        const lifecycle = new RunLifecycle();
        const now = new Date().toISOString();
        let eventSequence = 0;

        let snapshot: RunSnapshot = {
            schemaVersion: 1,
            runId,
            testId: input.test.id,
            lifecycle: lifecycle.current(),
            createdAt: now,
            updatedAt: now,
            summary: '等待开始执行',
            metadata: {
                environmentId: input.environment.id,
                mode: input.mode,
            },
        };

        await this.artifactStore.createRun(snapshot);

        await this.publishEvent(runId, ++eventSequence, 'run.created', {
            testId: input.test.id,
        });

        // 在进入后续阶段前响应上层的主动取消请求。
        signal.throwIfAborted();

        snapshot = await this.changeState(
            snapshot,
            lifecycle,
            'STARTING',
            '正在启动测试',
            ++eventSequence
        );

        signal.throwIfAborted();

        snapshot = await this.changeState(
            snapshot,
            lifecycle,
            'BUILDING_INTENT',
            '正在构建测试意图',
            ++eventSequence
        );

        const intent = await this.intentBuilder.build(
            {
                test: input.test,
                environment: input.environment,
                projectContext: input.projectContext
            },
            signal
        );

        signal.throwIfAborted();

        const intentReference = await this.artifactStore.saveJson(
            runId,
            'intent',
            toTestIntentJson(intent)
        );

        snapshot = {
            ...snapshot,
            updatedAt: new Date().toISOString(),
            summary: '测试意图构建完成',
            metadata: {
                ...snapshot.metadata,
                intentRef: intentReference.ref
            }
        };
        await this.artifactStore.updateRun(snapshot);

        // 下一步从这里进入浏览器启动和页面观察流程。
        throw new Error('核心执行流程尚未实现');
    }

    /** 校验并切换生命周期，同时持久化最新快照并广播状态变化。 */
    private async changeState(
        snapshot: RunSnapshot,
        lifecycle: RunLifecycle,
        next: RunLifecycleState,
        summary: string,
        eventSequence: number
    ): Promise<RunSnapshot> {
        lifecycle.transition(next);

        const updatedSnapshot: RunSnapshot = {
            ...snapshot,
            lifecycle: lifecycle.current(),
            updatedAt: new Date().toISOString(),
            summary,
        };

        await this.artifactStore.updateRun(updatedSnapshot);

        await this.publishEvent(
            snapshot.runId,
            eventSequence,
            'run.status.changed', {
            lifecycle: updatedSnapshot.lifecycle,
            summary,
            }
        );

        return updatedSnapshot;
    }

    /** 将领域内发生的运行事件包装成统一格式后交给发布器。 */
    private async publishEvent(
        runId: string,
        sequence: number,
        type: RunEvent['type'],
        payload: RunEvent['payload']
    ): Promise<void> {
        await this.eventPublisher.publish({
            schemaVersion: 1,
            eventId: randomUUID(),
            runId,
            type,
            sequence,
            timestamp: new Date().toISOString(),
            payload,
        });
    }
}

/** 将 TestIntent 显式转换为可以安全持久化的 JSON 数据。 */
function toTestIntentJson(intent: TestIntent): JsonValue {
    return {
        schemaVersion: intent.schemaVersion,
        objective: intent.objective,
        preconditions: [...intent.preconditions],
        successCriteria: intent.successCriteria.map((criterion) => ({
            id: criterion.id,
            description: criterion.description,
            preferredEvidence: [...criterion.preferredEvidence],
            required: criterion.required
        })),
        failureCriteria: intent.failureCriteria.map((criterion) => ({
            id: criterion.id,
            description: criterion.description
        })),
        constraints: [...intent.constraints],
        allowedHosts: [...intent.allowedHosts],
        dataPolicy: {
            generatedValues: {
                ...intent.dataPolicy.generatedValues
            }
        }
    };
}

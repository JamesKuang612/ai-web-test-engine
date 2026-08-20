import { randomUUID } from 'node:crypto';

import type {
    RunEvent,
    RunLifecycleState,
    RunResult,
    RunSnapshot,
    StartRunInput,
} from '../contracts';
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
    /** 注入运行产物存储和事件发布能力，使核心流程不依赖具体基础设施。 */
    constructor(
        private readonly artifactStore: ArtifactStore,
        private readonly eventPublisher: RunEventPublisher
    ) {}

    /** 接收完整的运行输入，创建一次新的 Run 并启动它的执行流程。 */
    public async start(
        input: StartRunInput,
        signal: AbortSignal
    ): Promise<RunResult> {
        const runId = randomUUID();
        const lifecycle = new RunLifecycle();
        const now = new Date().toISOString();

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

        await this.publishEvent(runId, 1, 'run.created', {
            testId: input.test.id,
        });

        // 在进入后续阶段前响应上层的主动取消请求。
        signal.throwIfAborted();

        snapshot = await this.changeState(
            snapshot,
            lifecycle,
            'STARTING',
            '正在启动测试'
        );

        // 下一步从这里进入 BUILDING_INTENT，
        // 再逐渐调用模型和浏览器。
        throw new Error('核心执行流程尚未实现');
    }

    /** 校验并切换生命周期，同时持久化最新快照并广播状态变化。 */
    private async changeState(
        snapshot: RunSnapshot,
        lifecycle: RunLifecycle,
        next: RunLifecycleState,
        summary: string
    ): Promise<RunSnapshot> {
        lifecycle.transition(next);

        const updatedSnapshot: RunSnapshot = {
            ...snapshot,
            lifecycle: lifecycle.current(),
            updatedAt: new Date().toISOString(),
            summary,
        };

        await this.artifactStore.updateRun(updatedSnapshot);

        await this.publishEvent(snapshot.runId, 2, 'run.status.changed', {
            lifecycle: updatedSnapshot.lifecycle,
            summary,
        });

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

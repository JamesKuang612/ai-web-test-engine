import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
    ArtifactInput,
    ArtifactStore,
    EvidenceRef,
    JsonValue,
    RunResult,
    RunSnapshot,
    TraceEvent,
} from '@ai-web-test-engine/core';

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
const FILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;

/**
 * 将每次测试运行的快照、轨迹、证据和结果持久化到本地文件系统。
 * 该适配器只负责可靠存储，不参与测试步骤规划或结果判定。
 */
export class LocalArtifactStore implements ArtifactStore {
    private readonly rootDirectory: string;

    /** 将用户传入的存储根目录转换为稳定的绝对路径。 */
    constructor(rootDirectory: string) {
        this.rootDirectory = path.resolve(rootDirectory);
    }

    /** 创建新的运行目录，并原子写入首份 run.json 快照。 */
    public createRun = async (
        snapshot: RunSnapshot
    ): Promise<void> => {
        const runDirectory = this.getRunDirectory(snapshot.runId);

        await fs.mkdir(this.rootDirectory, {
            recursive: true
        });
        await fs.mkdir(runDirectory);
        await this.writeJsonAtomically(
            path.join(runDirectory, 'run.json'),
            snapshot
        );
    };

    /** 确认运行已经存在后，原子替换最新的 run.json 快照。 */
    public updateRun = async (
        snapshot: RunSnapshot
    ): Promise<void> => {
        const runDirectory = this.getRunDirectory(snapshot.runId);
        const runFile = path.join(runDirectory, 'run.json');

        await fs.access(runFile);
        await this.writeJsonAtomically(runFile, snapshot);
    };

    /** 将单个动作事件按 JSONL 格式追加到运行轨迹中。 */
    public appendTrace = async (
        runId: string,
        event: TraceEvent
    ): Promise<void> => {
        const runDirectory = await this.requireRun(runId);
        if (event.runId !== runId) {
            throw new Error(
                `TraceEvent 的 Run ID ${ event.runId } 与 ${ runId } 不一致。`
            );
        }

        await fs.appendFile(
            path.join(runDirectory, 'trace.jsonl'),
            `${ JSON.stringify(event) }\n`,
            {
                encoding: 'utf8',
                flag: 'a'
            }
        );
    };

    /** 保存截图、DOM 等原始证据，并返回不暴露绝对路径的引用。 */
    public saveArtifact = async (
        runId: string,
        artifact: ArtifactInput
    ): Promise<EvidenceRef> => {
        const runDirectory = await this.requireRun(runId);
        const fileName = this.requireSafeFileName(artifact.name);
        const artifactDirectory = path.join(runDirectory, 'artifacts');

        await fs.mkdir(artifactDirectory, {
            recursive: true
        });
        await fs.writeFile(
            path.join(artifactDirectory, fileName),
            artifact.content,
            {
                flag: 'wx'
            }
        );

        return {
            kind: artifact.kind,
            mediaType: artifact.mediaType,
            ref: path.posix.join(runId, 'artifacts', fileName)
        };
    };

    /** 将结构化中间数据保存到 json 目录，并返回对应证据引用。 */
    public saveJson = async (
        runId: string,
        name: string,
        value: JsonValue
    ): Promise<EvidenceRef> => {
        const runDirectory = await this.requireRun(runId);
        const fileName = this.toJsonFileName(name);
        const jsonDirectory = path.join(runDirectory, 'json');

        await fs.mkdir(jsonDirectory, {
            recursive: true
        });
        await this.writeJsonAtomically(
            path.join(jsonDirectory, fileName),
            value
        );

        return {
            kind: 'json',
            mediaType: 'application/json',
            ref: path.posix.join(runId, 'json', fileName)
        };
    };

    /** 将一次运行的最终结果原子写入 result.json。 */
    public saveResult = async (
        result: RunResult
    ): Promise<void> => {
        const runDirectory = await this.requireRun(result.runId);
        await this.writeJsonAtomically(
            path.join(runDirectory, 'result.json'),
            result
        );
    };

    /** 校验 Run ID 并计算该运行的本地目录，避免目录穿越。 */
    private getRunDirectory(runId: string): string {
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`非法的 Run ID：${ runId }`);
        }
        return path.join(this.rootDirectory, runId);
    }

    /** 确认运行已完成初始化，并返回其目录路径。 */
    private async requireRun(runId: string): Promise<string> {
        const runDirectory = this.getRunDirectory(runId);
        await fs.access(path.join(runDirectory, 'run.json'));
        return runDirectory;
    }

    /** 只接受简单文件名，阻止绝对路径和父目录片段进入存储层。 */
    private requireSafeFileName(name: string): string {
        if (!FILE_NAME_PATTERN.test(name)) {
            throw new Error(`非法的文件名：${ name }`);
        }
        return name;
    }

    /** 校验结构化数据名称，并在缺少扩展名时补充 .json。 */
    private toJsonFileName(name: string): string {
        const fileName = this.requireSafeFileName(name);
        return fileName.endsWith('.json')
            ? fileName
            : `${ fileName }.json`;
    }

    /**
     * 先写入同目录临时文件再重命名，避免进程中断留下半份 JSON。
     */
    private async writeJsonAtomically(
        filePath: string,
        value: unknown
    ): Promise<void> {
        const temporaryFile = path.join(
            path.dirname(filePath),
            `.${ path.basename(filePath) }.${ randomUUID() }.tmp`
        );

        try {
            // 临时文件与目标文件位于同一目录，确保重命名可以原子完成。
            await fs.writeFile(
                temporaryFile,
                `${ JSON.stringify(value, null, 4) }\n`,
                {
                    encoding: 'utf8',
                    flag: 'wx'
                }
            );
            await fs.rename(temporaryFile, filePath);
        } catch (error) {
            await fs.rm(temporaryFile, {
                force: true
            });
            throw error;
        }
    }
}

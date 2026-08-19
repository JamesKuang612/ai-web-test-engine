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

export class LocalArtifactStore implements ArtifactStore {
    private readonly rootDirectory: string;

    constructor(rootDirectory: string) {
        this.rootDirectory = path.resolve(rootDirectory);
    }

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

    public updateRun = async (
        snapshot: RunSnapshot
    ): Promise<void> => {
        const runDirectory = this.getRunDirectory(snapshot.runId);
        const runFile = path.join(runDirectory, 'run.json');

        await fs.access(runFile);
        await this.writeJsonAtomically(runFile, snapshot);
    };

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

    public saveResult = async (
        result: RunResult
    ): Promise<void> => {
        const runDirectory = await this.requireRun(result.runId);
        await this.writeJsonAtomically(
            path.join(runDirectory, 'result.json'),
            result
        );
    };

    private getRunDirectory(runId: string): string {
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`非法的 Run ID：${ runId }`);
        }
        return path.join(this.rootDirectory, runId);
    }

    private async requireRun(runId: string): Promise<string> {
        const runDirectory = this.getRunDirectory(runId);
        await fs.access(path.join(runDirectory, 'run.json'));
        return runDirectory;
    }

    private requireSafeFileName(name: string): string {
        if (!FILE_NAME_PATTERN.test(name)) {
            throw new Error(`非法的文件名：${ name }`);
        }
        return name;
    }

    private toJsonFileName(name: string): string {
        const fileName = this.requireSafeFileName(name);
        return fileName.endsWith('.json')
            ? fileName
            : `${ fileName }.json`;
    }

    private async writeJsonAtomically(
        filePath: string,
        value: unknown
    ): Promise<void> {
        const temporaryFile = path.join(
            path.dirname(filePath),
            `.${ path.basename(filePath) }.${ randomUUID() }.tmp`
        );

        try {
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

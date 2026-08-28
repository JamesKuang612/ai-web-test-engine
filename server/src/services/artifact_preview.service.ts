import fs from 'node:fs/promises';
import path from 'node:path';
import { service } from 'nstarter-core';
import {
    resolveArtifactRootDirectories,
} from '../adapters/storage/artifact_root';
import { config } from '../config';

const SCREENSHOT_REF_PATTERN =
    /^[a-zA-Z0-9_-]+\/artifacts\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/u;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

/** 表示截图引用不存在或越过本地产物读取边界。 */
export class ArtifactPreviewError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArtifactPreviewError';
    }
}

/** 只读取执行引擎生成的 PNG 截图，不开放任意本地文件访问。 */
@service()
export class ArtifactPreviewService {
    private readonly rootDirectories: string[];

    constructor(rootDirectory: string = config.storage.artifact_root) {
        this.rootDirectories = resolveArtifactRootDirectories(rootDirectory);
    }

    public async readScreenshot(reference: unknown): Promise<Buffer> {
        if (
            typeof reference !== 'string'
            || !SCREENSHOT_REF_PATTERN.test(reference)
        ) {
            throw new ArtifactPreviewError('截图引用格式不合法。');
        }
        for (const rootDirectory of this.rootDirectories) {
            const filePath = path.resolve(
                rootDirectory,
                ...reference.split('/')
            );
            const expectedPrefix = `${ rootDirectory }${ path.sep }`;
            if (!filePath.startsWith(expectedPrefix)) {
                continue;
            }
            try {
                const stats = await fs.stat(filePath);
                if (!stats.isFile() || stats.size > MAX_SCREENSHOT_BYTES) {
                    throw new ArtifactPreviewError('截图文件不可读取。');
                }
                return await fs.readFile(filePath);
            } catch (error) {
                if (error instanceof ArtifactPreviewError) {
                    throw error;
                }
            }
        }
        throw new ArtifactPreviewError('截图不存在或尚未生成。');
    }
}

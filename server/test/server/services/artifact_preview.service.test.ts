import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    ArtifactPreviewError,
    ArtifactPreviewService,
} from '../../../src/services/artifact_preview.service';

describe('ArtifactPreviewService', () => {
    let temporaryDirectory = '';

    beforeEach(async () => {
        temporaryDirectory = await fs.mkdtemp(path.join(
            os.tmpdir(),
            'ai-web-test-preview-'
        ));
    });

    afterEach(async () => {
        await fs.rm(temporaryDirectory, {
            force: true,
            recursive: true
        });
    });

    it('只读取受控运行目录中的 PNG 截图', async () => {
        const screenshotDirectory = path.join(
            temporaryDirectory,
            'run-001',
            'artifacts'
        );
        await fs.mkdir(screenshotDirectory, { recursive: true });
        await fs.writeFile(
            path.join(screenshotDirectory, 'page.png'),
            Buffer.from([137, 80, 78, 71])
        );
        const service = new ArtifactPreviewService(temporaryDirectory);

        const content = await service.readScreenshot(
            'run-001/artifacts/page.png'
        );

        assert.deepEqual([...content], [137, 80, 78, 71]);
    });

    it('拒绝目录穿越和非截图产物引用', async () => {
        const service = new ArtifactPreviewService(temporaryDirectory);

        await assert.rejects(
            service.readScreenshot('../secret.png'),
            ArtifactPreviewError
        );
        await assert.rejects(
            service.readScreenshot('run-001/json/page.json'),
            ArtifactPreviewError
        );
    });
});

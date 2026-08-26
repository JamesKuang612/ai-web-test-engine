import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    LocalTestDefinitionRepository,
} from '../../../../src/adapters/storage/local_test_definition_repository';

describe('LocalTestDefinitionRepository', () => {
    let temporaryDirectory = '';
    let repository: LocalTestDefinitionRepository;

    beforeEach(async () => {
        temporaryDirectory = await fs.mkdtemp(path.join(
            os.tmpdir(),
            'ai-web-test-definitions-'
        ));
        repository = new LocalTestDefinitionRepository(temporaryDirectory);
    });

    afterEach(async () => {
        await fs.rm(temporaryDirectory, {
            force: true,
            recursive: true
        });
    });

    it('保存、读取并列出真实 YAML 用例', async () => {
        const definition = {
            schemaVersion: 1 as const,
            id: 'my-todo',
            name: '验证我的待办',
            environmentId: 'jiandaoyun-test',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: '点击“我的待办”并验证页面。'
        };

        const record = await repository.save(definition);

        assert.equal(record.fileName, 'my-todo.test.yaml');
        assert.deepEqual(await repository.load('my-todo'), definition);
        assert.deepEqual(
            (await repository.list()).map((item) => item.definition),
            [definition]
        );
        assert.match(
            await fs.readFile(
                path.join(temporaryDirectory, record.fileName),
                'utf8'
            ),
            /action: 点击“我的待办”并验证页面。/u
        );
    });

    it('可以覆盖保存同一用例且不会遗留临时文件', async () => {
        const definition = {
            schemaVersion: 1 as const,
            id: 'my-todo',
            name: '验证我的待办',
            environmentId: 'jiandaoyun-test',
            action: '第一版动作。'
        };
        await repository.save(definition);

        await repository.save({
            ...definition,
            action: '第二版动作。'
        });

        assert.equal(
            (await repository.load('my-todo'))?.action,
            '第二版动作。'
        );
        assert.deepEqual(await fs.readdir(temporaryDirectory), [
            'my-todo.test.yaml'
        ]);
    });

    it('拒绝目录穿越和额外 YAML 字段', async () => {
        await assert.rejects(
            repository.load('../escape'),
            /用例 id/u
        );
        await fs.writeFile(
            path.join(temporaryDirectory, 'unsafe.test.yaml'),
            [
                'schemaVersion: 1',
                'id: unsafe',
                'name: 非法用例',
                'environmentId: jiandaoyun-test',
                'action: 测试动作',
                'unknown: true'
            ].join('\n'),
            'utf8'
        );
        await assert.rejects(
            repository.load('unsafe'),
            /unknown 不允许出现/u
        );
    });
});

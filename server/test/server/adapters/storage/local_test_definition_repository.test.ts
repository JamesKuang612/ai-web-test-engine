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

        assert.equal(record.fileName, '验证我的待办.test.yaml');
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
            '验证我的待办.test.yaml'
        ]);
    });

    it('改名时同步重命名文件并为同名用例添加序号', async () => {
        const definition = {
            schemaVersion: 1 as const,
            id: 'first-test',
            name: '验证创建应用',
            environmentId: 'jiandaoyun-test',
            action: '创建应用。'
        };
        await repository.save(definition);
        const duplicate = await repository.save({
            ...definition,
            id: 'second-test'
        });
        const renamed = await repository.save({
            ...definition,
            name: '验证应用列表'
        });

        assert.equal(duplicate.fileName, '验证创建应用（2）.test.yaml');
        assert.equal(renamed.fileName, '验证应用列表.test.yaml');
        assert.deepEqual(await fs.readdir(temporaryDirectory), [
            '验证创建应用（2）.test.yaml',
            '验证应用列表.test.yaml'
        ]);
    });

    it('按稳定内部 id 删除中文文件名用例', async () => {
        await repository.save({
            schemaVersion: 1,
            id: 'delete-test',
            name: '验证删除数据',
            environmentId: 'jiandaoyun-test',
            action: '删除一条数据。'
        });

        assert.equal(await repository.delete('delete-test'), true);
        assert.equal(await repository.load('delete-test'), undefined);
        assert.equal(await repository.delete('delete-test'), false);
        assert.deepEqual(await fs.readdir(temporaryDirectory), []);
    });

    it('允许持久化尚未添加步骤的空 action', async () => {
        const definition = {
            schemaVersion: 1 as const,
            id: 'empty-test',
            name: '空白测试',
            environmentId: 'jiandaoyun-test',
            action: ''
        };

        await repository.save(definition);

        assert.equal((await repository.load('empty-test'))?.action, '');
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

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    LocalTestDefinitionRepository,
} from '../../../src/adapters/storage/local_test_definition_repository';
import {
    TestDefinitionInputError,
    TestDefinitionService,
} from '../../../src/services/test_definition.service';

describe('TestDefinitionService', () => {
    let temporaryDirectory = '';
    let service: TestDefinitionService;

    beforeEach(async () => {
        temporaryDirectory = await fs.mkdtemp(path.join(
            os.tmpdir(),
            'ai-web-test-service-'
        ));
        service = new TestDefinitionService(
            new LocalTestDefinitionRepository(temporaryDirectory)
        );
    });

    afterEach(async () => {
        await fs.rm(temporaryDirectory, {
            force: true,
            recursive: true
        });
    });

    it('创建真实用例并使用英文名称生成稳定 id', async () => {
        const record = await service.create({
            name: 'My Todo Flow',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: '登录后点击“我的待办”。'
        });

        assert.equal(record.definition.id, 'my-todo-flow');
        assert.equal(record.definition.name, 'My Todo Flow');
        assert.equal(
            (await service.get('my-todo-flow')).action,
            '登录后点击“我的待办”。'
        );
    });

    it('拒绝允许 Host 之外或携带凭据的起始地址', async () => {
        await assert.rejects(() => service.create({
            name: '外部页面',
            startUrl: 'https://example.com/',
            action: '打开页面。'
        }), TestDefinitionInputError);
        await assert.rejects(() => service.create({
            name: '带凭据页面',
            startUrl: 'https://user:pass@test.jdydevelop.com/',
            action: '打开页面。'
        }), /不得包含账号或密码/u);
    });

    it('按用例保存并清除独立的结构化回放计划', async () => {
        await service.create({
            name: 'Replay Todo Flow',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: '打开我的待办。',
            planRef: 'source-run/json/compiled-plan.json'
        });

        assert.deepEqual(
            (await service.get('replay-todo-flow')).execution,
            {
                planRef: 'source-run/json/compiled-plan.json',
                preferredMode: 'structured-replay'
            }
        );

        await service.update('replay-todo-flow', {
            name: 'Replay Todo Flow',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: '打开我的待办。',
            planRef: null
        });
        assert.equal(
            (await service.get('replay-todo-flow')).execution,
            undefined
        );
    });
});

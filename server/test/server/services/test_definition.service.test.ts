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
        assert.equal(record.fileName, 'My Todo Flow.test.yaml');
        assert.equal(
            (await service.get('my-todo-flow')).action,
            '登录后点击“我的待办”。'
        );
    });

    it('中文名称使用稳定内部 id 和可读文件名', async () => {
        const record = await service.create({
            name: '验证删除数据',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: ''
        });

        assert.match(record.definition.id, /^test-[a-f0-9]{8}$/u);
        assert.equal(record.fileName, '验证删除数据.test.yaml');
        assert.equal(
            (await service.getRecord(record.definition.id)).fileName,
            '验证删除数据.test.yaml'
        );
    });

    it('删除用例并在重复删除时返回不存在', async () => {
        const record = await service.create({
            name: '待删除用例',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: ''
        });

        await service.delete(record.definition.id);
        await assert.rejects(
            () => service.get(record.definition.id),
            /没有找到测试用例/u
        );
        await assert.rejects(
            () => service.delete(record.definition.id),
            /没有找到测试用例/u
        );
    });

    it('允许先创建没有操作步骤的测试', async () => {
        const record = await service.create({
            name: 'Empty Test',
            startUrl: 'https://test.jdydevelop.com/dashboard#/',
            action: ''
        });

        assert.equal(record.definition.id, 'empty-test');
        assert.equal(record.definition.action, '');
        assert.equal((await service.get('empty-test')).action, '');
    });

    it('保存并更新白名单前置模块', async () => {
        await service.create({
            name: 'Login Module Test',
            startUrl: 'https://www.jiandaoyun.com/dashboard#/',
            action: '打开我的待办。',
            setupModules: [ 'jiandaoyun-login' ]
        });
        assert.deepEqual(
            (await service.get('login-module-test')).execution?.setupModules,
            [ 'jiandaoyun-login' ]
        );

        await service.update('login-module-test', {
            name: 'Login Module Test',
            startUrl: 'https://www.jiandaoyun.com/dashboard#/',
            action: '打开我的待办。',
            setupModules: []
        });
        assert.equal(
            (await service.get('login-module-test')).execution,
            undefined
        );
    });

    it('允许使用简道云生产环境起始地址', async () => {
        const record = await service.create({
            name: 'Production Test',
            startUrl: 'https://www.jiandaoyun.com/dashboard#/',
            action: ''
        });

        assert.equal(
            record.definition.startUrl,
            'https://www.jiandaoyun.com/dashboard#/'
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

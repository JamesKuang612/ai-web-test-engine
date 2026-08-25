import assert from 'node:assert/strict';
import {
    LocalEnvironmentValueResolver,
} from '../../../../src/adapters/environment';

describe('LocalEnvironmentValueResolver', () => {
    it('直接返回环境定义中的安全字面量', async () => {
        const resolver = new LocalEnvironmentValueResolver({});

        assert.equal(
            await resolver.resolve('region', {
                source: 'literal',
                value: 'cn'
            }),
            'cn'
        );
    });

    it('按本机 key 读取变量且缺失时不暴露其他值', async () => {
        const resolver = new LocalEnvironmentValueResolver({
            TEST_USERNAME: 'tester@example.com'
        });

        assert.equal(
            await resolver.resolve('username', {
                source: 'local',
                key: 'TEST_USERNAME',
                sensitive: false
            }),
            'tester@example.com'
        );
        await assert.rejects(
            resolver.resolve('password', {
                source: 'local',
                key: 'MISSING_PASSWORD',
                sensitive: true
            }),
            /password.*MISSING_PASSWORD/u
        );
    });
});

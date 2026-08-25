import type {
    EnvironmentValueResolver,
    EnvironmentVariable,
    JsonValue,
} from '@ai-web-test-engine/core';

/** 从环境定义的安全字面量或当前 Node.js 进程环境中解析实际值。 */
export class LocalEnvironmentValueResolver implements EnvironmentValueResolver {
    /** 允许测试传入隔离的环境变量集合。 */
    constructor(
        private readonly processEnvironment: Readonly<
            Record<string, string | undefined>
        > = process.env
    ) {}

    /** 本地变量只按定义的 key 读取，错误信息不包含变量实际值。 */
    public resolve = (
        logicalName: string,
        variable: EnvironmentVariable
    ): Promise<JsonValue> => {
        if (variable.source === 'literal') {
            return Promise.resolve(variable.value);
        }

        const value = this.processEnvironment[variable.key];
        if (value === undefined) {
            return Promise.reject(new Error(
                `环境变量 ${ logicalName } 缺少本机值：${ variable.key }`
            ));
        }
        return Promise.resolve(value);
    };
}

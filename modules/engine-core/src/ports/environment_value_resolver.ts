import type {
    EnvironmentVariable,
    JsonValue,
} from '../contracts';

/** 在执行边界读取环境变量实际值，Planner 和持久化层只接触逻辑名称。 */
export interface EnvironmentValueResolver {
    resolve: (
        logicalName: string,
        variable: EnvironmentVariable
    ) => Promise<JsonValue>;
}

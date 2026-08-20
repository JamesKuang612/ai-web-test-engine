/** 区分可展示给用户的错误和内部基础设施错误。 */
export enum ErrorTypes {
    user = 'UserError',
    database = 'DatabaseError'
}

/** 维护稳定错误码与默认错误文案之间的映射。 */
export const errorMessages: Record<number, string> = {
    100: 'Missing RabbitMQ Connection',
    1001: 'Example Error'
};

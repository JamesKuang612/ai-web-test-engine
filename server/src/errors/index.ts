import _ from 'lodash';

import type { ErrorBuilder} from 'nstarter-core';
import { NsError, registerErrorMessages } from 'nstarter-core';
import { ErrorTypes, errorMessages } from './err_msgs';

registerErrorMessages(errorMessages);

const errors = {} as any as Record<keyof typeof ErrorTypes, ErrorBuilder>;

type ErrorTypeKeys = keyof typeof ErrorTypes;

// 按错误类型动态创建统一工厂，业务代码无需直接构造 NsError。
_.forEach(Object.keys(ErrorTypes) as ErrorTypeKeys[], (errorType: ErrorTypeKeys) => {
    errors[errorType] = (...args) => new NsError(ErrorTypes[errorType], ...args) as Error;
});

export {
    errors as Errors
};

import type {
    NextFunction,
    Request,
    Response,
} from 'express';
import { controller } from 'nstarter-core';
import {
    testDefinitionService,
} from '../services';
import {
    TestDefinitionInputError,
    TestDefinitionNotFoundError,
    TestDefinitionService,
} from '../services/test_definition.service';

/** 为前端提供真实 YAML 用例的读取、新建、保存与删除接口。 */
@controller()
export class TestDefinitionController {
    constructor(
        private readonly service: Pick<
            TestDefinitionService,
            'create' | 'delete' | 'getRecord' | 'list' | 'update'
        > = testDefinitionService
    ) {}

    public list = async (
        _req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            res.json({
                tests: await this.service.list()
            });
        } catch (error) {
            next(error);
        }
    };

    public get = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const record = await this.service.getRecord(req.params.testId);
            res.json({
                record,
                test: record.definition
            });
        } catch (error) {
            this.handleKnownError(error, res, next);
        }
    };

    public delete = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            await this.service.delete(req.params.testId);
            res.status(204).end();
        } catch (error) {
            this.handleKnownError(error, res, next);
        }
    };

    public create = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            res.status(201).json({
                record: await this.service.create(req.body ?? {})
            });
        } catch (error) {
            this.handleKnownError(error, res, next);
        }
    };

    public update = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            res.json({
                record: await this.service.update(
                    req.params.testId,
                    req.body ?? {}
                )
            });
        } catch (error) {
            this.handleKnownError(error, res, next);
        }
    };

    private handleKnownError(
        error: unknown,
        res: Response,
        next: NextFunction
    ): void {
        if (error instanceof TestDefinitionInputError) {
            res.status(400).json({
                code: 'INVALID_TEST_DEFINITION',
                error: error.message
            });
            return;
        }
        if (error instanceof TestDefinitionNotFoundError) {
            res.status(404).json({
                code: 'TEST_DEFINITION_NOT_FOUND',
                error: error.message
            });
            return;
        }
        next(error);
    }
}

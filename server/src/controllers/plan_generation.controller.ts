import type {
    NextFunction,
    Request,
    Response,
} from 'express';
import { controller } from 'nstarter-core';
import {
    planGenerationService,
} from '../services';
import {
    PlanGenerationInputError,
    PlanGenerationService,
} from '../services/plan_generation.service';

/** 暴露成功探索之后由用户主动触发的计划生成接口。 */
@controller()
export class PlanGenerationController {
    constructor(
        private readonly plans: Pick<PlanGenerationService, 'generate'> =
            planGenerationService
    ) {}

    public generate = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const result = await this.plans.generate(req.params.runId);
            res.status(result.status === 'SUCCEEDED' ? 201 : 422).json({
                planGeneration: result
            });
        } catch (error) {
            if (error instanceof PlanGenerationInputError) {
                res.status(400).json({
                    code: 'INVALID_RUN_ID',
                    error: error.message
                });
                return;
            }
            next(error);
        }
    };
}

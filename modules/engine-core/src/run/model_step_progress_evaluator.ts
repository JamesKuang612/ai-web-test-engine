import type {
    SemanticStepProgress,
} from '../contracts';
import type {
    ModelAdapter,
    RuntimeSchema,
} from '../ports';
import type {
    StepProgressModelInput,
    StepProgressModelPort,
} from './semantic_step_progress_evaluator';

interface ModelProgressDecision {
    status: SemanticStepProgress['status'];
    summary: string;
}

/** 只分类语义进展；输入和输出都不存在执行动作的能力。 */
export class ModelStepProgressEvaluator implements StepProgressModelPort {
    constructor(private readonly modelAdapter: ModelAdapter) {}

    public async evaluate(
        input: StepProgressModelInput,
        signal: AbortSignal
    ): Promise<SemanticStepProgress> {
        const result = await this.modelAdapter.generateStructured({
            systemPrompt: [
                '你是 Web 测试 SemanticStep 进度分类器。',
                '只能判断 complete、progress、no-progress、wrong-state 或 unknown。',
                'Effect confirmed 只证明局部页面变化，不自动等于 complete。',
                '缺少明确 expectedEffect 或语义证据不足时返回 unknown。',
                '你没有提出或执行任何动作的权限。'
            ].join('\n'),
            userPrompt: JSON.stringify(input, null, 2),
            timeoutMs: 30_000,
            maxOutputTokens: 400
        }, modelProgressSchema, signal);
        return {
            ...result.value,
            basis: 'model',
            evidence: []
        };
    }
}

const modelProgressSchema: RuntimeSchema<ModelProgressDecision> = {
    name: 'SemanticStepProgressDecision',
    jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: [ 'status', 'summary' ],
        properties: {
            status: {
                type: 'string',
                enum: [
                    'complete', 'progress', 'no-progress', 'wrong-state',
                    'unknown'
                ]
            },
            summary: { type: 'string', minLength: 1 }
        }
    },
    parse: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('SemanticStepProgressDecision 必须是对象。');
        }
        const object = value as Record<string, unknown>;
        const allowed = [
            'complete', 'progress', 'no-progress', 'wrong-state', 'unknown'
        ] as const;
        if (
            !allowed.includes(object.status as typeof allowed[number])
            || typeof object.summary !== 'string'
            || !object.summary.trim()
            || Object.keys(object).some(
                (key) => key !== 'status' && key !== 'summary'
            )
        ) {
            throw new Error('SemanticStepProgressDecision 字段不合法。');
        }
        return {
            status: object.status as typeof allowed[number],
            summary: object.summary
        };
    }
};

import assert from 'node:assert/strict';
import {
    describe,
    it,
} from 'mocha';
import {
    buildCandidateAnnotationDemand,
    parseVisualCandidateAnnotations,
    toVisualCandidateBoxes,
} from '../../../../src/adapters/visual';

describe('MidsceneVisualCandidateAnnotator', () => {
    it('要求模型一次返回全部候选框的中文视觉名称', () => {
        const demand = buildCandidateAnnotationDemand([
            'e1',
            'e2'
        ]);

        assert.match(demand.annotations, /e1、e2/u);
        assert.match(demand.annotations, /visualDescription/u);
        assert.match(demand.annotations, /不得返回候选 ID 列表之外/u);
    });

    it('只保留白名单内、字段合法且不重复的视觉标注', () => {
        const annotations = parseVisualCandidateAnnotations({
            annotations: [
                {
                    candidateId: 'e1',
                    visualDescription: ' 空心五角星图标，收藏按钮 ',
                    elementType: ' 图标按钮 ',
                    confidence: 0.92
                },
                {
                    candidateId: 'e1',
                    visualDescription: '重复结果'
                },
                {
                    candidateId: 'invented',
                    visualDescription: '模型虚构的候选'
                },
                {
                    candidateId: 'e2',
                    visualDescription: '齿轮图标，设置按钮',
                    confidence: 2
                },
                {
                    candidateId: 'e3',
                    visualDescription: ''
                }
            ]
        }, new Set([
            'e1',
            'e2',
            'e3'
        ]));

        assert.deepEqual(annotations, [
            {
                candidateId: 'e1',
                visualDescription: '空心五角星图标，收藏按钮',
                elementType: '图标按钮',
                confidence: 0.92
            },
            {
                candidateId: 'e2',
                visualDescription: '齿轮图标，设置按钮'
            }
        ]);
    });

    it('只为当前视口内可见、可用且有边界的候选创建框', () => {
        const candidates = [
            createCandidate('e1'),
            {
                ...createCandidate('e2'),
                inViewport: false
            },
            {
                ...createCandidate('e3'),
                disabled: true
            },
            {
                ...createCandidate('e4'),
                boundingBox: undefined
            }
        ];

        assert.deepEqual(toVisualCandidateBoxes(candidates), [{
            candidateId: 'e1',
            x: 10,
            y: 20,
            width: 30,
            height: 40
        }]);
    });
});

function createCandidate(candidateId: string) {
    return {
        candidateId,
        tag: 'button',
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        boundingBox: {
            x: 10,
            y: 20,
            width: 30,
            height: 40
        },
        locatorHints: []
    };
}

import {
    cleanup,
    render,
    screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type {
    TestDefinitionDto,
} from './api/test-definitions';
import App from './App';
import './setupTests';

const LOGIN_ACTION =
    '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。';
const AVATAR_ACTION = [
    '使用环境变量中的账号和密码登录简道云，等待工作台加载完成；',
    '点击页面右上角用户头像，确认账号菜单成功展开；',
    '从上到下逐字严格验证账号菜单完整显示以下文本：',
    '“吾名佳欣”、“测试企业(31186)”、“我创建的”、',
    '“我的收藏”、“个人设置”、“管理后台”、“版本购买”、',
    '“语言”、“简体中文”、“退出”。',
    '以上每项均为精确文本断言，顺序、文字或缺失任一不符均判定失败。'
].join('');
const DEFAULT_START_URL = 'https://test.jdydevelop.com/dashboard#/';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
});

describe('App routes', () => {
    it('renders real tests in the Chinese repository workspace', async () => {
        installApiMock();
        renderApp('/repository');

        expect(screen.getByRole('heading', {
            name: '项目文件'
        })).toBeInTheDocument();
        expect(await screen.findByText(
            'login-and-open-workbench.test.yaml'
        )).toBeInTheDocument();
        expect(screen.getByText('avatar-account-menu.test.yaml'))
            .toBeInTheDocument();
        expect(screen.getByText('工作区干净')).toBeInTheDocument();
    });

    it('filters repository definitions loaded from the backend', async () => {
        const user = userEvent.setup();
        installApiMock();
        renderApp('/repository');
        await screen.findByText('avatar-account-menu.test.yaml');

        await user.click(screen.getByRole('button', { name: /搜索/u }));
        await user.type(
            screen.getByRole('searchbox', { name: '搜索文件或描述' }),
            '账号菜单'
        );

        expect(screen.getByText('avatar-account-menu.test.yaml'))
            .toBeInTheDocument();
        expect(screen.queryByText('login-and-open-workbench.test.yaml'))
            .not.toBeInTheDocument();
    });

    it('loads the selected YAML definition in the editor', async () => {
        const user = userEvent.setup();
        installApiMock();
        renderApp('/tests/login-and-open-workbench');

        expect(await screen.findByDisplayValue(LOGIN_ACTION))
            .toBeInTheDocument();
        expect(screen.getByText('login-and-open-workbench.test.yaml'))
            .toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '选项' }));
        expect(screen.getByLabelText('用例名称'))
            .toHaveValue('登录并打开简道云工作台');
        expect(screen.getByLabelText('起始地址'))
            .toHaveValue(DEFAULT_START_URL);
        expect(screen.getByText('已保存')).toBeInTheDocument();
    });

    it('loads the strict account menu action from YAML', async () => {
        installApiMock();
        renderApp('/tests/avatar-account-menu');

        expect((await screen.findByLabelText(
            '操作步骤 1'
        ) as HTMLTextAreaElement).value).toContain('登录简道云');
        expect((screen.getByLabelText(
            '操作步骤 3'
        ) as HTMLTextAreaElement).value).toContain('从上到下逐字严格验证');
        expect(screen.getByText('avatar-account-menu.test.yaml'))
            .toBeInTheDocument();
    });

    it('creates an empty test from the repository dialog', async () => {
        const user = userEvent.setup();
        const api = installApiMock();
        renderApp('/repository');
        await screen.findByText('login-and-open-workbench.test.yaml');

        await user.click(screen.getByRole('button', { name: '新建测试' }));
        await user.type(screen.getByLabelText('新建用例名称'), 'My Todo Flow');
        await user.click(screen.getByRole('button', { name: '创建测试' }));

        expect(await screen.findByText('my-todo-flow.test.yaml'))
            .toBeInTheDocument();
        expect(screen.getByText('还没有操作步骤')).toBeInTheDocument();
        const createCall = api.mock.calls.find(([input, init]) => (
            String(input) === '/api/tests' && init?.method === 'POST'
        ));
        expect(createCall).toBeDefined();
        expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
            action: '',
            name: 'My Todo Flow',
            setupModules: [ 'jiandaoyun-login' ],
            startUrl: DEFAULT_START_URL
        });
    });

    it('supports adding a natural-language step and switching tabs', async () => {
        const user = userEvent.setup();
        installApiMock();
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '添加步骤' }));
        await user.type(
            screen.getByLabelText('操作步骤 2'),
            '点击“我的待办”。'
        );
        expect(screen.getByLabelText('操作步骤 2'))
            .toHaveValue('点击“我的待办”。');
        expect(screen.getByText('未保存')).toBeInTheDocument();

        await user.click(screen.getByRole('tab', { name: '控制台' }));
        expect(screen.getByText(
            '运行测试后，结果和指标会显示在这里。'
        )).toBeInTheDocument();
    });
});

describe('Run debug workbench', () => {
    it('sends generic context and stores a per-test replay plan', async () => {
        const user = userEvent.setup();
        const api = installApiMock();
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByText('测试通过')).toBeInTheDocument();
        const runCall = api.mock.calls.find(([input]) => (
            String(input) === '/api/debug/runs'
        ));
        const request = JSON.parse(
            String(runCall?.[1]?.body)
        ) as Record<string, unknown>;
        expect(request).toMatchObject({
            action: LOGIN_ACTION,
            mode: 'ai-explore',
            setupModules: [ 'jiandaoyun-login' ],
            startUrl: DEFAULT_START_URL,
            testId: 'login-and-open-workbench',
            testName: '登录并打开简道云工作台'
        });
        expect(window.localStorage.getItem(
            'ai-web-test-engine.plan-ref.login-and-open-workbench'
        )).toBeNull();
        await user.click(screen.getByRole('tab', { name: '控制台' }));
        await user.click(screen.getByRole('button', {
            name: '生成结构化计划'
        }));
        expect(await screen.findByText('计划生成成功')).toBeInTheDocument();
        expect(window.localStorage.getItem(
            'ai-web-test-engine.plan-ref.login-and-open-workbench'
        )).toBe('source-run/json/compiled-plan.json');
        const planSaveCall = api.mock.calls.find(([input, init]) => (
            String(input) === '/api/tests/login-and-open-workbench'
            && init?.method === 'PUT'
            && String(init.body).includes('compiled-plan.json')
        ));
        expect(planSaveCall).toBeDefined();
        await user.click(screen.getByRole('tab', { name: '时间线' }));
        expect(screen.getByText('页面状态已采集')).toBeInTheDocument();
        expect(screen.getByText('最终判定依据')).toBeInTheDocument();
        expect(screen.getByText('最终判定使用此页面观察'))
            .toBeInTheDocument();
        expect(screen.getByRole('img', { name: '当前运行截图' }))
            .toHaveAttribute(
                'src',
                '/api/debug/artifact?ref=run-debug-001%2Fartifacts%2Fscreen.png'
            );

        await user.click(screen.getByRole('tab', { name: '控制台' }));
        await user.click(screen.getByRole('button', {
            name: '使用此计划回放'
        }));
        await user.click(screen.getByRole('button', { name: '选项' }));
        expect(screen.getByLabelText('运行模式'))
            .toHaveValue('structured-replay');
    });

    it('shows plan generation failures in the console and allows retry', async () => {
        const user = userEvent.setup();
        const api = installApiMock({
            planBody: {
                planGeneration: {
                    schemaVersion: 1,
                    runId: 'run-debug-001',
                    status: 'FAILED',
                    summary: '第 2 步效果未经确认，不能编译。',
                    failure: {
                        category: 'TRACE_COMPILE_ERROR',
                        phase: 'COMPILING_PLAN',
                        recoverable: true,
                        summary: '第 2 步效果未经确认，不能编译。'
                    }
                }
            },
            planStatus: 422
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));
        expect(await screen.findByText('测试通过')).toBeInTheDocument();
        await user.click(screen.getByRole('tab', { name: '控制台' }));
        await user.click(screen.getByRole('button', {
            name: '生成结构化计划'
        }));

        expect(await screen.findByText('计划生成失败')).toBeInTheDocument();
        expect(screen.getByText('第 2 步效果未经确认，不能编译。'))
            .toBeInTheDocument();
        expect(screen.getByRole('button', {
            name: '重新生成计划'
        })).toBeInTheDocument();
        expect(api.mock.calls.filter(([input]) => (
            String(input) === '/api/debug/runs/run-debug-001/plan'
        ))).toHaveLength(1);
    });

    it('shows backend validation errors in the console', async () => {
        const user = userEvent.setup();
        installApiMock({
            startBody: {
                error: 'startUrl 只允许测试环境 Host。'
            },
            startStatus: 400
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'startUrl 只允许测试环境 Host。'
        );
    });

    it('distinguishes uncertain verdicts from failed runs', async () => {
        const user = userEvent.setup();
        installApiMock({
            currentSession: {
                ...createRunSession('COMPLETED'),
                result: {
                    ...createDebugRunResult(),
                    result: 'UNCERTAIN',
                    summary: '最终页面证据不足，无法判断。'
                }
            }
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByText('需要确认')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '待确认' }))
            .toBeInTheDocument();
        expect(screen.queryByText('运行未通过')).not.toBeInTheDocument();
    });

    it('actively cancels the same running session', async () => {
        const user = userEvent.setup();
        const api = installApiMock({
            currentSession: createRunSession('RUNNING'),
            cancelSession: createRunSession('CANCELLED')
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));
        await user.click(await screen.findByRole('button', { name: '终止' }));

        expect(await screen.findByText('运行已终止')).toBeInTheDocument();
        expect(api.mock.calls.some(([input, init]) => (
            String(input) === `/api/debug/runs/${ RUN_SESSION_ID }`
            && init?.method === 'DELETE'
        ))).toBe(true);
    });
});

interface ApiMockOptions {
    cancelSession?: ReturnType<typeof createRunSession>;
    currentSession?: ReturnType<typeof createRunSession>;
    startBody?: unknown;
    startStatus?: number;
    planBody?: unknown;
    planStatus?: number;
}

const RUN_SESSION_ID = '8d482633-14a6-4a13-a52f-bfb0617b14dc';

function installApiMock(options: ApiMockOptions = {}) {
    const definitions = new Map<string, TestDefinitionDto>([
        ['login-and-open-workbench', createDefinition({
            id: 'login-and-open-workbench',
            name: '登录并打开简道云工作台',
            action: LOGIN_ACTION,
            setupModules: [ 'jiandaoyun-login' ]
        })],
        ['avatar-account-menu', createDefinition({
            id: 'avatar-account-menu',
            name: '验证头像账号菜单',
            action: AVATAR_ACTION
        })]
    ]);
    const fetchMock = vi.fn(async (
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url === '/api/tests' && method === 'GET') {
            return jsonResponse({
                tests: [...definitions.values()].map(toRecord)
            });
        }
        if (url === '/api/tests' && method === 'POST') {
            const draft = JSON.parse(String(init?.body)) as {
                action: string,
                name: string,
                startUrl: string
            };
            const definition = createDefinition({
                ...draft,
                id: 'my-todo-flow'
            });
            definitions.set(definition.id, definition);
            return jsonResponse({
                record: toRecord(definition)
            }, 201);
        }
        if (url.startsWith('/api/tests/')) {
            const id = decodeURIComponent(url.slice('/api/tests/'.length));
            const definition = definitions.get(id);
            if (!definition) {
                return jsonResponse({ error: '没有找到测试用例。' }, 404);
            }
            if (method === 'PUT') {
                const draft = JSON.parse(String(init?.body)) as {
                    action: string,
                    name: string,
                    planRef?: null | string,
                    setupModules?: Array<'jiandaoyun-login'>,
                    startUrl: string
                };
                const updated = createDefinition({
                    id,
                    ...draft,
                    planRef: draft.planRef ?? undefined
                });
                definitions.set(id, updated);
                return jsonResponse({ record: toRecord(updated) });
            }
            return jsonResponse({ test: definition });
        }
        if (url === '/api/debug/runs' && method === 'POST') {
            return jsonResponse(
                options.startBody ?? {
                    session: createRunSession('RUNNING')
                },
                options.startStatus ?? 202
            );
        }
        if (url === `/api/debug/runs/${ RUN_SESSION_ID }`) {
            if (method === 'DELETE') {
                return jsonResponse({
                    session: options.cancelSession
                        ?? createRunSession('CANCELLED')
                }, 202);
            }
            return jsonResponse({
                session: options.currentSession
                    ?? createRunSession('COMPLETED')
            });
        }
        if (
            url === '/api/debug/runs/run-debug-001/plan'
            && method === 'POST'
        ) {
            return jsonResponse(
                options.planBody ?? {
                    planGeneration: {
                        schemaVersion: 1,
                        runId: 'run-debug-001',
                        status: 'SUCCEEDED',
                        summary: '结构化计划已生成，共 4 个步骤。',
                        compiledPlanRef: 'source-run/json/compiled-plan.json'
                    }
                },
                options.planStatus ?? 201
            );
        }
        return jsonResponse({ error: 'Not found.' }, 404);
    });
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function createDefinition(input: {
    action: string,
    id: string,
    name: string,
    planRef?: string,
    setupModules?: Array<'jiandaoyun-login'>,
    startUrl?: string
}): TestDefinitionDto {
    return {
        schemaVersion: 1,
        id: input.id,
        name: input.name,
        environmentId: 'jiandaoyun-test',
        startUrl: input.startUrl ?? DEFAULT_START_URL,
        action: input.action,
        ...input.planRef || input.setupModules?.length
            ? {
                execution: {
                    ...input.planRef
                        ? {
                            planRef: input.planRef,
                            preferredMode: 'structured-replay' as const
                        }
                        : {},
                    ...input.setupModules?.length
                        ? { setupModules: input.setupModules }
                        : {}
                }
            }
            : {}
    };
}

function toRecord(definition: TestDefinitionDto) {
    return {
        definition,
        fileName: `${ definition.id }.test.yaml`,
        updatedAt: '2026-08-26T00:00:00.000Z'
    };
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

function renderApp(path: string) {
    render(
        <MemoryRouter initialEntries={[path]}>
            <App />
        </MemoryRouter>
    );
}

function createDebugRunResult() {
    return {
        schemaVersion: 1,
        runId: 'run-debug-001',
        lifecycle: 'COMPLETED',
        result: 'PASS',
        summary: '页面已经进入简道云工作台。',
        evidence: [{
            kind: 'json',
            ref: 'run-debug-001/json/verdict.json'
        }],
        traceRef: 'run-debug-001/trace.jsonl',
        metrics: {
            actionCount: 4,
            durationMs: 30_000,
            modelCallCount: 6,
            repeatedStateActionCount: 0
        }
    };
}

function createRunSession(
    status: 'CANCELLED' | 'COMPLETED' | 'RUNNING'
) {
    return {
        schemaVersion: 1,
        sessionId: RUN_SESSION_ID,
        status,
        createdAt: '2026-08-26T08:00:00.000Z',
        updatedAt: '2026-08-26T08:00:03.000Z',
        events: status === 'COMPLETED'
            ? [createObservationEvent(), createVerdictEvent()]
            : [],
        ...status === 'COMPLETED'
            ? { result: createDebugRunResult(), runId: 'run-debug-001' }
            : {},
        ...status === 'CANCELLED'
            ? { error: '运行已由用户终止。' }
            : {}
    };
}

function createObservationEvent() {
    return {
        schemaVersion: 1,
        eventId: 'event-observation-001',
        runId: 'run-debug-001',
        type: 'observation.created',
        sequence: 8,
        timestamp: '2026-08-26T08:00:03.000Z',
        payload: {
            observationRef:
                'run-debug-001/json/observation-after-action-4.json',
            screenshotRef: 'run-debug-001/artifacts/screen.png',
            url: DEFAULT_START_URL
        }
    };
}

function createVerdictEvent() {
    return {
        schemaVersion: 1,
        eventId: 'event-verdict-001',
        runId: 'run-debug-001',
        type: 'verdict.completed',
        sequence: 9,
        timestamp: '2026-08-26T08:00:04.000Z',
        payload: {
            observationRef:
                'run-debug-001/json/observation-after-action-4.json',
            result: 'PASS',
            summary: '页面已经进入简道云工作台。'
        }
    };
}

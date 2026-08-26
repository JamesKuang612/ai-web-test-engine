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
        installApiMock();
        renderApp('/tests/login-and-open-workbench');

        expect(await screen.findByDisplayValue(LOGIN_ACTION))
            .toBeInTheDocument();
        expect(screen.getByText('login-and-open-workbench.test.yaml'))
            .toBeInTheDocument();
        expect(screen.getByLabelText('用例名称'))
            .toHaveValue('登录并打开简道云工作台');
        expect(screen.getByLabelText('起始地址'))
            .toHaveValue(DEFAULT_START_URL);
        expect(screen.getByText('已保存')).toBeInTheDocument();
    });

    it('loads the strict account menu action from YAML', async () => {
        installApiMock();
        renderApp('/tests/avatar-account-menu');

        expect(await screen.findByDisplayValue(AVATAR_ACTION))
            .toBeInTheDocument();
        expect(screen.getByText('avatar-account-menu.test.yaml'))
            .toBeInTheDocument();
        expect(screen.getAllByText(/从上到下逐字严格验证/u))
            .not.toHaveLength(0);
    });

    it('creates and saves a new real test definition', async () => {
        const user = userEvent.setup();
        const api = installApiMock();
        renderApp('/tests/new');

        await user.type(screen.getByLabelText('用例名称'), 'My Todo Flow');
        await user.type(
            screen.getByLabelText('测试动作'),
            '点击“我的待办”，严格验证页面显示“我的待办”。'
        );
        await user.click(screen.getByRole('button', { name: '保存' }));

        expect(await screen.findByText('my-todo-flow.test.yaml'))
            .toBeInTheDocument();
        const createCall = api.mock.calls.find(([input, init]) => (
            String(input) === '/api/tests' && init?.method === 'POST'
        ));
        expect(createCall).toBeDefined();
        expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
            name: 'My Todo Flow',
            startUrl: DEFAULT_START_URL
        });
    });

    it('supports adding a natural-language step and switching tabs', async () => {
        const user = userEvent.setup();
        installApiMock();
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '添加步骤' }));
        expect(screen.getByText('点击此处描述下一个测试步骤。'))
            .toBeInTheDocument();
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
        const api = installApiMock({
            runBody: {
                result: createDebugRunResult()
            }
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByText('测试通过')).toBeInTheDocument();
        const runCall = api.mock.calls.find(([input]) => (
            String(input) === '/api/debug/run'
        ));
        const request = JSON.parse(
            String(runCall?.[1]?.body)
        ) as Record<string, unknown>;
        expect(request).toMatchObject({
            action: LOGIN_ACTION,
            mode: 'ai-explore',
            startUrl: DEFAULT_START_URL,
            testId: 'login-and-open-workbench',
            testName: '登录并打开简道云工作台'
        });
        expect(window.localStorage.getItem(
            'ai-web-test-engine.plan-ref.login-and-open-workbench'
        )).toBe('source-run/json/compiled-plan.json');
        const planSaveCall = api.mock.calls.find(([input, init]) => (
            String(input) === '/api/tests/login-and-open-workbench'
            && init?.method === 'PUT'
            && String(init.body).includes('compiled-plan.json')
        ));
        expect(planSaveCall).toBeDefined();

        await user.click(screen.getByRole('button', {
            name: '使用此计划回放'
        }));
        expect(screen.getByLabelText('运行模式'))
            .toHaveValue('structured-replay');
    });

    it('shows backend validation errors in the console', async () => {
        const user = userEvent.setup();
        installApiMock({
            runBody: {
                error: 'startUrl 只允许测试环境 Host。'
            },
            runStatus: 400
        });
        renderApp('/tests/login-and-open-workbench');
        await screen.findByDisplayValue(LOGIN_ACTION);

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'startUrl 只允许测试环境 Host。'
        );
    });
});

interface ApiMockOptions {
    runBody?: unknown;
    runStatus?: number;
}

function installApiMock(options: ApiMockOptions = {}) {
    const definitions = new Map<string, TestDefinitionDto>([
        ['login-and-open-workbench', createDefinition({
            id: 'login-and-open-workbench',
            name: '登录并打开简道云工作台',
            action: LOGIN_ACTION
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
        if (url === '/api/debug/run') {
            return jsonResponse(
                options.runBody ?? { result: createDebugRunResult() },
                options.runStatus ?? 200
            );
        }
        return jsonResponse({ error: 'Not found.' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function createDefinition(input: {
    action: string,
    id: string,
    name: string,
    planRef?: string,
    startUrl?: string
}): TestDefinitionDto {
    return {
        schemaVersion: 1,
        id: input.id,
        name: input.name,
        environmentId: 'jiandaoyun-test',
        startUrl: input.startUrl ?? DEFAULT_START_URL,
        action: input.action,
        ...input.planRef
            ? {
                execution: {
                    planRef: input.planRef,
                    preferredMode: 'structured-replay'
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
        compiledPlanRef: 'source-run/json/compiled-plan.json',
        metrics: {
            actionCount: 8,
            durationMs: 30_000,
            modelCallCount: 7,
            repeatedStateActionCount: 0
        }
    };
}

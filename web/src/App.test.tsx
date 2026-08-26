import {
    cleanup,
    render,
    screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';
import App from './App';
import './setupTests';

describe('App routes', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the Chinese repository workspace', () => {
        render(
            <MemoryRouter initialEntries={['/repository']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByRole('heading', {
            name: '项目文件'
        })).toBeInTheDocument();
        expect(screen.getByText(
            'login-and-open-workbench.test.yaml'
        )).toBeInTheDocument();
        expect(screen.getByText('工作区干净')).toBeInTheDocument();
    });

    it('filters repository entries by search text', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter initialEntries={['/repository']}>
                <App />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: /搜索/u }));
        await user.type(
            screen.getByRole('searchbox', { name: '搜索文件或描述' }),
            '删除'
        );

        expect(screen.getByText('delete-record.test.yaml'))
            .toBeInTheDocument();
        expect(screen.queryByText(
            'login-and-open-workbench.test.yaml'
        )).not.toBeInTheDocument();
    });

    it('renders the selected test in the Chinese editor workbench', () => {
        render(
            <MemoryRouter initialEntries={[
                '/tests/login-and-open-workbench'
            ]}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByText(
            'login-and-open-workbench.test.yaml'
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '运行' }))
            .toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '上下文' }))
            .toHaveAttribute('aria-selected', 'true');
        expect(screen.getByLabelText('浏览器地址'))
            .toHaveValue('https://test.jdydevelop.com/portal/signin');
    });

    it('loads the account menu acceptance scenario', () => {
        render(
            <MemoryRouter initialEntries={[
                '/tests/avatar-account-menu'
            ]}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByText('avatar-account-menu.test.yaml'))
            .toBeInTheDocument();
        expect(screen.getByLabelText('测试动作')).toHaveValue(
            '使用环境变量中的账号和密码登录简道云，等待工作台加载完成；'
            + '点击页面右上角用户头像，确认账号菜单成功展开；'
            + '从上到下逐字严格验证账号菜单完整显示以下文本：'
            + '“吾名佳欣”、“测试企业(31186)”、“我创建的”、'
            + '“我的收藏”、“个人设置”、“管理后台”、“版本购买”、'
            + '“语言”、“简体中文”、“退出”。'
            + '以上每项均为精确文本断言，顺序、文字或缺失任一不符均判定失败。'
        );
        expect(screen.getByRole('button', {
            name: [
                '点击页面右上角用户头像，验证账号菜单已展开，',
                '并按顺序逐字显示“吾名佳欣”、“测试企业(31186)”、',
                '“我创建的”、“我的收藏”、“个人设置”、“管理后台”、',
                '“版本购买”、“语言”、“简体中文”、“退出”。'
            ].join('')
        })).toBeInTheDocument();
    });

    it('supports adding a step and switching inspector tabs', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter initialEntries={['/tests/dashboard-navigation']}>
                <App />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: '添加步骤' }));
        expect(screen.getByText('点击此处描述下一个测试步骤。'))
            .toBeInTheDocument();

        await user.click(screen.getByRole('tab', { name: '控制台' }));
        expect(screen.getByText(
            '运行测试后，结果和指标会显示在这里。'
        )).toBeInTheDocument();
    });
});

describe('Run debug workbench', () => {
    afterEach(() => {
        cleanup();
        window.localStorage.clear();
        vi.unstubAllGlobals();
    });

    it('runs AI explore and prepares the returned plan for replay', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            JSON.stringify({
                result: createDebugRunResult()
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        ));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <MemoryRouter initialEntries={[
                '/tests/login-and-open-workbench'
            ]}>
                <App />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByText('测试通过')).toBeInTheDocument();
        expect(screen.getByText('页面已经进入简道云工作台。'))
            .toBeInTheDocument();
        const request = JSON.parse(
            String(fetchMock.mock.calls[0][1]?.body)
        ) as Record<string, unknown>;
        expect(request.mode).toBe('ai-explore');
        expect(request.planRef).toBeUndefined();

        await user.click(screen.getByRole('button', {
            name: '使用此计划回放'
        }));
        expect(screen.getByLabelText('运行模式'))
            .toHaveValue('structured-replay');
        expect(screen.getByLabelText('计划引用')).toHaveValue(
            'source-run/json/compiled-plan.json'
        );
        expect(window.localStorage.getItem(
            'ai-web-test-engine.last-plan-ref'
        )).toBe('source-run/json/compiled-plan.json');
    });

    it('shows backend validation errors in the console', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
            JSON.stringify({
                error: 'structured-replay 必须提供合法的 planRef。'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        )));
        render(
            <MemoryRouter initialEntries={[
                '/tests/login-and-open-workbench'
            ]}>
                <App />
            </MemoryRouter>
        );

        await user.click(screen.getByRole('button', { name: '运行' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'structured-replay 必须提供合法的 planRef。'
        );
    });
});

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

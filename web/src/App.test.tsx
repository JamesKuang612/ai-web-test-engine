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

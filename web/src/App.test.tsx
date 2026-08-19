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
    it
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
            '运行测试后，页面日志会显示在这里。'
        )).toBeInTheDocument();
    });
});

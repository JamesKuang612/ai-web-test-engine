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

    it('renders the selected test in the editor route', () => {
        render(
            <MemoryRouter initialEntries={['/tests/login-flow']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByRole('heading', {
            name: '测试编辑与执行工作台'
        })).toBeInTheDocument();
        expect(screen.getByText('login-flow')).toBeInTheDocument();
    });
});

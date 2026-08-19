import {
    cleanup,
    render,
    screen
} from '@testing-library/react';
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

    it('renders the repository page', () => {
        render(
            <MemoryRouter initialEntries={['/repository']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByRole('heading', {
            name: '本地测试项目'
        })).toBeInTheDocument();
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

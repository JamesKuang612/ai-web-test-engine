import {
    Navigate,
    Route,
    Routes
} from 'react-router-dom';
import { RepositoryPage } from './views/RepositoryPage';
import { TestEditorPage } from './views/TestEditorPage';

export default function App() {
    return (
        <Routes>
            <Route
                path="/"
                element={<Navigate replace to="/repository" />}
            />
            <Route path="/repository" element={<RepositoryPage />} />
            <Route path="/tests/:testId" element={<TestEditorPage />} />
            <Route
                path="*"
                element={<Navigate replace to="/repository" />}
            />
        </Routes>
    );
}

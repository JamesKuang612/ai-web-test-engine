import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function TestEditorPage() {
    const { testId } = useParams();

    return (
        <main className="editor-placeholder">
            <Link className="editor-back-link" to="/repository">
                <Icon name="chevron-right" size={16} />
                返回项目文件
            </Link>
            <section>
                <p>测试编辑器</p>
                <h1>测试编辑与执行工作台</h1>
                <span>
                    当前测试：<code>{testId}</code>
                </span>
                <p>
                    下一阶段将在这里加入 AI Action、浏览器预览、执行状态和证据面板。
                </p>
            </section>
        </main>
    );
}

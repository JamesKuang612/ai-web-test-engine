import fs from 'node:fs';
import path from 'node:path';

/**
 * 将相对产物目录固定到工作区根，并保留旧的 server 工作目录作为只读兼容源。
 */
export function resolveArtifactRootDirectories(
    configuredRoot: string
): string[] {
    if (path.isAbsolute(configuredRoot)) {
        return [path.resolve(configuredRoot)];
    }
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    return [...new Set([
        path.resolve(workspaceRoot, configuredRoot),
        path.resolve(process.cwd(), configuredRoot),
        path.resolve(workspaceRoot, 'server', configuredRoot)
    ])];
}

function findWorkspaceRoot(startDirectory: string): string {
    let current = path.resolve(startDirectory);
    while (true) {
        const manifestPath = path.join(current, 'package.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(
                    fs.readFileSync(manifestPath, 'utf8')
                ) as { name?: string, workspaces?: unknown };
                if (
                    manifest.name === 'ai-web-test-engine'
                    && Array.isArray(manifest.workspaces)
                ) {
                    return current;
                }
            } catch {
                // 继续向父目录查找可信工作区根目录。
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(startDirectory);
        }
        current = parent;
    }
}

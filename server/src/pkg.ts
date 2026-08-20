import fs from 'fs';
import path from 'path';

/** 读取并解析指定路径下的 package.json 文件。 */
const loadPkg = (pkgPath: string) => {
    return JSON.parse(
        fs.readFileSync(pkgPath, 'utf-8')
    );
};

const pkgPath = path.join(__dirname, '../../package.json');
export const pkg = loadPkg(pkgPath);

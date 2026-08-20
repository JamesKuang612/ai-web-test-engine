import _ from 'lodash';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RunEnv } from 'nstarter-core';
import { ConfigLoader, ConfigLoadEvents } from 'nstarter-config';
import { Config } from './entities/config';
import './schema';

const version = _.trim(fs.readFileSync(path.join(__dirname, '../../VERSION'), 'utf-8'));
const runEnv = RunEnv[process.env.NODE_ENV as keyof typeof RunEnv] || RunEnv.develop;

// 配置加载顺序体现优先级：本机私有配置优先于仓库内的默认配置。
const loader = new ConfigLoader(Config, {
    files: [
        // 使用项目专属目录加载本机私有配置，避免和其他 NStarter 应用串配置。
        path.join(os.homedir(), '.ai-web-test-engine/config'),
        // 加载配置文件
        './conf.d/config',
        '../conf.d/config'
    ],
    useEnv: true,
    useHotReload: true,
    useIncludes: true,
    extra: {
        env: runEnv,
        hostname: os.hostname(),
        version
    }
});

// 初始化失败时立即终止，避免服务带着不完整配置继续运行。
loader.on(ConfigLoadEvents.init_failed, (err: Error) => {
    process.exit(1);
});

export const config = loader.initialize().getConfig();

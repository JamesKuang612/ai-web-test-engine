import { SchemaManager } from 'nstarter-entity';
import path from 'path';

/** 全局实体 Schema 管理器，用于加载和校验 NStarter 配置实体。 */
export const schemaManager = SchemaManager.Initialize();

const schemaPath = path.join(__dirname, '../resources/entities.schema.json');
// 服务启动时加载构建产物中的实体 Schema 定义。
schemaManager.loadSchemaDefinition(schemaPath);

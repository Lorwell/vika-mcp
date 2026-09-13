import { runStdioServer } from './index.js';
import { Logger } from './logger.js';

runStdioServer().catch((error) => {
  const logger = new Logger('error');
  logger.error('vika_fusion_mcp_fatal', { error });
  process.exitCode = 1;
});

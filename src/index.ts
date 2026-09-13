import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CapabilityRegistry } from './capabilities.js';
import { loadConfig, type AppConfig } from './config.js';
import { VikaClient } from './http/client.js';
import { Logger } from './logger.js';
import { ResolverService } from './resolvers.js';
import { registerAllTools } from './tools/index.js';

export { loadConfig } from './config.js';
export type { AppConfig } from './config.js';
export { PUBLIC_TOOL_NAMES } from './tools/index.js';

export function createVikaMcpServer(config: AppConfig = loadConfig()): McpServer {
  const logger = new Logger(config.logLevel);
  const capabilities = new CapabilityRegistry();
  const client = new VikaClient(config, logger.child({ component: 'client' }), capabilities);
  const resolvers = new ResolverService(client);

  const server = new McpServer(
    {
      name: 'vika-fusion-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerAllTools(server, {
    client,
    logger: logger.child({ component: 'tool' }),
    resolvers,
  });

  return server;
}

export async function runStdioServer(config: AppConfig = loadConfig()): Promise<void> {
  const server = createVikaMcpServer(config);
  const logger = new Logger(config.logLevel);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('vika_fusion_mcp_ready', {
    host: config.host,
  });
}

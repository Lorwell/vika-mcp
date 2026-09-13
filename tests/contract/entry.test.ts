import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { createVikaMcpServer, PUBLIC_TOOL_NAMES } from '../../src/index.js';

describe('package entry point', () => {
  it('can be imported without starting stdio and creates an unconnected server', () => {
    expect(PUBLIC_TOOL_NAMES).toHaveLength(55);

    const server = createVikaMcpServer({
      host: 'https://vika.cn',
      token: 'test-token',
      timeoutMs: 15_000,
      allowInsecureTls: false,
      logLevel: 'error',
    });

    expect(server).toBeInstanceOf(McpServer);
  });
});

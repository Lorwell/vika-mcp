import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolDependencies } from './common.js';
import { registerDatasheetTools } from './datasheets.js';
import { FIELD_CREATE_TOOL_NAMES, registerFieldTools } from './fields.js';
import { registerNodeTools } from './nodes.js';
import { registerOrgTools } from './org.js';
import { registerRecordTools } from './records.js';
import { registerSpaceTools } from './spaces.js';
import { registerViewTools } from './views.js';

export const PUBLIC_TOOL_NAMES: readonly string[] = [
  'get_spaces',
  'get_nodes',
  'search_nodes',
  'get_node_details',
  'create_datasheets',
  'upload_attachments',
  'get_embedlinks',
  'create_embedlinks',
  'delete_embedlinks',
  'get_records',
  'create_records',
  'update_records',
  'delete_records',
  'get_fields',
  ...FIELD_CREATE_TOOL_NAMES,
  'delete_fields',
  'get_views',
  'get_a_member',
  'update_a_member',
  'delete_a_member',
  'list_the_team_members',
  'list_teams',
  'create_a_team',
  'update_a_team',
  'delete_a_team',
  'list_units_under_the_role',
  'list_roles',
  'create_a_role',
  'update_a_role',
  'delete_a_role',
];

export function registerAllTools(server: McpServer, deps: ToolDependencies): void {
  registerSpaceTools(server, deps);
  registerNodeTools(server, deps);
  registerDatasheetTools(server, deps);
  registerRecordTools(server, deps);
  registerFieldTools(server, deps);
  registerViewTools(server, deps);
  registerOrgTools(server, deps);
}

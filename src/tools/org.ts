import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { paginationShape, spaceIdSchema } from '../schemas/common.js';
import { registerTool, type ToolDependencies, ok, requireDestructiveConfirmation } from './common.js';

const unitIdSchema = z.string().min(1).describe('Official member, team, or role unitId.');
const unitIdListSchema = z.array(unitIdSchema).min(1);

function registerMemberTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(server, deps, {
    name: 'get_a_member',
    description: 'Get a member in a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      sensitiveData: z.boolean().optional(),
    }),
    readOnly: true,
    execute: async ({ spaceId, unitId, sensitiveData }) => {
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/spaces/${spaceId}/members/${unitId}`,
        query: { sensitiveData },
        feature: 'get_a_member',
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'update_a_member',
    description: 'Update a member in a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      sensitiveData: z.boolean().optional(),
      name: z.string().min(1).optional(),
      teams: unitIdListSchema.optional(),
      roles: unitIdListSchema.optional(),
    }),
    execute: async ({ spaceId, unitId, sensitiveData, name, teams, roles }) => {
      const { data, meta } = await deps.client.request({
        method: 'PUT',
        path: `/spaces/${spaceId}/members/${unitId}`,
        query: { sensitiveData },
        body: { name, teams, roles },
        feature: 'update_a_member',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'delete_a_member',
    description: 'Delete a member from a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      confirm_destructive: z.boolean().optional(),
    }),
    execute: async ({ spaceId, unitId, confirm_destructive }) => {
      requireDestructiveConfirmation(confirm_destructive);
      const { data, meta } = await deps.client.request({
        method: 'DELETE',
        path: `/spaces/${spaceId}/members/${unitId}`,
        feature: 'delete_a_member',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });
}

function registerTeamTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(server, deps, {
    name: 'list_the_team_members',
    description: 'List members under a team by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      ...paginationShape,
      sensitiveData: z.boolean().optional(),
    }),
    readOnly: true,
    execute: async ({ spaceId, unitId, pageSize, pageNum, sensitiveData }) => {
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/spaces/${spaceId}/teams/${unitId}/members`,
        query: { pageSize, pageNum, sensitiveData },
        feature: 'list_the_team_members',
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'list_teams',
    description: 'List child teams. Omit unitId to list top-level teams through unitId 0.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema.optional(),
      ...paginationShape,
    }),
    readOnly: true,
    execute: async ({ spaceId, unitId, pageSize, pageNum }) => {
      const resolvedUnitId = unitId ?? '0';
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/spaces/${spaceId}/teams/${resolvedUnitId}/children`,
        query: { pageSize, pageNum },
        feature: 'list_teams',
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'create_a_team',
    description: 'Create a team in a space.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      name: z.string().min(1),
      sequence: z.number().int().optional(),
      parentUnitId: unitIdSchema.optional(),
      roles: unitIdListSchema.optional(),
    }),
    execute: async ({ spaceId, name, sequence, parentUnitId, roles }) => {
      const { data, meta } = await deps.client.request({
        method: 'POST',
        path: `/spaces/${spaceId}/teams`,
        body: { name, sequence, parentUnitId, roles },
        feature: 'create_a_team',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'update_a_team',
    description: 'Update a team in a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      name: z.string().min(1).optional(),
      sequence: z.number().int().optional(),
      parentUnitId: unitIdSchema.optional(),
      roles: unitIdListSchema.optional(),
    }),
    execute: async ({ spaceId, unitId, name, sequence, parentUnitId, roles }) => {
      const { data, meta } = await deps.client.request({
        method: 'PUT',
        path: `/spaces/${spaceId}/teams/${unitId}`,
        body: { name, sequence, parentUnitId, roles },
        feature: 'update_a_team',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'delete_a_team',
    description: 'Delete a team from a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      confirm_destructive: z.boolean().optional(),
    }),
    execute: async ({ spaceId, unitId, confirm_destructive }) => {
      requireDestructiveConfirmation(confirm_destructive);
      const { data, meta } = await deps.client.request({
        method: 'DELETE',
        path: `/spaces/${spaceId}/teams/${unitId}`,
        feature: 'delete_a_team',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });
}

function registerRoleTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(server, deps, {
    name: 'list_units_under_the_role',
    description: 'List member and team units under a role by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      sensitiveData: z.boolean().optional(),
    }),
    readOnly: true,
    execute: async ({ spaceId, unitId, sensitiveData }) => {
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/spaces/${spaceId}/roles/${unitId}/units`,
        query: { sensitiveData },
        feature: 'list_units_under_the_role',
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'list_roles',
    description: 'List roles for a space.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      ...paginationShape,
    }),
    readOnly: true,
    execute: async ({ spaceId, pageSize, pageNum }) => {
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/spaces/${spaceId}/roles`,
        query: { pageSize, pageNum },
        feature: 'list_roles',
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'create_a_role',
    description: 'Create a role in a space.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      name: z.string().min(1),
      sequence: z.number().int().optional(),
    }),
    execute: async ({ spaceId, name, sequence }) => {
      const { data, meta } = await deps.client.request({
        method: 'POST',
        path: `/spaces/${spaceId}/roles`,
        body: { name, sequence },
        feature: 'create_a_role',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'update_a_role',
    description: 'Update a role in a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      name: z.string().min(1).optional(),
      sequence: z.number().int().optional(),
    }),
    execute: async ({ spaceId, unitId, name, sequence }) => {
      const { data, meta } = await deps.client.request({
        method: 'PUT',
        path: `/spaces/${spaceId}/roles/${unitId}`,
        body: { name, sequence },
        feature: 'update_a_role',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });

  registerTool(server, deps, {
    name: 'delete_a_role',
    description: 'Delete a role from a space by unitId.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      unitId: unitIdSchema,
      confirm_destructive: z.boolean().optional(),
    }),
    execute: async ({ spaceId, unitId, confirm_destructive }) => {
      requireDestructiveConfirmation(confirm_destructive);
      const { data, meta } = await deps.client.request({
        method: 'DELETE',
        path: `/spaces/${spaceId}/roles/${unitId}`,
        feature: 'delete_a_role',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });
}

export function registerOrgTools(server: McpServer, deps: ToolDependencies): void {
  registerMemberTools(server, deps);
  registerTeamTools(server, deps);
  registerRoleTools(server, deps);
}

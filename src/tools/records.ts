import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { datasheetIdSchema, jsonObjectSchema, paginationShape, recordIdSchema, viewIdSchema } from '../schemas/common.js';
import { registerTool, type ToolDependencies, ok, requireDestructiveConfirmation } from './common.js';

export function registerRecordTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(
    server,
    deps,
    {
      name: 'get_records',
      description: 'List datasheet records with filtering, pagination, sorting, and view support.',
      inputSchema: z.object({
        datasheetId: datasheetIdSchema,
        apiVersion: z.enum(['v1', 'v3']).optional().describe('Fusion API version. Defaults to v3.'),
        ...paginationShape,
        maxRecords: z.number().int().min(1).max(1000).optional(),
        sort: z
          .array(
            z.object({
              field: z.string().min(1),
              order: z.enum(['asc', 'desc']),
            }),
          )
          .min(1)
          .optional(),
        recordIds: z.array(recordIdSchema).min(1).max(1000).optional(),
        viewId: viewIdSchema.optional(),
        fields: z.array(z.string().min(1)).min(1).optional(),
        filterByFormula: z.string().optional(),
        cellFormat: z.enum(['json', 'string']).optional(),
        fieldKey: z.enum(['name', 'id']).optional(),
      }),
      readOnly: true,
      execute: async ({ datasheetId, apiVersion, recordIds, fields, ...query }) => {
        const version = apiVersion ?? 'v3';
        const { data, meta } = await deps.client.request({
          method: 'GET',
          version,
          path: `/datasheets/${datasheetId}/records`,
          query: {
            ...query,
            recordIds: recordIds?.join(','),
            fields: fields?.join(','),
          },
          feature: `get_records.${version}`,
        });
        return ok(data, meta);
      },
    },
  );

  registerTool(
    server,
    deps,
    {
      name: 'create_records',
      description: 'Create up to 10 records in a datasheet.',
      inputSchema: z.object({
        datasheetId: datasheetIdSchema,
        viewId: viewIdSchema.optional(),
        records: z.array(jsonObjectSchema).min(1).max(10),
        fieldKey: z.enum(['name', 'id']).optional(),
      }),
      execute: async ({ datasheetId, viewId, records, fieldKey }) => {
        const { data, meta } = await deps.client.request({
          method: 'POST',
          path: `/datasheets/${datasheetId}/records`,
          query: { viewId },
          body: {
            records,
            fieldKey,
          },
          feature: 'create_records',
          idempotent: false,
        });
        return ok(data, meta);
      },
    },
  );

  registerTool(
    server,
    deps,
    {
      name: 'update_records',
      description: 'Update up to 10 records in a datasheet.',
      inputSchema: z.object({
        datasheetId: datasheetIdSchema,
        viewId: viewIdSchema.optional(),
        records: z.array(jsonObjectSchema).min(1).max(10),
        fieldKey: z.enum(['name', 'id']).optional(),
      }),
      execute: async ({ datasheetId, viewId, records, fieldKey }) => {
        const { data, meta } = await deps.client.request({
          method: 'PATCH',
          path: `/datasheets/${datasheetId}/records`,
          query: { viewId },
          body: {
            records,
            fieldKey,
          },
          feature: 'update_records',
          idempotent: false,
        });
        return ok(data, meta);
      },
    },
  );

  registerTool(
    server,
    deps,
    {
      name: 'delete_records',
      description: 'Delete up to 10 records from a datasheet.',
      inputSchema: z.object({
        datasheetId: datasheetIdSchema,
        recordIds: z.array(z.string().min(1)).min(1).max(10),
        confirm_destructive: z.boolean().optional(),
      }),
      execute: async ({ datasheetId, recordIds, confirm_destructive }) => {
        requireDestructiveConfirmation(confirm_destructive);
        const { data, meta } = await deps.client.request({
          method: 'DELETE',
          path: `/datasheets/${datasheetId}/records`,
          query: {
            recordIds: recordIds.join(','),
          },
          feature: 'delete_records',
          idempotent: false,
        });
        return ok(data, meta);
      },
    },
  );
}

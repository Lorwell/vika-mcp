import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  datasheetIdSchema,
  fieldIdSchema,
  spaceIdSchema,
  viewIdSchema,
} from '../schemas/common.js';
import { registerTool, type ToolDependencies, ok, requireDestructiveConfirmation } from './common.js';

const baseFieldShape = {
  spaceId: spaceIdSchema,
  datasheetId: datasheetIdSchema,
  name: z.string().min(1).max(100).describe('Field name.'),
};

const precisionSchema = z.number().int().min(0).max(4);
const symbolAlignSchema = z.enum(['Default', 'Left', 'Right']);
const collectTypeSchema = z.union([z.literal(0), z.literal(1)]);

const selectOptionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  color: z.string().min(1).optional(),
});

const rollupFunctionSchema = z.enum([
  'VALUES',
  'AVERAGE',
  'COUNT',
  'COUNTA',
  'COUNTALL',
  'SUM',
  'MIN',
  'MAX',
  'AND',
  'OR',
  'XOR',
  'CONCATENATE',
  'ARRAYJOIN',
  'ARRAYUNIQUE',
  'ARRAYCOMPACT',
]);

const computedFormatSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DateTime'),
    format: z.object({
      dateFormat: z.string().min(1),
      timeFormat: z.string().min(1).optional(),
      includeTime: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('Number'),
    format: z.object({ precision: precisionSchema }),
  }),
  z.object({
    type: z.literal('Percent'),
    format: z.object({ precision: precisionSchema }),
  }),
  z.object({
    type: z.literal('Currency'),
    format: z.object({
      precision: precisionSchema,
      symbol: z.string().optional(),
      symbolAlign: symbolAlignSchema.optional(),
    }),
  }),
]);

const buttonStyleSchema = z.object({
  type: z.enum(['Background', 'OnlyText']),
  color: z.object({
    name: z.string().min(1),
    value: z.string().min(1),
  }),
});

const buttonActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('OpenLink'),
    openLink: z.object({
      type: z.enum(['Url', 'Expression']),
      expression: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('TriggerAutomation'),
    automation: z.object({
      automationId: z.string().min(1),
      triggerId: z.string().min(1),
    }),
  }),
]);

type FieldToolArgs = {
  spaceId: string;
  datasheetId: string;
  name: string;
  [key: string]: unknown;
};

interface FieldToolDefinition {
  name: string;
  type: string;
  inputSchema: z.ZodTypeAny;
  buildProperty: (args: FieldToolArgs) => unknown;
}

function properties(args: FieldToolArgs, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
}

function registerCreateFieldTool(
  server: McpServer,
  deps: ToolDependencies,
  definition: FieldToolDefinition,
): void {
  registerTool(server, deps, {
    name: definition.name,
    description: `Create a ${definition.type} field in a datasheet.`,
    inputSchema: definition.inputSchema,
    execute: async (rawArgs) => {
      const args = rawArgs as FieldToolArgs;
      const { data, meta } = await deps.client.request({
        method: 'POST',
        path: `/spaces/${args.spaceId}/datasheets/${args.datasheetId}/fields`,
        body: {
          type: definition.type,
          name: args.name,
          property: definition.buildProperty(args),
        },
        feature: definition.name,
        idempotent: false,
      });
      return ok(data, meta);
    },
  });
}

const fieldToolDefinitions: FieldToolDefinition[] = [
  {
    name: 'create_single_text_field',
    type: 'SingleText',
    inputSchema: z.object({ ...baseFieldShape, defaultValue: z.string().optional() }),
    buildProperty: (args) => properties(args, ['defaultValue']),
  },
  {
    name: 'create_text_field',
    type: 'Text',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_url_field',
    type: 'URL',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_phone_field',
    type: 'Phone',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_email_field',
    type: 'Email',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_work_doc_field',
    type: 'WorkDoc',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_number_field',
    type: 'Number',
    inputSchema: z.object({
      ...baseFieldShape,
      precision: precisionSchema,
      defaultValue: z.string().optional(),
      symbol: z.string().optional(),
    }),
    buildProperty: (args) => properties(args, ['defaultValue', 'precision', 'symbol']),
  },
  {
    name: 'create_currency_field',
    type: 'Currency',
    inputSchema: z.object({
      ...baseFieldShape,
      precision: precisionSchema,
      symbol: z.string().min(1),
      defaultValue: z.string().optional(),
      symbolAlign: symbolAlignSchema.optional(),
    }),
    buildProperty: (args) => properties(args, ['defaultValue', 'precision', 'symbol', 'symbolAlign']),
  },
  {
    name: 'create_percent_field',
    type: 'Percent',
    inputSchema: z.object({
      ...baseFieldShape,
      precision: precisionSchema,
      defaultValue: z.string().optional(),
    }),
    buildProperty: (args) => properties(args, ['defaultValue', 'precision']),
  },
  {
    name: 'create_single_select_field',
    type: 'SingleSelect',
    inputSchema: z.object({
      ...baseFieldShape,
      options: z.array(selectOptionSchema).min(1),
      defaultValue: z.string().optional(),
    }),
    buildProperty: (args) => properties(args, ['defaultValue', 'options']),
  },
  {
    name: 'create_multi_select_field',
    type: 'MultiSelect',
    inputSchema: z.object({
      ...baseFieldShape,
      options: z.array(selectOptionSchema).min(1),
      defaultValue: z.array(z.string().min(1)).optional(),
    }),
    buildProperty: (args) => properties(args, ['defaultValue', 'options']),
  },
  {
    name: 'create_checkbox_field',
    type: 'Checkbox',
    inputSchema: z.object({ ...baseFieldShape, icon: z.string().min(1) }),
    buildProperty: (args) => properties(args, ['icon']),
  },
  {
    name: 'create_rating_field',
    type: 'Rating',
    inputSchema: z.object({
      ...baseFieldShape,
      icon: z.string().min(1),
      max: z.number().int().min(1).max(10),
    }),
    buildProperty: (args) => properties(args, ['icon', 'max']),
  },
  {
    name: 'create_date_time_field',
    type: 'DateTime',
    inputSchema: z.object({
      ...baseFieldShape,
      dateFormat: z.string().min(1),
      timeFormat: z.string().optional(),
      autoFill: z.boolean().optional(),
      includeTime: z.boolean().optional(),
    }),
    buildProperty: (args) => properties(args, ['dateFormat', 'timeFormat', 'autoFill', 'includeTime']),
  },
  {
    name: 'create_member_field',
    type: 'Member',
    inputSchema: z.object({
      ...baseFieldShape,
      isMulti: z.boolean().optional(),
      shouldSendMsg: z.boolean().optional(),
    }),
    buildProperty: (args) => properties(args, ['isMulti', 'shouldSendMsg']),
  },
  {
    name: 'create_created_time_field',
    type: 'CreatedTime',
    inputSchema: z.object({
      ...baseFieldShape,
      dateFormat: z.string().min(1),
      timeFormat: z.string().optional(),
      includeTime: z.boolean().optional(),
    }),
    buildProperty: (args) => properties(args, ['dateFormat', 'timeFormat', 'includeTime']),
  },
  {
    name: 'create_last_modified_time_field',
    type: 'LastModifiedTime',
    inputSchema: z.object({
      ...baseFieldShape,
      dateFormat: z.string().min(1),
      timeFormat: z.string().optional(),
      includeTime: z.boolean().optional(),
      collectType: collectTypeSchema.optional(),
      fieldIdCollection: z.array(fieldIdSchema).min(1).optional(),
    }),
    buildProperty: (args) =>
      properties(args, ['dateFormat', 'timeFormat', 'includeTime', 'collectType', 'fieldIdCollection']),
  },
  {
    name: 'create_created_by_field',
    type: 'CreatedBy',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_last_modified_by_field',
    type: 'LastModifiedBy',
    inputSchema: z.object({
      ...baseFieldShape,
      collectType: collectTypeSchema.optional(),
      fieldIdCollection: z.array(fieldIdSchema).min(1).optional(),
    }),
    buildProperty: (args) => properties(args, ['collectType', 'fieldIdCollection']),
  },
  {
    name: 'create_one_way_link_field',
    type: 'OneWayLink',
    inputSchema: z.object({
      ...baseFieldShape,
      foreignDatasheetId: datasheetIdSchema,
      limitToViewId: viewIdSchema.optional(),
      limitSingleRecord: z.boolean().optional(),
    }),
    buildProperty: (args) => properties(args, ['foreignDatasheetId', 'limitToViewId', 'limitSingleRecord']),
  },
  {
    name: 'create_two_way_link_field',
    type: 'TwoWayLink',
    inputSchema: z.object({
      ...baseFieldShape,
      foreignDatasheetId: datasheetIdSchema,
      limitToViewId: viewIdSchema.optional(),
      limitSingleRecord: z.boolean().optional(),
    }),
    buildProperty: (args) => properties(args, ['foreignDatasheetId', 'limitToViewId', 'limitSingleRecord']),
  },
  {
    name: 'create_magic_lookup_field',
    type: 'MagicLookUp',
    inputSchema: z.object({
      ...baseFieldShape,
      relatedLinkFieldId: fieldIdSchema,
      targetFieldId: fieldIdSchema,
      rollupFunction: rollupFunctionSchema.optional(),
      format: computedFormatSchema.optional(),
    }),
    buildProperty: (args) => properties(args, ['relatedLinkFieldId', 'targetFieldId', 'rollupFunction', 'format']),
  },
  {
    name: 'create_formula_field',
    type: 'Formula',
    inputSchema: z.object({
      ...baseFieldShape,
      expression: z.string().min(1).optional(),
      format: computedFormatSchema.optional(),
    }),
    buildProperty: (args) => properties(args, ['expression', 'format']),
  },
  {
    name: 'create_auto_number_field',
    type: 'AutoNumber',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
  {
    name: 'create_button_field',
    type: 'Button',
    inputSchema: z.object({
      ...baseFieldShape,
      text: z.string().min(1).optional(),
      style: buttonStyleSchema.optional(),
      action: buttonActionSchema.optional(),
    }),
    buildProperty: (args) => properties(args, ['text', 'style', 'action']),
  },
  {
    name: 'create_attachment_field',
    type: 'Attachment',
    inputSchema: z.object(baseFieldShape),
    buildProperty: () => null,
  },
];

export const FIELD_CREATE_TOOL_NAMES = fieldToolDefinitions.map((definition) => definition.name);

export function registerFieldTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(server, deps, {
    name: 'get_fields',
    description: 'List fields for a datasheet.',
    inputSchema: z.object({
      datasheetId: datasheetIdSchema,
      viewId: viewIdSchema.optional(),
    }),
    readOnly: true,
    execute: async ({ datasheetId, viewId }) => {
      const { data, meta } = await deps.client.request({
        method: 'GET',
        path: `/datasheets/${datasheetId}/fields`,
        query: { viewId },
        feature: 'get_fields',
      });
      return ok(data, meta);
    },
  });

  for (const definition of fieldToolDefinitions) {
    registerCreateFieldTool(server, deps, definition);
  }

  registerTool(server, deps, {
    name: 'delete_fields',
    description: 'Delete a field from a datasheet.',
    inputSchema: z.object({
      spaceId: spaceIdSchema,
      datasheetId: datasheetIdSchema,
      fieldId: fieldIdSchema,
      confirm_destructive: z.boolean().optional(),
    }),
    execute: async ({ spaceId, datasheetId, fieldId, confirm_destructive }) => {
      requireDestructiveConfirmation(confirm_destructive);
      const { data, meta } = await deps.client.request({
        method: 'DELETE',
        path: `/spaces/${spaceId}/datasheets/${datasheetId}/fields/${fieldId}`,
        feature: 'delete_fields',
        idempotent: false,
      });
      return ok(data, meta);
    },
  });
}

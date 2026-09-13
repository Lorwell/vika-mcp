import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';

import type { VikaClient, RequestOptions } from '../../src/http/client.js';
import type { Logger } from '../../src/logger.js';
import type { ResolverService } from '../../src/resolvers.js';
import type { ToolDependencies } from '../../src/tools/common.js';
import { FIELD_CREATE_TOOL_NAMES } from '../../src/tools/fields.js';
import { PUBLIC_TOOL_NAMES, registerAllTools } from '../../src/tools/index.js';

interface RegisteredTool {
  config: {
    inputSchema: z.ZodTypeAny;
    annotations: { readOnlyHint: boolean; openWorldHint: boolean };
  };
  callback: (args: unknown) => Promise<CallToolResult>;
}

function createHarness() {
  const tools = new Map<string, RegisteredTool>();
  const requests: RequestOptions[] = [];
  const createRemoteFileFormData = vi.fn(async () => new FormData());
  const client = {
    request: vi.fn(async (options: RequestOptions) => {
      requests.push(options);
      return {
        data: { accepted: true },
        meta: {
          http_status: 200,
          version: options.version ?? 'v1',
          path: options.path,
          attempts: 1,
        },
      };
    }),
    createSingleFileFormData: vi.fn(async () => new FormData()),
    createRemoteFileFormData,
  } as unknown as VikaClient;
  const server = {
    registerTool: (name: string, config: RegisteredTool['config'], callback: RegisteredTool['callback']) => {
      tools.set(name, { config, callback });
    },
  } as unknown as McpServer;
  const logger = { error: vi.fn() } as unknown as Logger;
  const deps: ToolDependencies = {
    client,
    logger,
    resolvers: {} as ResolverService,
  };

  registerAllTools(server, deps);

  async function invoke(name: string, args: Record<string, unknown>, validate = true): Promise<CallToolResult> {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Tool not registered: ${name}`);
    }
    const parsed = validate ? tool.config.inputSchema.parse(args) : args;
    return tool.callback(parsed);
  }

  return { tools, requests, invoke, createRemoteFileFormData };
}

const removedTools = [
  'create_node',
  'update_node',
  'delete_node',
  'copy_node',
  'move_node',
  'recover_node',
  'get_node_showcase',
  'import_from_excel',
  'get_form_fields',
  'submit_form',
  'create_form_share_link',
  'get_form_association',
  'update_form_share',
  'create_view',
  'delete_view',
  'delete_views',
  'update_view',
  'copy_view',
  'create_chat_completions',
  'create_fields',
];

const fieldCases: Record<string, { type: string; args?: Record<string, unknown>; property: unknown }> = {
  create_single_text_field: { type: 'SingleText', args: { defaultValue: 'hello' }, property: { defaultValue: 'hello' } },
  create_text_field: { type: 'Text', property: null },
  create_url_field: { type: 'URL', property: null },
  create_phone_field: { type: 'Phone', property: null },
  create_email_field: { type: 'Email', property: null },
  create_work_doc_field: { type: 'WorkDoc', property: null },
  create_number_field: { type: 'Number', args: { precision: 4, symbol: '#' }, property: { precision: 4, symbol: '#' } },
  create_currency_field: {
    type: 'Currency',
    args: { precision: 2, symbol: '¥', symbolAlign: 'Left' },
    property: { precision: 2, symbol: '¥', symbolAlign: 'Left' },
  },
  create_percent_field: { type: 'Percent', args: { precision: 0 }, property: { precision: 0 } },
  create_single_select_field: {
    type: 'SingleSelect',
    args: { options: [{ name: 'Open', color: 'blue' }], defaultValue: 'Open' },
    property: { options: [{ name: 'Open', color: 'blue' }], defaultValue: 'Open' },
  },
  create_multi_select_field: {
    type: 'MultiSelect',
    args: { options: [{ id: 'opt1', name: 'Red' }], defaultValue: ['opt1'] },
    property: { options: [{ id: 'opt1', name: 'Red' }], defaultValue: ['opt1'] },
  },
  create_checkbox_field: { type: 'Checkbox', args: { icon: 'check' }, property: { icon: 'check' } },
  create_rating_field: { type: 'Rating', args: { icon: 'star', max: 10 }, property: { icon: 'star', max: 10 } },
  create_date_time_field: {
    type: 'DateTime',
    args: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', autoFill: false, includeTime: true },
    property: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', autoFill: false, includeTime: true },
  },
  create_member_field: {
    type: 'Member',
    args: { isMulti: true, shouldSendMsg: false },
    property: { isMulti: true, shouldSendMsg: false },
  },
  create_created_time_field: {
    type: 'CreatedTime',
    args: { dateFormat: 'YYYY-MM-DD', includeTime: false },
    property: { dateFormat: 'YYYY-MM-DD', includeTime: false },
  },
  create_last_modified_time_field: {
    type: 'LastModifiedTime',
    args: { dateFormat: 'YYYY-MM-DD', collectType: 1, fieldIdCollection: ['fld1'] },
    property: { dateFormat: 'YYYY-MM-DD', collectType: 1, fieldIdCollection: ['fld1'] },
  },
  create_created_by_field: { type: 'CreatedBy', property: null },
  create_last_modified_by_field: {
    type: 'LastModifiedBy',
    args: { collectType: 0, fieldIdCollection: ['fld1'] },
    property: { collectType: 0, fieldIdCollection: ['fld1'] },
  },
  create_one_way_link_field: {
    type: 'OneWayLink',
    args: { foreignDatasheetId: 'dst2', limitToViewId: 'viw2', limitSingleRecord: true },
    property: { foreignDatasheetId: 'dst2', limitToViewId: 'viw2', limitSingleRecord: true },
  },
  create_two_way_link_field: {
    type: 'TwoWayLink',
    args: { foreignDatasheetId: 'dst2', limitSingleRecord: false },
    property: { foreignDatasheetId: 'dst2', limitSingleRecord: false },
  },
  create_magic_lookup_field: {
    type: 'MagicLookUp',
    args: {
      relatedLinkFieldId: 'fld1',
      targetFieldId: 'fld2',
      rollupFunction: 'SUM',
      format: { type: 'Currency', format: { precision: 2, symbol: '¥', symbolAlign: 'Right' } },
    },
    property: {
      relatedLinkFieldId: 'fld1',
      targetFieldId: 'fld2',
      rollupFunction: 'SUM',
      format: { type: 'Currency', format: { precision: 2, symbol: '¥', symbolAlign: 'Right' } },
    },
  },
  create_formula_field: {
    type: 'Formula',
    args: {
      expression: '{fld1} * 2',
      format: { type: 'Number', format: { precision: 3 } },
    },
    property: {
      expression: '{fld1} * 2',
      format: { type: 'Number', format: { precision: 3 } },
    },
  },
  create_auto_number_field: { type: 'AutoNumber', property: null },
  create_button_field: {
    type: 'Button',
    args: {
      text: 'Open',
      style: { type: 'Background', color: { name: 'Blue', value: '#1677ff' } },
      action: { type: 'OpenLink', openLink: { type: 'Url', expression: 'https://vika.cn' } },
    },
    property: {
      text: 'Open',
      style: { type: 'Background', color: { name: 'Blue', value: '#1677ff' } },
      action: { type: 'OpenLink', openLink: { type: 'Url', expression: 'https://vika.cn' } },
    },
  },
  create_attachment_field: { type: 'Attachment', property: null },
};

describe('public tool registry', () => {
  it('registers exactly the documented 55-tool surface', () => {
    const { tools } = createHarness();

    expect(PUBLIC_TOOL_NAMES).toHaveLength(55);
    expect(new Set(PUBLIC_TOOL_NAMES).size).toBe(55);
    expect([...tools.keys()]).toEqual(PUBLIC_TOOL_NAMES);
    expect(removedTools.every((name) => !tools.has(name))).toBe(true);
  });

  it('marks only read operations as read-only', () => {
    const { tools } = createHarness();
    const readOnlyNames = [...tools.entries()]
      .filter(([, tool]) => tool.config.annotations.readOnlyHint)
      .map(([name]) => name);

    expect(readOnlyNames).toEqual([
      'get_spaces',
      'get_nodes',
      'search_nodes',
      'get_node_details',
      'get_embedlinks',
      'get_records',
      'get_fields',
      'get_views',
      'get_a_member',
      'list_the_team_members',
      'list_teams',
      'list_units_under_the_role',
      'list_roles',
    ]);
  });
});

describe('official request mappings', () => {
  it('maps every non-field tool to its public Fusion resource path', async () => {
    const { invoke, requests } = createHarness();
    const cases: Array<[string, Record<string, unknown>, string, string, string | undefined]> = [
      ['get_spaces', {}, 'GET', '/spaces', undefined],
      ['get_nodes', { spaceId: 'spc1' }, 'GET', '/spaces/spc1/nodes', undefined],
      ['search_nodes', { spaceId: 'spc1', type: 'Datasheet' }, 'GET', '/spaces/spc1/nodes', 'v2'],
      ['get_node_details', { spaceId: 'spc1', nodeId: 'dst1' }, 'GET', '/spaces/spc1/nodes/dst1', undefined],
      ['create_datasheets', { spaceId: 'spc1', name: 'Table' }, 'POST', '/spaces/spc1/datasheets', undefined],
      ['upload_attachments', { datasheetId: 'dst1', filePath: 'C:/tmp/a.txt' }, 'POST', '/datasheets/dst1/attachments', undefined],
      ['get_embedlinks', { spaceId: 'spc1', nodeId: 'dst1' }, 'GET', '/spaces/spc1/nodes/dst1/embedlinks', undefined],
      ['create_embedlinks', { spaceId: 'spc1', nodeId: 'dst1', theme: 'dark' }, 'POST', '/spaces/spc1/nodes/dst1/embedlinks', undefined],
      ['delete_embedlinks', { spaceId: 'spc1', nodeId: 'dst1', linkId: 'emb1', confirm_destructive: true }, 'DELETE', '/spaces/spc1/nodes/dst1/embedlinks/emb1', undefined],
      ['get_records', { datasheetId: 'dst1' }, 'GET', '/datasheets/dst1/records', 'v3'],
      ['create_records', { datasheetId: 'dst1', records: [{ fields: {} }] }, 'POST', '/datasheets/dst1/records', undefined],
      ['update_records', { datasheetId: 'dst1', records: [{ recordId: 'rec1', fields: {} }] }, 'PATCH', '/datasheets/dst1/records', undefined],
      ['delete_records', { datasheetId: 'dst1', recordIds: ['rec1'], confirm_destructive: true }, 'DELETE', '/datasheets/dst1/records', undefined],
      ['get_fields', { datasheetId: 'dst1' }, 'GET', '/datasheets/dst1/fields', undefined],
      ['delete_fields', { spaceId: 'spc1', datasheetId: 'dst1', fieldId: 'fld1', confirm_destructive: true }, 'DELETE', '/spaces/spc1/datasheets/dst1/fields/fld1', undefined],
      ['get_views', { datasheetId: 'dst1' }, 'GET', '/datasheets/dst1/views', undefined],
      ['get_a_member', { spaceId: 'spc1', unitId: 'unit1' }, 'GET', '/spaces/spc1/members/unit1', undefined],
      ['update_a_member', { spaceId: 'spc1', unitId: 'unit1', name: 'Member' }, 'PUT', '/spaces/spc1/members/unit1', undefined],
      ['delete_a_member', { spaceId: 'spc1', unitId: 'unit1', confirm_destructive: true }, 'DELETE', '/spaces/spc1/members/unit1', undefined],
      ['list_the_team_members', { spaceId: 'spc1', unitId: 'unit1' }, 'GET', '/spaces/spc1/teams/unit1/members', undefined],
      ['list_teams', { spaceId: 'spc1' }, 'GET', '/spaces/spc1/teams/0/children', undefined],
      ['create_a_team', { spaceId: 'spc1', name: 'Team' }, 'POST', '/spaces/spc1/teams', undefined],
      ['update_a_team', { spaceId: 'spc1', unitId: 'unit1', name: 'Team' }, 'PUT', '/spaces/spc1/teams/unit1', undefined],
      ['delete_a_team', { spaceId: 'spc1', unitId: 'unit1', confirm_destructive: true }, 'DELETE', '/spaces/spc1/teams/unit1', undefined],
      ['list_units_under_the_role', { spaceId: 'spc1', unitId: 'unit1' }, 'GET', '/spaces/spc1/roles/unit1/units', undefined],
      ['list_roles', { spaceId: 'spc1' }, 'GET', '/spaces/spc1/roles', undefined],
      ['create_a_role', { spaceId: 'spc1', name: 'Role' }, 'POST', '/spaces/spc1/roles', undefined],
      ['update_a_role', { spaceId: 'spc1', unitId: 'unit1', name: 'Role' }, 'PUT', '/spaces/spc1/roles/unit1', undefined],
      ['delete_a_role', { spaceId: 'spc1', unitId: 'unit1', confirm_destructive: true }, 'DELETE', '/spaces/spc1/roles/unit1', undefined],
    ];

    for (const [name, args, method, path, version] of cases) {
      await invoke(name, args);
      expect(requests.at(-1)).toMatchObject({ method, path, ...(version ? { version } : {}) });
    }

    expect(requests).toHaveLength(cases.length);
  });

  it('maps all 26 specialized field tools to fixed official field types', async () => {
    const { invoke, requests } = createHarness();

    expect(FIELD_CREATE_TOOL_NAMES).toEqual(Object.keys(fieldCases));
    for (const [name, fieldCase] of Object.entries(fieldCases)) {
      await invoke(name, {
        spaceId: 'spc1',
        datasheetId: 'dst1',
        name: 'Field',
        ...fieldCase.args,
      });
      expect(requests.at(-1)).toEqual(expect.objectContaining({
        method: 'POST',
        path: '/spaces/spc1/datasheets/dst1/fields',
        body: { type: fieldCase.type, name: 'Field', property: fieldCase.property },
      }));
    }
  });

  it('builds corrected record and organization parameters', async () => {
    const { invoke, requests } = createHarness();

    await invoke('get_records', {
      datasheetId: 'dst1',
      apiVersion: 'v1',
      fieldKey: 'id',
      fields: ['fld1', 'fld2'],
      recordIds: ['rec1', 'rec2'],
      sort: [{ field: 'fld1', order: 'desc' }],
    });
    expect(requests.at(-1)).toMatchObject({
      version: 'v1',
      feature: 'get_records.v1',
      query: {
        fieldKey: 'id',
        fields: 'fld1,fld2',
        recordIds: 'rec1,rec2',
        sort: [{ field: 'fld1', order: 'desc' }],
      },
    });

    await invoke('create_records', {
      datasheetId: 'dst1',
      viewId: 'viw1',
      fieldKey: 'id',
      records: [{ fields: { fld1: 'value' } }],
    });
    expect(requests.at(-1)).toMatchObject({
      query: { viewId: 'viw1' },
      body: { fieldKey: 'id', records: [{ fields: { fld1: 'value' } }] },
    });

    await invoke('update_a_member', {
      spaceId: 'spc1',
      unitId: 'unit1',
      sensitiveData: true,
      name: 'New name',
      teams: ['team1'],
      roles: ['role1'],
    });
    expect(requests.at(-1)).toMatchObject({
      query: { sensitiveData: true },
      body: { name: 'New name', teams: ['team1'], roles: ['role1'] },
    });

    await invoke('list_units_under_the_role', { spaceId: 'spc1', unitId: 'role1', sensitiveData: true });
    expect(requests.at(-1)).toMatchObject({ query: { sensitiveData: true } });
  });

  it('downloads URL attachments through the guarded remote-file path', async () => {
    const { invoke, requests, createRemoteFileFormData } = createHarness();

    await invoke('upload_attachments', {
      datasheetId: 'dst1',
      url: 'https://files.example.test/report.pdf',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      maxBytes: 1024,
      downloadTimeoutMs: 5000,
    });

    expect(createRemoteFileFormData).toHaveBeenCalledWith({
      url: 'https://files.example.test/report.pdf',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/datasheets/dst1/attachments',
      formData: expect.any(FormData),
    });
  });
});

describe('tool schemas and destructive guards', () => {
  it('enforces representative field and search constraints', () => {
    const { tools } = createHarness();
    const schema = (name: string) => tools.get(name)!.config.inputSchema;

    expect(schema('search_nodes').safeParse({ spaceId: 'spc1' }).success).toBe(false);
    expect(schema('search_nodes').safeParse({ spaceId: 'spc1', type: 'Datasheet', permissions: [4] }).success).toBe(false);
    expect(schema('get_records').safeParse({ datasheetId: 'dst1', sort: { field: 'x', order: 'asc' } }).success).toBe(false);
    expect(schema('get_records').safeParse({ datasheetId: 'dst1', apiVersion: 'v2' }).success).toBe(false);
    expect(schema('create_records').safeParse({ datasheetId: 'dst1', records: [] }).success).toBe(false);
    expect(schema('update_records').safeParse({ datasheetId: 'dst1', records: Array.from({ length: 11 }, () => ({})) }).success).toBe(false);
    expect(schema('create_number_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'N', precision: 5 }).success).toBe(false);
    expect(schema('create_rating_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'R', icon: '⭐', max: 11 }).success).toBe(false);
    expect(schema('create_currency_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'C', precision: 2 }).success).toBe(false);
    expect(schema('create_single_select_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'S', options: [] }).success).toBe(false);
    expect(schema('create_date_time_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'D' }).success).toBe(false);
    expect(schema('create_one_way_link_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'L' }).success).toBe(false);
    expect(schema('create_magic_lookup_field').safeParse({ spaceId: 'spc1', datasheetId: 'dst1', name: 'M', relatedLinkFieldId: 'fld1' }).success).toBe(false);
    expect(schema('upload_attachments').safeParse({ datasheetId: 'dst1' }).success).toBe(false);
    expect(schema('upload_attachments').safeParse({ datasheetId: 'dst1', filePath: 'a', url: 'https://example.com/a' }).success).toBe(false);
    expect(schema('upload_attachments').safeParse({ datasheetId: 'dst1', url: 'https://example.com/a' }).success).toBe(true);
    expect(schema('create_button_field').safeParse({
      spaceId: 'spc1',
      datasheetId: 'dst1',
      name: 'Button',
      action: { type: 'OpenLink', openLink: { type: 'Url', expression: 'https://vika.cn' } },
    }).success).toBe(true);

    const datasheetJsonSchema = z.toJSONSchema(schema('create_datasheets')) as { properties?: Record<string, unknown> };
    expect(datasheetJsonSchema.properties).not.toHaveProperty('fields');
    const memberJsonSchema = z.toJSONSchema(schema('get_a_member')) as { properties?: Record<string, unknown> };
    expect(memberJsonSchema.properties).toHaveProperty('unitId');
    expect(memberJsonSchema.properties).not.toHaveProperty('memberId');
  });

  it('guards every public destructive operation', async () => {
    const { invoke, requests } = createHarness();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['delete_records', { datasheetId: 'dst1', recordIds: ['rec1'] }],
      ['delete_fields', { spaceId: 'spc1', datasheetId: 'dst1', fieldId: 'fld1' }],
      ['delete_embedlinks', { spaceId: 'spc1', nodeId: 'dst1', linkId: 'emb1' }],
      ['delete_a_member', { spaceId: 'spc1', unitId: 'unit1' }],
      ['delete_a_team', { spaceId: 'spc1', unitId: 'unit1' }],
      ['delete_a_role', { spaceId: 'spc1', unitId: 'unit1' }],
    ];

    for (const [name, args] of cases) {
      const result = await invoke(name, args);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: 'destructive_guard' },
      });
    }

    expect(requests).toHaveLength(0);
  });
});

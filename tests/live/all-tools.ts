import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

import { CapabilityRegistry } from '../../src/capabilities.js';
import { loadConfig } from '../../src/config.js';
import { VikaClient } from '../../src/http/client.js';
import type { Logger } from '../../src/logger.js';
import { ResolverService } from '../../src/resolvers.js';
import type { ToolDependencies } from '../../src/tools/common.js';
import { FIELD_CREATE_TOOL_NAMES } from '../../src/tools/fields.js';
import { PUBLIC_TOOL_NAMES, registerAllTools } from '../../src/tools/index.js';
import type { ToolEnvelope } from '../../src/types.js';

interface RegisteredTool {
  config: { inputSchema: z.ZodTypeAny };
  callback: (args: unknown) => Promise<CallToolResult>;
}

interface CaseResult {
  tool: string;
  caseName: string;
  outcome: 'success' | 'upstream_error' | 'local_error';
  httpCalls: number;
  category?: string;
  httpStatus?: number;
  message?: string;
}

interface CreatedField {
  id: string;
  tool: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getFirstString(value: unknown, preferredKeys: string[]): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getFirstString(item, preferredKeys);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of preferredKeys) {
      if (typeof object[key] === 'string') return object[key];
    }
    for (const nested of Object.values(object)) {
      const found = getFirstString(nested, preferredKeys);
      if (found) return found;
    }
  }
  return undefined;
}

function getArray(value: unknown, preferredKeys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  for (const nested of Object.values(object)) {
    const found = getArray(nested, preferredKeys);
    if (found.length > 0) return found;
  }
  return [];
}

function envelopeOf(result: CallToolResult): ToolEnvelope {
  return result.structuredContent as unknown as ToolEnvelope;
}

async function main(): Promise<void> {
  if (process.env.VIKA_LIVE_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('Set VIKA_LIVE_ALLOW_DESTRUCTIVE=true to run the destructive all-tools live matrix.');
  }

  const config = loadConfig();
  const spaceId = requireEnv('VIKA_TEST_SPACE_ID');
  const nodeId = requireEnv('VIKA_TEST_NODE_ID');
  const datasheetId = requireEnv('VIKA_TEST_DATASHEET_ID');
  const attachmentUrl = process.env.VIKA_TEST_ATTACHMENT_URL;
  const requestIntervalMs = Number(process.env.VIKA_LIVE_INTERVAL_MS ?? '1100');
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 500) {
    throw new Error('VIKA_LIVE_INTERVAL_MS must be a number greater than or equal to 500.');
  }
  const prefix = `mcp_all_tools_${Date.now()}`;
  const results: CaseResult[] = [];
  const caseCounts = new Map<string, number>();
  const httpCounts = new Map<string, number>();
  const createdFields: CreatedField[] = [];
  const createdRecordIds: string[] = [];
  const createdEmbedLinkIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdRoleIds: string[] = [];
  const retainedDatasheets: Array<{ id?: string; name: string }> = [];
  let activeTool: string | undefined;
  let lastRequestStartedAt = 0;

  const quietLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() { return this; },
  } as unknown as Logger;

  const trackedFetch: typeof fetch = async (input, init) => {
    const remainingMs = requestIntervalMs - (Date.now() - lastRequestStartedAt);
    if (remainingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
    }
    lastRequestStartedAt = Date.now();
    if (activeTool) {
      httpCounts.set(activeTool, (httpCounts.get(activeTool) ?? 0) + 1);
    }
    return fetch(input, init);
  };

  function createHarness(): Map<string, RegisteredTool> {
    const tools = new Map<string, RegisteredTool>();
    const client = new VikaClient(config, quietLogger, new CapabilityRegistry(), trackedFetch);
    const server = {
      registerTool: (name: string, toolConfig: RegisteredTool['config'], callback: RegisteredTool['callback']) => {
        tools.set(name, { config: toolConfig, callback });
      },
    } as unknown as McpServer;
    const deps: ToolDependencies = {
      client,
      logger: quietLogger,
      resolvers: new ResolverService(client),
    };
    registerAllTools(server, deps);
    return tools;
  }

  async function invoke(
    toolName: string,
    caseName: string,
    args: Record<string, unknown>,
    countAsCase = true,
  ): Promise<ToolEnvelope | undefined> {
    const tools = createHarness();
    const tool = tools.get(toolName);
    if (!tool) throw new Error(`Tool is not registered: ${toolName}`);
    if (countAsCase) caseCounts.set(toolName, (caseCounts.get(toolName) ?? 0) + 1);
    const before = httpCounts.get(toolName) ?? 0;

    try {
      const parsed = tool.config.inputSchema.parse(args);
      activeTool = toolName;
      const result = await tool.callback(parsed);
      const envelope = envelopeOf(result);
      const after = httpCounts.get(toolName) ?? 0;
      if (countAsCase) {
        results.push(
          envelope.ok
            ? { tool: toolName, caseName, outcome: 'success', httpCalls: after - before }
            : {
                tool: toolName,
                caseName,
                outcome: 'upstream_error',
                httpCalls: after - before,
                category: envelope.error.category,
                httpStatus: envelope.error.http_status,
                message: envelope.error.message.slice(0, 180),
              },
        );
      }
      return envelope;
    } catch (error) {
      const after = httpCounts.get(toolName) ?? 0;
      if (countAsCase) {
        results.push({
          tool: toolName,
          caseName,
          outcome: 'local_error',
          httpCalls: after - before,
          message: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
        });
      }
      return undefined;
    } finally {
      activeTool = undefined;
    }
  }

  function dataOf(envelope: ToolEnvelope | undefined): unknown {
    return envelope?.ok ? envelope.data : undefined;
  }

  async function createField(tool: string, index: number, extra: Record<string, unknown>): Promise<string | undefined> {
    const result = await invoke(tool, `create-${index}`, {
      spaceId,
      datasheetId,
      name: `${prefix}_${tool.replace('create_', '').replace('_field', '')}_${index}`.slice(0, 100),
      ...extra,
    });
    const id = getFirstString(dataOf(result), ['fieldId', 'id']);
    if (id) createdFields.push({ id, tool });
    return id;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'vika-mcp-all-tools-'));
  const tempFiles = [path.join(tempDir, 'one.txt'), path.join(tempDir, 'two.txt')];
  await writeFile(tempFiles[0]!, `${prefix} one\n`, 'utf8');
  await writeFile(tempFiles[1]!, `${prefix} two\n`, 'utf8');

  try {
    await invoke('get_spaces', 'list-1', {});
    await invoke('get_spaces', 'list-2', {});
    await invoke('get_nodes', 'roots-1', { spaceId });
    await invoke('get_nodes', 'roots-2', { spaceId });
    await invoke('search_nodes', 'datasheets-1', { spaceId, type: 'Datasheet' });
    await invoke('search_nodes', 'datasheets-2', { spaceId, type: 'Datasheet', permissions: [0, 1, 2, 3] });
    await invoke('get_node_details', 'details-1', { spaceId, nodeId });
    await invoke('get_node_details', 'details-2', { spaceId, nodeId });

    for (let index = 1; index <= 2; index += 1) {
      const name = `${prefix}_datasheet_${index}`;
      const result = await invoke('create_datasheets', `create-${index}`, {
        spaceId,
        name,
        description: `Retained live-test datasheet ${index}`,
      });
      retainedDatasheets.push({ id: getFirstString(dataOf(result), ['datasheetId', 'nodeId', 'id']), name });
    }

    const views1 = await invoke('get_views', 'list-1', { datasheetId });
    const viewId = getFirstString(dataOf(views1), ['viewId', 'id']);
    await invoke('get_views', 'list-2', { datasheetId });

    const fields1 = await invoke('get_fields', 'list-1', { datasheetId });
    const existingFields = getArray(dataOf(fields1), ['fields', 'items']);
    const primaryField = existingFields.find(
      (field) => Boolean(field && typeof field === 'object' && (field as Record<string, unknown>).isPrimary === true),
    );
    const primaryFieldId = getFirstString(primaryField, ['fieldId', 'id']) ?? 'fld_missing_primary';
    await invoke('get_fields', 'list-2', { datasheetId, ...(viewId ? { viewId } : {}) });

    await invoke('get_records', 'v3-default', {
      datasheetId,
      pageSize: 5,
      pageNum: 1,
    });
    await invoke('get_records', 'v1-explicit', {
      datasheetId,
      apiVersion: 'v1',
      maxRecords: 10,
      fieldKey: 'id',
    });
    await invoke('get_records', 'v3-simple', {
      datasheetId,
      apiVersion: 'v3',
      pageSize: 10,
      pageNum: 1,
    });

    const firstCreatedByTool = new Map<string, string>();
    // Keep link targets in the fixture datasheet so MagicLookUp can reference its known primary field.
    const foreignDatasheetId = datasheetId;
    const fixedFieldInputs: Record<string, Record<string, unknown>> = {
      create_single_text_field: { defaultValue: '' },
      create_text_field: {},
      create_url_field: {},
      create_phone_field: {},
      create_email_field: {},
      create_work_doc_field: {},
      create_number_field: { precision: 2 },
      create_currency_field: { precision: 2, symbol: '¥', symbolAlign: 'Left' },
      create_percent_field: { precision: 2 },
      create_single_select_field: { options: [{ name: 'One' }, { name: 'Two' }] },
      create_multi_select_field: { options: [{ name: 'Red' }, { name: 'Blue' }] },
      create_checkbox_field: { icon: 'white_check_mark' },
      create_rating_field: { icon: 'star', max: 5 },
      create_date_time_field: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', includeTime: true },
      create_member_field: { isMulti: true, shouldSendMsg: false },
      create_created_time_field: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', includeTime: true },
      create_last_modified_time_field: {
        dateFormat: 'YYYY-MM-DD',
        timeFormat: 'HH:mm',
        includeTime: true,
        collectType: 0,
        fieldIdCollection: [primaryFieldId],
      },
      create_created_by_field: {},
      create_last_modified_by_field: { collectType: 0, fieldIdCollection: [primaryFieldId] },
      create_one_way_link_field: { foreignDatasheetId, limitSingleRecord: false },
      create_two_way_link_field: { foreignDatasheetId, limitSingleRecord: false },
      create_formula_field: { expression: '1 + 1', format: { type: 'Number', format: { precision: 2 } } },
      create_auto_number_field: {},
      create_button_field: {
        text: 'Open',
        style: { type: 'Background', color: { name: 'Blue', value: '#1677ff' } },
        action: { type: 'OpenLink', openLink: { type: 'Url', expression: 'https://vika.cn' } },
      },
      create_attachment_field: {},
    };

    for (const tool of FIELD_CREATE_TOOL_NAMES.filter((name) => name !== 'create_magic_lookup_field')) {
      for (let index = 1; index <= 2; index += 1) {
        const id = await createField(tool, index, fixedFieldInputs[tool] ?? {});
        if (id && index === 1) firstCreatedByTool.set(tool, id);
      }
    }

    const relatedLinkFieldId =
      firstCreatedByTool.get('create_one_way_link_field') ??
      firstCreatedByTool.get('create_two_way_link_field') ??
      'fld_missing_link';
    for (let index = 1; index <= 2; index += 1) {
      await createField('create_magic_lookup_field', index, {
        relatedLinkFieldId,
        targetFieldId: primaryFieldId,
        rollupFunction: 'VALUES',
      });
    }

    const tempTextFieldId = firstCreatedByTool.get('create_single_text_field') ?? primaryFieldId;
    for (let index = 1; index <= 2; index += 1) {
      const result = await invoke('create_records', `create-${index}`, {
        datasheetId,
        ...(viewId ? { viewId } : {}),
        fieldKey: 'id',
        records: [{ fields: { [primaryFieldId]: `${prefix}_record_${index}`, [tempTextFieldId]: `value_${index}` } }],
      });
      const recordId = getFirstString(dataOf(result), ['recordId', 'id']);
      if (recordId) createdRecordIds.push(recordId);
    }

    for (let index = 1; index <= 2; index += 1) {
      const recordId = createdRecordIds[index - 1] ?? `rec_missing_${index}`;
      await invoke('update_records', `update-${index}`, {
        datasheetId,
        fieldKey: 'id',
        records: [{ recordId, fields: { [tempTextFieldId]: `updated_${index}` } }],
      });
    }
    await invoke('upload_attachments', 'upload-1', { datasheetId, filePath: tempFiles[0], mimeType: 'text/plain' });
    await invoke(
      'upload_attachments',
      attachmentUrl ? 'upload-url' : 'upload-2',
      attachmentUrl
        ? { datasheetId, url: attachmentUrl, maxBytes: 5 * 1024 * 1024, downloadTimeoutMs: 30_000 }
        : { datasheetId, filePath: tempFiles[1], mimeType: 'text/plain' },
    );

    for (let index = 1; index <= 2; index += 1) {
      const result = await invoke('create_embedlinks', `create-${index}`, {
        spaceId,
        nodeId,
        theme: index === 1 ? 'light' : 'dark',
        payload: { permissionType: 'readOnly', viewControl: { tabBar: true } },
      });
      const linkId = getFirstString(dataOf(result), ['linkId', 'id']);
      if (linkId) createdEmbedLinkIds.push(linkId);
    }
    await invoke('get_embedlinks', 'list-1', { spaceId, nodeId });
    await invoke('get_embedlinks', 'list-2', { spaceId, nodeId });

    const fakeMemberIds = [`unit_${prefix}_member_1`, `unit_${prefix}_member_2`];
    for (let index = 1; index <= 2; index += 1) {
      const unitId = fakeMemberIds[index - 1]!;
      await invoke('get_a_member', `get-${index}`, { spaceId, unitId, sensitiveData: index === 2 });
      await invoke('update_a_member', `update-${index}`, {
        spaceId,
        unitId,
        sensitiveData: index === 2,
        name: `${prefix}_member_${index}`,
      });
      await invoke('delete_a_member', `delete-${index}`, { spaceId, unitId, confirm_destructive: true });
      await invoke('list_the_team_members', `list-${index}`, {
        spaceId,
        unitId: `unit_${prefix}_team_${index}`,
        pageSize: 10,
        pageNum: 1,
        sensitiveData: index === 2,
      });
      await invoke('list_teams', `list-${index}`, { spaceId, unitId: '0', pageSize: 10, pageNum: index });
    }

    for (let index = 1; index <= 2; index += 1) {
      const result = await invoke('create_a_team', `create-${index}`, {
        spaceId,
        name: `${prefix}_team_${index}`,
        sequence: index,
        parentUnitId: '0',
      });
      const id = getFirstString(dataOf(result), ['unitId', 'teamId', 'id']);
      if (id) createdTeamIds.push(id);
    }
    for (let index = 1; index <= 2; index += 1) {
      await invoke('update_a_team', `update-${index}`, {
        spaceId,
        unitId: createdTeamIds[index - 1] ?? `unit_${prefix}_team_missing_${index}`,
        name: `${prefix}_team_updated_${index}`,
        sequence: index + 10,
      });
    }

    for (let index = 1; index <= 2; index += 1) {
      await invoke('list_roles', `list-${index}`, { spaceId, pageSize: 10, pageNum: index });
      await invoke('list_units_under_the_role', `units-${index}`, {
        spaceId,
        unitId: `unit_${prefix}_role_${index}`,
        sensitiveData: index === 2,
      });
      const result = await invoke('create_a_role', `create-${index}`, {
        spaceId,
        name: `${prefix}_role_${index}`,
        sequence: index,
      });
      const id = getFirstString(dataOf(result), ['unitId', 'roleId', 'id']);
      if (id) createdRoleIds.push(id);
    }
    for (let index = 1; index <= 2; index += 1) {
      await invoke('update_a_role', `update-${index}`, {
        spaceId,
        unitId: createdRoleIds[index - 1] ?? `unit_${prefix}_role_missing_${index}`,
        name: `${prefix}_role_updated_${index}`,
        sequence: index + 10,
      });
    }

    for (let index = 1; index <= 2; index += 1) {
      await invoke('delete_records', `delete-${index}`, {
        datasheetId,
        recordIds: [createdRecordIds[index - 1] ?? `rec_missing_${index}`],
        confirm_destructive: true,
      });
    }
    createdRecordIds.length = 0;

    for (let index = 1; index <= 2; index += 1) {
      await invoke('delete_embedlinks', `delete-${index}`, {
        spaceId,
        nodeId,
        linkId: createdEmbedLinkIds[index - 1] ?? `emb_missing_${index}`,
        confirm_destructive: true,
      });
    }
    createdEmbedLinkIds.length = 0;

    const fieldsForCases = createdFields.splice(0, 2);
    for (let index = 1; index <= 2; index += 1) {
      await invoke('delete_fields', `delete-${index}`, {
        spaceId,
        datasheetId,
        fieldId: fieldsForCases[index - 1]?.id ?? `fld_missing_${index}`,
        confirm_destructive: true,
      });
    }

    for (let index = 1; index <= 2; index += 1) {
      await invoke('delete_a_team', `delete-${index}`, {
        spaceId,
        unitId: createdTeamIds[index - 1] ?? `unit_${prefix}_team_missing_${index}`,
        confirm_destructive: true,
      });
    }
    createdTeamIds.length = 0;
    for (let index = 1; index <= 2; index += 1) {
      await invoke('delete_a_role', `delete-${index}`, {
        spaceId,
        unitId: createdRoleIds[index - 1] ?? `unit_${prefix}_role_missing_${index}`,
        confirm_destructive: true,
      });
    }
    createdRoleIds.length = 0;
  } finally {
    for (const recordId of createdRecordIds) {
      await invoke('delete_records', 'cleanup', { datasheetId, recordIds: [recordId], confirm_destructive: true }, false);
    }
    for (const linkId of createdEmbedLinkIds) {
      await invoke('delete_embedlinks', 'cleanup', { spaceId, nodeId, linkId, confirm_destructive: true }, false);
    }
    for (const field of createdFields) {
      await invoke(
        'delete_fields',
        `cleanup-${field.tool}`,
        { spaceId, datasheetId, fieldId: field.id, confirm_destructive: true },
        false,
      );
    }
    for (const unitId of createdTeamIds) {
      await invoke('delete_a_team', 'cleanup', { spaceId, unitId, confirm_destructive: true }, false);
    }
    for (const unitId of createdRoleIds) {
      await invoke('delete_a_role', 'cleanup', { spaceId, unitId, confirm_destructive: true }, false);
    }
    await rm(tempDir, { recursive: true, force: true });
  }

  const missingCaseCoverage = PUBLIC_TOOL_NAMES.filter((name) => (caseCounts.get(name) ?? 0) < 2);
  const missingHttpCoverage = PUBLIC_TOOL_NAMES.filter((name) => (httpCounts.get(name) ?? 0) < 2);
  const successCount = results.filter((result) => result.outcome === 'success').length;
  const upstreamErrorCount = results.filter((result) => result.outcome === 'upstream_error').length;
  const localErrors = results.filter((result) => result.outcome === 'local_error');
  const expectedRestrictions = results.filter(
    (result) =>
      result.outcome === 'upstream_error' &&
      (result.message?.includes('仅适用于企业级空间站') || result.message?.includes('仅可在黄金级以上的空间站中调用')),
  );
  const unexpectedUpstreamErrors = results.filter(
    (result) => result.outcome === 'upstream_error' && !expectedRestrictions.includes(result),
  );
  const report = {
    prefix,
    requestIntervalMs,
    registeredTools: PUBLIC_TOOL_NAMES.length,
    totalCases: results.length,
    successCount,
    upstreamErrorCount,
    expectedRestrictionCount: expectedRestrictions.length,
    unexpectedUpstreamErrorCount: unexpectedUpstreamErrors.length,
    localErrorCount: localErrors.length,
    missingCaseCoverage,
    missingHttpCoverage,
    retainedDatasheets,
    results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (
    missingCaseCoverage.length > 0 ||
    missingHttpCoverage.length > 0 ||
    localErrors.length > 0 ||
    unexpectedUpstreamErrors.length > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

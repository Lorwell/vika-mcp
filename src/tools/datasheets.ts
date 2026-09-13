import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { datasheetIdSchema, nodeIdSchema, spaceIdSchema, viewIdSchema } from '../schemas/common.js';
import {
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_REMOTE_DOWNLOAD_TIMEOUT_MS,
  MAX_ATTACHMENT_MAX_BYTES,
  MAX_REMOTE_DOWNLOAD_TIMEOUT_MS,
} from '../http/remote-file.js';
import { registerTool, type ToolDependencies, ok, requireDestructiveConfirmation } from './common.js';

const embedToolBarSchema = z.object({
  basicTools: z.boolean().optional(),
  shareBtn: z.boolean().optional(),
  widgetBtn: z.boolean().optional(),
  apiBtn: z.boolean().optional(),
  formBtn: z.boolean().optional(),
  historyBtn: z.boolean().optional(),
  robotBtn: z.boolean().optional(),
  addWidgetBtn: z.boolean().optional(),
  fullScreenBtn: z.boolean().optional(),
  formSettingBtn: z.boolean().optional(),
});

const embedPayloadSchema = z.object({
  primarySideBar: z
    .union([z.boolean(), z.object({ collapsed: z.boolean().optional() })])
    .optional(),
  viewControl: z
    .object({
      viewId: viewIdSchema.optional(),
      tabBar: z.boolean().optional(),
      titleBar: z.boolean().optional(),
      nodeInfoBar: z.boolean().optional(),
      toolBar: embedToolBarSchema.optional(),
      collapsed: z.boolean().optional(),
      collaboratorStatusBar: z.boolean().optional(),
    })
    .optional(),
  bannerLogo: z.boolean().optional(),
  permissionType: z.enum(['readOnly', 'publicEdit', 'privateEdit']).optional(),
  isShowEmbedToolBar: z.boolean().optional(),
  viewManualSave: z.boolean().optional(),
});

const uploadAttachmentSchema = z
  .object({
    datasheetId: datasheetIdSchema,
    filePath: z.string().min(1).optional().describe('Local file path. Mutually exclusive with url.'),
    url: z.string().url().max(2048).optional().describe('Public HTTP(S) file URL. Mutually exclusive with filePath.'),
    fileName: z.string().min(1).max(255).optional(),
    mimeType: z.string().min(1).max(255).optional(),
    maxBytes: z.number().int().min(1).max(MAX_ATTACHMENT_MAX_BYTES).default(DEFAULT_ATTACHMENT_MAX_BYTES),
    downloadTimeoutMs: z
      .number()
      .int()
      .min(100)
      .max(MAX_REMOTE_DOWNLOAD_TIMEOUT_MS)
      .default(DEFAULT_REMOTE_DOWNLOAD_TIMEOUT_MS),
  })
  .superRefine(({ filePath, url }, context) => {
    if ((filePath ? 1 : 0) + (url ? 1 : 0) !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Exactly one of filePath or url is required.',
        path: ['filePath'],
      });
    }
  });

export function registerDatasheetTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(
    server,
    deps,
    {
      name: 'create_datasheets',
      description: 'Create a new datasheet in a space.',
      inputSchema: z.object({
        spaceId: spaceIdSchema,
        name: z.string().min(1).max(100).describe('Datasheet name.'),
        description: z.string().max(500).optional().describe('Datasheet description.'),
        folderId: z.string().optional().describe('Parent folder ID. Defaults to workspace root.'),
        preNodeId: z.string().optional().describe('Previous node ID for positioning.'),
      }),
      execute: async ({ spaceId, name, description, folderId, preNodeId }) => {
        const { data, meta } = await deps.client.request({
          method: 'POST',
          path: `/spaces/${spaceId}/datasheets`,
          body: { name, description, folderId, preNodeId },
          feature: 'create_datasheets',
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
      name: 'upload_attachments',
      description: 'Upload one local file or safely downloaded public HTTP(S) URL to a datasheet.',
      inputSchema: uploadAttachmentSchema,
      execute: async ({ datasheetId, filePath, url, fileName, mimeType, maxBytes, downloadTimeoutMs }) => {
        const form = filePath
          ? await deps.client.createSingleFileFormData(filePath, fileName, mimeType, maxBytes)
          : await deps.client.createRemoteFileFormData({
              url: url!,
              fileName,
              mimeType,
              maxBytes,
              timeoutMs: downloadTimeoutMs,
            });
        const { data, meta } = await deps.client.request({
          method: 'POST',
          path: `/datasheets/${datasheetId}/attachments`,
          formData: form,
          feature: 'upload_attachments',
          idempotent: false,
          timeoutMs: 120_000,
        });
        return ok(data, meta);
      },
    },
  );

  registerTool(
    server,
    deps,
    {
      name: 'get_embedlinks',
      description: 'List embed links for a datasheet node.',
      inputSchema: z.object({
        spaceId: spaceIdSchema,
        nodeId: nodeIdSchema.describe('Datasheet node ID.'),
      }),
      readOnly: true,
      execute: async ({ spaceId, nodeId }) => {
        const { data, meta } = await deps.client.request({
          method: 'GET',
          path: `/spaces/${spaceId}/nodes/${nodeId}/embedlinks`,
          feature: 'get_embedlinks',
        });
        return ok(data, meta);
      },
    },
  );

  registerTool(
    server,
    deps,
    {
      name: 'create_embedlinks',
      description: 'Create an embed link for a datasheet node.',
      inputSchema: z.object({
        spaceId: spaceIdSchema,
        nodeId: nodeIdSchema,
        payload: embedPayloadSchema.optional(),
        theme: z.enum(['light', 'dark']).optional(),
      }),
      execute: async ({ spaceId, nodeId, payload, theme }) => {
        const { data, meta } = await deps.client.request({
          method: 'POST',
          path: `/spaces/${spaceId}/nodes/${nodeId}/embedlinks`,
          body: { payload, theme },
          feature: 'create_embedlinks',
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
      name: 'delete_embedlinks',
      description: 'Delete an embed link for a file node.',
      inputSchema: z.object({
        spaceId: spaceIdSchema,
        nodeId: nodeIdSchema,
        linkId: z.string().min(1).describe('Embed link ID.'),
        confirm_destructive: z.boolean().optional(),
      }),
      execute: async ({ spaceId, nodeId, linkId, confirm_destructive }) => {
        requireDestructiveConfirmation(confirm_destructive);
        const { data, meta } = await deps.client.request({
          method: 'DELETE',
          path: `/spaces/${spaceId}/nodes/${nodeId}/embedlinks/${linkId}`,
          feature: 'delete_embedlinks',
          idempotent: false,
        });
        return ok(data, meta);
      },
    },
  );
}

import { describe, expect, it, vi } from 'vitest';
import { ProxyAgent } from 'undici';

import type { AppConfig } from '../../src/config.js';
import { CapabilityRegistry } from '../../src/capabilities.js';
import { VikaClient } from '../../src/http/client.js';
import { destructiveGuardError, VikaToolError } from '../../src/http/errors.js';
import { Logger } from '../../src/logger.js';

function makeConfig(): AppConfig {
  return {
    host: 'https://example.test',
    token: 'secret-token',
    timeoutMs: 1_000,
    allowInsecureTls: false,
    logLevel: 'error',
  };
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

describe('VikaClient', () => {
  it('injects authorization and serializes official record query values', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(
        200,
        {
          success: true,
          data: {
            records: [],
          },
        },
        { 'request-id': 'req-1' },
      ),
    );

    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);
    await client.request({
      method: 'GET',
      path: '/datasheets/dst123/records',
      query: {
        recordIds: 'recA,recB',
        sort: [{ field: 'fldA', order: 'asc' }],
      },
      feature: 'records.list',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = decodeURIComponent(String(input));
    const headers = new Headers(init?.headers);

    expect(headers.get('Authorization')).toBe('Bearer secret-token');
    expect(url).toContain('/fusion/v1/datasheets/dst123/records?');
    expect(url).toContain('recordIds=recA,recB');
    expect(url).toContain('sort[][field]=fldA');
    expect(url).toContain('sort[][order]=asc');
  });

  it('routes v3 requests through the versioned public Fusion path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(200, { success: true, data: [] }));
    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);

    const result = await client.request({
      method: 'GET',
      version: 'v3',
      path: '/datasheets/dst123/records',
      feature: 'get_records.v3',
    });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('/fusion/v3/datasheets/dst123/records');
    expect(result.meta.version).toBe('v3');
  });

  it('rejects internal, pre-versioned, and absolute paths', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);

    for (const path of ['/api/v1/node/create', '/fusion/v1/spaces', 'https://example.test/fusion/v1/spaces']) {
      await expect(client.request({ method: 'GET', path })).rejects.toMatchObject({ category: 'validation' });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries idempotent GET requests on 429', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(429, { success: false, code: 429, message: 'slow down' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }, { 'request-id': 'req-2' }));

    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);
    const result = await client.request({
      method: 'GET',
      path: '/spaces',
      feature: 'spaces.list',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ ok: true });
    expect(result.meta.attempts).toBe(2);
  });

  it('does not retry non-idempotent POST requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(503, { success: false, code: 503, message: 'retry later' }));

    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);

    await expect(
      client.request({
        method: 'POST',
        path: '/datasheets/dst123/records',
        body: { records: [] },
        feature: 'records.create',
        idempotent: false,
      }),
    ).rejects.toBeInstanceOf(VikaToolError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 401 to authentication errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401, { success: false, code: 401, message: 'invalid token' }));

    const client = new VikaClient(makeConfig(), new Logger('error'), new CapabilityRegistry(), fetchMock as typeof fetch);

    await expect(
      client.request({
        method: 'GET',
        path: '/spaces',
      }),
    ).rejects.toMatchObject({
      category: 'authentication',
      httpStatus: 401,
    });
  });

  it('caches feature_unavailable after a 501 on feature-gated endpoints', async () => {
    const capabilities = new CapabilityRegistry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(501, { success: false, code: 501, message: 'The API does not exist' }, { 'request-id': 'req-501' }),
      );

    const client = new VikaClient(makeConfig(), new Logger('error'), capabilities, fetchMock as typeof fetch);

    await expect(
      client.request({
        method: 'GET',
        path: '/spaces/spc123/roles',
        feature: 'roles.list',
      }),
    ).rejects.toMatchObject({
      category: 'feature_unavailable',
      httpStatus: 501,
    });

    await expect(
      client.request({
        method: 'GET',
        path: '/spaces/spc123/roles',
        feature: 'roles.list',
      }),
    ).rejects.toMatchObject({
      category: 'feature_unavailable',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps v1 records available when the v3 feature is unavailable', async () => {
    const capabilities = new CapabilityRegistry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(501, { success: false, code: 501, message: 'v3 unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { records: [] } }));
    const client = new VikaClient(makeConfig(), new Logger('error'), capabilities, fetchMock as typeof fetch);

    await expect(
      client.request({
        method: 'GET',
        version: 'v3',
        path: '/datasheets/dst123/records',
        feature: 'get_records.v3',
      }),
    ).rejects.toMatchObject({ category: 'feature_unavailable' });

    const v1Result = await client.request({
      method: 'GET',
      version: 'v1',
      path: '/datasheets/dst123/records',
      feature: 'get_records.v1',
    });

    expect(v1Result.data).toEqual({ records: [] });
    expect(capabilities.isUnavailable('get_records.v3')).toBe(true);
    expect(capabilities.isUnavailable('get_records.v1')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache authorization failures as feature_unavailable', async () => {
    const capabilities = new CapabilityRegistry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(403, { success: false, code: 602, message: 'forbidden' }));

    const client = new VikaClient(makeConfig(), new Logger('error'), capabilities, fetchMock as typeof fetch);

    await expect(
      client.request({
        method: 'GET',
        path: '/spaces/spc123/nodes/fld123',
        feature: 'get_node_details',
      }),
    ).rejects.toMatchObject({
      category: 'authorization',
      httpStatus: 403,
    });

    expect(capabilities.isUnavailable('get_node_details')).toBe(false);
  });

  it('uses a ProxyAgent when VIKA_PROXY_URL is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }));

    const client = new VikaClient(
      {
        ...makeConfig(),
        proxyUrl: 'http://proxy.test:8080',
      },
      new Logger('error'),
      new CapabilityRegistry(),
      fetchMock as typeof fetch,
    );

    await client.request({
      method: 'GET',
      path: '/spaces',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeInstanceOf(ProxyAgent);
  });
});

describe('destructive confirmation guard', () => {
  it('returns a dedicated guard error', () => {
    expect(destructiveGuardError().toShape()).toMatchObject({
      category: 'destructive_guard',
      retriable: false,
    });
  });
});

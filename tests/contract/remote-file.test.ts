import { describe, expect, it, vi } from 'vitest';

import {
  downloadRemoteFile,
  isPublicAddress,
  MAX_ATTACHMENT_MAX_BYTES,
} from '../../src/http/remote-file.js';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('remote attachment downloader', () => {
  it('recognizes public and blocked IPv4/IPv6 ranges', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);

    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.51.100.1',
      '224.0.0.1',
      '::',
      '::1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('downloads a public URL with DNS pinning and derives metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined();
      expect(init?.redirect).toBe('manual');
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'image/png; charset=binary',
          'content-disposition': "attachment; filename*=UTF-8''hello%20world.png",
        },
      });
    });

    const result = await downloadRemoteFile(
      { url: 'https://files.example.test/original' },
      { resolve: publicResolver, fetch: fetchMock },
    );

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.fileName).toBe('hello world.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.finalUrl).toBe('https://files.example.test/original');
  });

  it('rejects unsafe schemes, embedded credentials, and private DNS results', async () => {
    await expect(downloadRemoteFile({ url: 'file:///etc/passwd' })).rejects.toMatchObject({ category: 'validation' });
    await expect(downloadRemoteFile({ url: 'http://[::1]/private' })).rejects.toMatchObject({ category: 'validation' });
    await expect(downloadRemoteFile({ url: 'https://user:pass@example.com/a' })).rejects.toMatchObject({
      category: 'validation',
    });
    await expect(
      downloadRemoteFile(
        { url: 'https://metadata.example.test/latest' },
        { resolve: async () => [{ address: '169.254.169.254', family: 4 }] },
      ),
    ).rejects.toMatchObject({ category: 'validation' });
  });

  it('revalidates redirect targets and blocks private or downgraded redirects', async () => {
    const privateRedirect = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    );
    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/start' },
        { resolve: publicResolver, fetch: privateRedirect },
      ),
    ).rejects.toMatchObject({ category: 'validation' });
    expect(privateRedirect).toHaveBeenCalledTimes(1);

    const downgrade = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://cdn.example.test/file' } }),
    );
    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/start' },
        { resolve: publicResolver, fetch: downgrade },
      ),
    ).rejects.toMatchObject({ category: 'validation' });
  });

  it('enforces both declared and streamed size limits', async () => {
    const declaredTooLarge = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { headers: { 'content-length': '100' } }),
    );
    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/file', maxBytes: 10 },
        { resolve: publicResolver, fetch: declaredTooLarge },
      ),
    ).rejects.toMatchObject({ category: 'validation' });

    const streamedTooLarge = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4, 5])));
    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/file', maxBytes: 4 },
        { resolve: publicResolver, fetch: streamedTooLarge },
      ),
    ).rejects.toMatchObject({ category: 'validation' });

    await expect(
      downloadRemoteFile({ url: 'https://files.example.test/file', maxBytes: MAX_ATTACHMENT_MAX_BYTES + 1 }),
    ).rejects.toMatchObject({ category: 'validation' });
  });

  it('applies one timeout to the complete download', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        }),
    );

    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/slow', timeoutMs: 100 },
        { resolve: publicResolver, fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ category: 'network', retriable: true });

    await expect(
      downloadRemoteFile(
        { url: 'https://files.example.test/dns-stall', timeoutMs: 100 },
        { resolve: async () => new Promise(() => undefined), fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ category: 'network', retriable: true });
  });
});

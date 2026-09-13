import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Agent } from 'undici';

import { VikaToolError } from './errors.js';

export const DEFAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_REMOTE_DOWNLOAD_TIMEOUT_MS = 15_000;
export const MAX_REMOTE_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

interface ResolvedAddress {
  address: string;
  family: number;
}

export interface DownloadedRemoteFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  finalUrl: string;
}

export interface RemoteFileOptions {
  url: string;
  fileName?: string;
  mimeType?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

interface RemoteFileDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  fetch?: typeof fetch;
}

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 96],
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function validationError(message: string): VikaToolError {
  return new VikaToolError({ category: 'validation', message, retriable: false });
}

function networkError(message: string, retriable = false): VikaToolError {
  return new VikaToolError({ category: 'network', message, retriable });
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  if (family === 6) return !blockedAddresses.check(address, 'ipv6');
  return false;
}

function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validationError('url must be a valid absolute HTTP or HTTPS URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw validationError('Only http: and https: URLs are allowed.');
  }
  if (url.username || url.password) {
    throw validationError('URLs containing credentials are not allowed.');
  }
  if (!url.hostname) {
    throw validationError('The remote URL must include a hostname.');
  }
  return url;
}

async function resolvePublicAddresses(
  url: URL,
  resolver: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress[]> {
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolver(hostname);

  if (addresses.length === 0) {
    throw networkError(`The remote hostname did not resolve: ${hostname}`, true);
  }
  for (const address of addresses) {
    if (
      (address.family !== 4 && address.family !== 6) ||
      isIP(address.address) !== address.family ||
      !isPublicAddress(address.address)
    ) {
      throw validationError(`The remote hostname resolves to a blocked address: ${address.address}`);
    }
  }
  return addresses;
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function createPinnedDispatcher(addresses: ResolvedAddress[]): Agent {
  let cursor = 0;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const requestedFamily = typeof options === 'number' ? options : options.family;
        const candidates = requestedFamily
          ? addresses.filter((address) => address.family === requestedFamily)
          : addresses;
        if (candidates.length === 0) {
          const error = new Error('No approved address matches the requested address family.') as NodeJS.ErrnoException;
          error.code = 'ENOTFOUND';
          callback(error, '', 0);
          return;
        }
        if (typeof options === 'object' && options.all) {
          callback(null, candidates, 0);
          return;
        }
        const selected = candidates[cursor % candidates.length]!;
        cursor += 1;
        callback(null, selected.address, selected.family);
      },
    },
  });
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 255);
  return sanitized || 'download.bin';
}

function decodeFileName(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function responseFileName(response: Response, url: URL): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedMatch = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  const plainMatch = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  const headerName = encodedMatch?.[1]
    ? decodeFileName(encodedMatch[1].trim())
    : plainMatch?.[1] ?? plainMatch?.[2]?.trim();
  const pathName = url.pathname.split('/').filter(Boolean).at(-1);
  return sanitizeFileName(headerName ?? (pathName ? decodeFileName(pathName) : undefined) ?? 'download.bin');
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel();
    throw validationError(`Remote file exceeds maxBytes (${maxBytes}).`);
  }
  if (!response.body) {
    throw networkError('Remote response did not include a body.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw validationError(`Remote file exceeds maxBytes (${maxBytes}).`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadRemoteFile(
  options: RemoteFileOptions,
  dependencies: RemoteFileDependencies = {},
): Promise<DownloadedRemoteFile> {
  const maxBytes = options.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ATTACHMENT_MAX_BYTES) {
    throw validationError(`maxBytes must be between 1 and ${MAX_ATTACHMENT_MAX_BYTES}.`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_REMOTE_DOWNLOAD_TIMEOUT_MS) {
    throw validationError(`downloadTimeoutMs must be between 100 and ${MAX_REMOTE_DOWNLOAD_TIMEOUT_MS}.`);
  }

  const resolver = dependencies.resolve ?? (async (hostname) => dnsLookup(hostname, { all: true, verbatim: true }));
  const fetchImpl = dependencies.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = validateUrl(options.url);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const addresses = await withAbort(resolvePublicAddresses(currentUrl, resolver), controller.signal);
      const dispatcher = createPinnedDispatcher(addresses);
      try {
        const response = await fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: '*/*', 'User-Agent': 'vika-fusion-mcp/1.0 remote-file-fetch' },
          dispatcher,
        } as RequestInit & { dispatcher: Agent });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          if (redirectCount === MAX_REDIRECTS) {
            throw validationError(`Remote URL exceeded ${MAX_REDIRECTS} redirects.`);
          }
          const location = response.headers.get('location');
          if (!location) throw networkError('Remote redirect did not include a Location header.');
          const nextUrl = validateUrl(new URL(location, currentUrl).toString());
          if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
            throw validationError('Redirects from HTTPS to HTTP are not allowed.');
          }
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel();
          throw networkError(`Remote server returned HTTP ${response.status}.`, response.status >= 500);
        }

        const bytes = await readLimitedBody(response, maxBytes);
        const responseType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
        return {
          bytes,
          fileName: sanitizeFileName(options.fileName ?? responseFileName(response, currentUrl)),
          mimeType: options.mimeType ?? responseType ?? 'application/octet-stream',
          finalUrl: currentUrl.toString(),
        };
      } finally {
        await dispatcher.close();
      }
    }
  } catch (error) {
    if (error instanceof VikaToolError) throw error;
    if (controller.signal.aborted) {
      throw networkError(`Remote download timed out after ${timeoutMs}ms.`, true);
    }
    throw networkError(error instanceof Error ? `Remote download failed: ${error.message}` : 'Remote download failed.', true);
  } finally {
    clearTimeout(timeout);
  }

  throw networkError('Remote download failed.');
}

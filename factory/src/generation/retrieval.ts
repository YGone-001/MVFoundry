import {createHash} from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {RetrievalError, type RetrievalErrorCode} from '../errors';
import type {GenerationOutputKind, GenerationProviderId, OutputHostPolicy, RedactedSourceIdentity, RetrievalRecord} from './types';
import {RETRIEVAL_POLICY_VERSION} from './types';
import {finalizeDownloadedFile, writeRetrievalState} from './finalization';
import {
  assertSafePath,
  ensureSafeDirectory,
  type WriteBoundary,
} from '../workspace/writeBoundary';
import {isInside} from '../workspace/guard';

const MAX_URL_LENGTH = 2048;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EXPIRED_STATUSES = new Set([403, 404, 410]);

/**
 * Trusted output-host policy per provider. Signed result URLs are served from a
 * content-delivery domain that is not the API host, so the rule cannot be
 * "same host as the API". Expanding this list is a reviewed change: every entry
 * must be a provider-documented delivery domain, and the negative tests in
 * `providerRetrieval.test.ts` assume this list stays closed.
 */
export const OUTPUT_HOST_POLICIES: Record<GenerationProviderId, OutputHostPolicy> = {
  runway: {
    provider: 'runway',
    hosts: ['dnznrvs05pmza.cloudfront.net'],
    maxRedirects: 3,
    maxBytes: 256 * 1024 * 1024,
    timeoutMs: 120_000,
    contentTypes: ['video/mp4', 'image/png', 'image/jpeg'],
  },
  'offline-fixture': {
    provider: 'offline-fixture',
    hosts: [],
    maxRedirects: 0,
    maxBytes: 64 * 1024 * 1024,
    timeoutMs: 30_000,
    contentTypes: ['video/mp4', 'image/png'],
  },
};

const fail = (code: RetrievalErrorCode, message: string, recoverable = false): never => {
  throw new RetrievalError(code, message, recoverable);
};

const isDisallowedIpv4 = (address: string): boolean => {
  const parts = address.split('.');
  if (parts.length !== 4) return true;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
};

const isDisallowedIpv6 = (raw: string): boolean => {
  const address = raw.toLowerCase().split('%')[0];
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isDisallowedIpv4(mapped[1]);
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(address)) return true; // link-local
  if (address.startsWith('ff')) return true; // multicast
  if (address.startsWith('2001:db8')) return true; // documentation
  if (address.startsWith('2002:')) return true; // 6to4
  if (address.startsWith('64:ff9b')) return true; // NAT64
  return false;
};

/** Conservative blocklist, not a complete registry of every special-use range. */
export const isDisallowedAddress = (address: string): boolean => {
  const trimmed = address.trim();
  if (trimmed === '') return true;
  const family = trimmed.includes(':') ? 6 : 4;
  return family === 6 ? isDisallowedIpv6(trimmed) : isDisallowedIpv4(trimmed);
};

const isIpLiteral = (hostname: string): boolean => {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  if (hostname.includes(':')) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
};

const hostMatchesPolicy = (hostname: string, policy: OutputHostPolicy): boolean => {
  const host = hostname.toLowerCase();
  for (const entry of policy.hosts) {
    const candidate = entry.toLowerCase();
    if (candidate.startsWith('.')) {
      if (host === candidate.slice(1) || host.endsWith(candidate)) return true;
      continue;
    }
    if (host === candidate) return true;
  }
  return false;
};

export type ValidatedOutputUrl = {
  url: URL;
  hostname: string;
  pathname: string;
  queryParameters: number;
};

/**
 * Structural URL policy. Applied to the first URL and to every redirect target.
 * Signed query parameters are counted, never recorded.
 */
export const validateOutputUrl = (raw: string, policy: OutputHostPolicy): ValidatedOutputUrl => {
  if (typeof raw !== 'string' || raw.trim() === '') fail('malformed-url', 'Output URL is empty');
  if (raw.length > MAX_URL_LENGTH) {
    fail('malformed-url', `Output URL exceeds the documented ${MAX_URL_LENGTH} character limit`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail('malformed-url', 'Output URL is not a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    fail('unsupported-protocol', `Output URL scheme ${parsed.protocol} is not permitted; HTTPS is required`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('credentials-in-url', 'Output URL embeds credentials and is refused');
  }
  if (parsed.port !== '' && parsed.port !== '443') {
    fail('unexpected-port', `Output URL port ${parsed.port} is not permitted`);
  }
  if (parsed.hostname === '') fail('malformed-url', 'Output URL has no host');
  if (isIpLiteral(parsed.hostname)) {
    fail('ip-literal-not-allowed', 'Output URL uses an IP literal; provider delivery hosts must be DNS names');
  }
  if (policy.hosts.length === 0) {
    fail('host-not-allowed', `provider ${policy.provider} declares no trusted output hosts`);
  }
  if (!hostMatchesPolicy(parsed.hostname, policy)) {
    fail('host-not-allowed', `Output host ${parsed.hostname} is not in the ${policy.provider} delivery allowlist`);
  }
  const queryParameters = [...parsed.searchParams.keys()].length;
  return {url: parsed, hostname: parsed.hostname, pathname: parsed.pathname, queryParameters};
};

export const redactSource = (validated: ValidatedOutputUrl): RedactedSourceIdentity => ({
  host: validated.hostname,
  path: validated.pathname,
  queryParameters: validated.queryParameters,
  signedQueryRedacted: true,
});

/** Default resolver: refuses to run. A live retrieval must inject a resolver. */
export const createDeniedHostResolver = (): ((hostname: string) => Promise<string[]>) => async (
  hostname,
) => {
  throw new RetrievalError(
    'dns-failure',
    `host resolution for ${hostname} is not authorized; inject an explicit resolver`,
  );
};

const assertResolvedAddresses = async (
  hostname: string,
  resolver: (hostname: string) => Promise<string[]>,
): Promise<void> => {
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    fail('dns-failure', `Unable to resolve output host ${hostname}`);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    fail('dns-failure', `Output host ${hostname} resolved to no address`);
  }
  for (const address of addresses) {
    if (isDisallowedAddress(address)) {
      fail('blocked-address', `Output host ${hostname} resolves to a disallowed address`);
    }
  }
};

const headerValue = (headers: Record<string, string>, name: string): string | null => {
  const key = name.toLowerCase();
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() === key) return value;
  }
  return null;
};

const contentTypeOf = (headers: Record<string, string>): string => {
  const raw = headerValue(headers, 'content-type') ?? '';
  return raw.split(';')[0].trim().toLowerCase();
};

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  'video/mp4': (bytes) => bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp',
  'image/png': (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

export const assertMediaMagic = (bytes: Buffer, contentType: string, label: string): void => {
  const probe = MAGIC[contentType];
  if (!probe) fail('content-type-not-allowed', `${label} declares unsupported content type ${contentType}`);
  if (!probe(bytes)) {
    fail('magic-byte-mismatch', `${label} content does not match its declared ${contentType} type`);
  }
};

export type RetrieveRemoteOutputInput = {
  boundary: WriteBoundary;
  jobId: string;
  providerTaskId: string | null;
  kind: GenerationOutputKind;
  url: string;
  policy: OutputHostPolicy;
  transport: (request: {
    url: string;
    headers: Record<string, string>;
    signal: AbortSignal | null;
  }) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: AsyncIterable<Uint8Array>;
    declaredBytes?: number | null;
  }>;
  resolver: (hostname: string) => Promise<string[]>;
  /** Project-relative destination, always inside the authorized project. */
  targetRelativePath: string;
  /** Only an explicit replacement may overwrite a previously finalized output. */
  overwriteFinalized?: boolean;
  now?: () => number;
};

export type RetrieveRemoteOutputResult = {
  record: RetrievalRecord;
  absolutePath: string;
  head: Buffer;
};

const kindForContentType = (contentType: string): GenerationOutputKind | null => {
  if (contentType === 'video/mp4') return 'video';
  if (contentType === 'image/png' || contentType === 'image/jpeg') return 'image';
  return null;
};

/**
 * Downloads one provider result into the project with bounded size, bounded
 * redirects, DNS/IP screening, content inspection and atomic finalization.
 * Nothing outside the project is written, and a partial file never survives.
 */
export const retrieveRemoteOutput = async (
  input: RetrieveRemoteOutputInput,
): Promise<RetrieveRemoteOutputResult> => {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const deadline = started + input.policy.timeoutMs;

  const assertContentType = (contentType: string): void => {
    if (!input.policy.contentTypes.includes(contentType)) {
      fail('content-type-not-allowed', `Content type ${contentType || '<missing>'} is not permitted`);
    }
    const derived = kindForContentType(contentType);
    if (derived === null) {
      fail('content-type-not-allowed', `Content type ${contentType} has no supported media kind`);
    }
    if (input.kind === 'video' && derived !== 'video') {
      fail('content-type-not-allowed', `Job ${input.jobId} expects video output but received ${contentType}`);
    }
    if (input.kind !== 'video' && derived !== 'image') {
      fail('content-type-not-allowed', `Job ${input.jobId} expects image output but received ${contentType}`);
    }
  };

  let current = validateOutputUrl(input.url, input.policy);
  let redirects = 0;
  let response: Awaited<ReturnType<RetrieveRemoteOutputInput['transport']>> | null = null;

  while (true) {
    await assertResolvedAddresses(current.hostname, input.resolver);
    const controller = new AbortController();
    const remaining = deadline - now();
    if (remaining <= 0) fail('timeout', 'Output retrieval exceeded its deadline before the request');
    const timer = setTimeout(() => controller.abort(), remaining);
    let received: Awaited<ReturnType<RetrieveRemoteOutputInput['transport']>>;
    try {
      received = await input.transport({
        url: current.url.toString(),
        headers: {accept: input.policy.contentTypes.join(', ')},
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted) fail('timeout', 'Output retrieval timed out');
      fail('http-error', 'Output transport failed before a response was received');
    }
    clearTimeout(timer);

    if (REDIRECT_STATUSES.has(received.status)) {
      const location = headerValue(received.headers, 'location');
      if (!location) fail('redirect-without-location', `Redirect ${received.status} carried no Location header`);
      redirects += 1;
      if (redirects > input.policy.maxRedirects) {
        fail('too-many-redirects', `Output retrieval exceeded ${input.policy.maxRedirects} redirects`);
      }
      let next: URL;
      try {
        next = new URL(location, current.url);
      } catch {
        fail('malformed-url', 'Redirect target is not a valid URL');
      }
      current = validateOutputUrl(next.toString(), input.policy);
      continue;
    }
    if (received.status >= 300 && received.status < 400) {
      fail('http-error', `Unsupported redirect status ${received.status}`);
    }
    if (EXPIRED_STATUSES.has(received.status)) {
      fail('url-expired', `Provider result URL is no longer valid (HTTP ${received.status})`, true);
    }
    if (received.status !== 200) {
      fail('http-error', `Output retrieval failed with HTTP ${received.status}`);
    }
    response = received;
    break;
  }

  const contentType = contentTypeOf(response.headers);
  assertContentType(contentType);

  const declaredHeader = headerValue(response.headers, 'content-length');
  const declaredLength = declaredHeader === null ? null : Number(declaredHeader);
  if (declaredLength !== null && (!Number.isFinite(declaredLength) || declaredLength < 0)) {
    fail('http-error', 'Output response declared an invalid Content-Length');
  }
  if (declaredLength !== null && declaredLength > input.policy.maxBytes) {
    fail(
      'declared-too-large',
      `Declared Content-Length ${declaredLength} exceeds the ${input.policy.maxBytes} byte limit`,
    );
  }
  if (declaredLength === 0) fail('empty-body', 'Output response declared zero bytes');

  const tempDir = ensureSafeDirectory(
    input.boundary,
    path.join(input.boundary.cacheRoot, 'retrieval', input.jobId),
    'cache',
  );
  const targetAbsolute = assertSafePath(input.boundary, input.targetRelativePath, {
    expect: 'file',
    subtree: 'project',
  });
  if (!isInside(input.boundary.projectRoot, targetAbsolute)) {
    fail('destination-not-allowed', 'Retrieval destination is outside the authorized project');
  }
  const tempPath = assertSafePath(input.boundary, path.join(tempDir, `${path.basename(targetAbsolute)}.part`), {
    expect: 'file',
    subtree: 'cache',
  });

  let handle: number | null = null;
  let written = 0;
  const digest = createHash('sha256');
  const headChunks: Buffer[] = [];
  let headBytes = 0;
  writeRetrievalState(input.boundary, {
    jobId: input.jobId,
    providerTaskId: input.providerTaskId,
    phase: 'downloading',
    tempPath: path.relative(input.boundary.projectRoot, tempPath).split(path.sep).join('/'),
    targetPath: input.targetRelativePath.split(path.sep).join('/'),
    sha256: null,
    bytes: null,
    message: null,
  });
  try {
    if (existsSync(tempPath)) rmSync(tempPath, {force: true});
    handle = openSync(tempPath, 'wx');
    for await (const chunk of response.body) {
      if (now() > deadline) fail('timeout', 'Output retrieval exceeded its deadline while streaming');
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      written += buffer.length;
      if (written > input.policy.maxBytes) {
        fail('too-large', `Output exceeded the ${input.policy.maxBytes} byte limit while streaming`);
      }
      if (headBytes < 64) {
        const slice = buffer.subarray(0, Math.max(0, 64 - headBytes));
        if (slice.length > 0) {
          headChunks.push(slice);
          headBytes += slice.length;
        }
      }
      digest.update(buffer);
      writeSync(handle, buffer);
    }
    closeSync(handle);
    handle = null;
    if (written === 0) fail('empty-body', 'Output response produced no bytes');
    if (declaredLength !== null && written !== declaredLength) {
      fail('truncated', `Output declared ${declaredLength} bytes but produced ${written}`);
    }
    if (
      typeof response.declaredBytes === 'number' &&
      Number.isFinite(response.declaredBytes) &&
      written !== response.declaredBytes
    ) {
      fail('truncated', `Output transport produced ${written} of ${response.declaredBytes} declared bytes`);
    }
    const magic = Buffer.concat(headChunks).subarray(0, headBytes);
    assertMediaMagic(magic, contentType, `Job ${input.jobId} output`);
    const sha256 = digest.digest('hex');
    const relativeTemp = path.relative(input.boundary.projectRoot, tempPath).split(path.sep).join('/');
    writeRetrievalState(input.boundary, {
      jobId: input.jobId,
      providerTaskId: input.providerTaskId,
      phase: 'validated',
      tempPath: relativeTemp,
      targetPath: input.targetRelativePath.split(path.sep).join('/'),
      sha256,
      bytes: written,
      message: null,
    });
    writeRetrievalState(input.boundary, {
      jobId: input.jobId,
      providerTaskId: input.providerTaskId,
      phase: 'finalizing',
      tempPath: relativeTemp,
      targetPath: input.targetRelativePath.split(path.sep).join('/'),
      sha256,
      bytes: written,
      message: null,
    });
    const finalized = finalizeDownloadedFile({
      boundary: input.boundary,
      jobId: input.jobId,
      providerTaskId: input.providerTaskId,
      tempPath,
      targetRelativePath: input.targetRelativePath,
      expectedSha256: sha256,
      expectedBytes: written,
      overwriteFinalized: input.overwriteFinalized === true,
    });
    writeRetrievalState(input.boundary, {
      jobId: input.jobId,
      providerTaskId: input.providerTaskId,
      phase: 'finalized',
      tempPath: null,
      targetPath: input.targetRelativePath.split(path.sep).join('/'),
      sha256: finalized.sha256,
      bytes: finalized.bytes,
      message: finalized.idempotent ? 'existing finalized output reused' : null,
    });
    return {
      record: {
        schemaVersion: 1,
        policyVersion: RETRIEVAL_POLICY_VERSION,
        jobId: input.jobId,
        providerTaskId: input.providerTaskId,
        kind: input.kind,
        source: redactSource(current),
        redirects,
        contentType,
        bytes: finalized.bytes,
        sha256: finalized.sha256,
        storedPath: input.targetRelativePath.split(path.sep).join('/'),
        elapsedMs: now() - started,
      },
      absolutePath: finalized.absolutePath,
      head: magic,
    };
  } catch (error) {
    if (handle !== null) {
      try {
        closeSync(handle);
      } catch {
        // The handle is already unusable; the cleanup below still runs.
      }
    }
    if (existsSync(tempPath)) {
      try {
        rmSync(tempPath, {force: true});
      } catch {
        // A failed cleanup must not mask the original retrieval error.
      }
    }
    writeRetrievalState(input.boundary, {
      jobId: input.jobId,
      providerTaskId: input.providerTaskId,
      phase: 'failed',
      tempPath: null,
      targetPath: input.targetRelativePath.split(path.sep).join('/'),
      sha256: null,
      bytes: null,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    throw error;
  }
};

/** Cleans up task-owned partial files. Only strict descendants of the cache root. */
export const clearRetrievalScratch = (boundary: WriteBoundary, jobId: string): boolean => {
  const dir = path.resolve(path.join(boundary.cacheRoot, 'retrieval', jobId));
  if (dir === path.resolve(boundary.cacheRoot)) return false;
  if (!isInside(boundary.cacheRoot, dir)) return false;
  if (!existsSync(dir)) return false;
  assertSafePath(boundary, dir, {expect: 'dir', subtree: 'cache'});
  rmSync(dir, {recursive: true, force: true});
  return true;
};

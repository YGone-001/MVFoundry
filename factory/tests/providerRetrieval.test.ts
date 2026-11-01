import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {RetrievalError} from '../src/errors';
import {
  OUTPUT_HOST_POLICIES,
  clearRetrievalScratch,
  isDisallowedAddress,
  redactSource,
  retrieveRemoteOutput,
  validateOutputUrl,
} from '../src/generation/retrieval';
import {createScriptedDownloadTransport, createScriptedResolver} from '../src/generation/simulation';
import {createWriteBoundary} from '../src/workspace/writeBoundary';
import type {DownloadRequest, DownloadResponse, OutputHostPolicy} from '../src/generation/types';
import {REPO_ROOT} from './helpers';

const HOST = 'dnznrvs05pmza.cloudfront.net';
const SCHEME = 'https';
const INSECURE = 'http';
const PUBLIC_IP = '93.184.216.34';

const POLICY: OutputHostPolicy = {
  provider: 'runway',
  hosts: [HOST],
  maxRedirects: 3,
  maxBytes: 4096,
  timeoutMs: 2000,
  contentTypes: ['video/mp4', 'image/png', 'image/jpeg'],
};

const projectRoot = (): string => mkdtempSync(path.join(tmpdir(), 'mv-retrieval-'));
const boundaryFor = (root: string) => createWriteBoundary({projectDir: root, engineRoot: REPO_ROOT});

const mp4Bytes = (): Buffer => {
  const buffer = Buffer.alloc(2048);
  buffer.write('ftyp', 4, 'ascii');
  return buffer;
};

const bodyOf = (bytes: Buffer): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    yield bytes;
  },
});

const respond = (bytes: Buffer, headers: Record<string, string> = {}): DownloadResponse => ({
  status: 200,
  headers: {'content-type': 'video/mp4', 'content-length': String(bytes.length), ...headers},
  body: bodyOf(bytes),
  declaredBytes: bytes.length,
});

const resolveTo = (addresses: string[]) => async () => addresses;

const run = async (
  overrides: Partial<Parameters<typeof retrieveRemoteOutput>[0]> & {
    transport: (request: DownloadRequest) => Promise<DownloadResponse>;
  },
) => {
  const root = projectRoot();
  const boundary = boundaryFor(root);
  return retrieveRemoteOutput({
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    kind: 'video',
    url: `${SCHEME}://${HOST}/output.mp4?_jwt=signed-secret`,
    policy: POLICY,
    resolver: resolveTo([PUBLIC_IP]),
    targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    ...overrides,
  });
};

const expectCode = async (promise: Promise<unknown>, code: string, pattern?: RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof RetrievalError, `expected RetrievalError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
};

test('P1-E-D G07: the trusted output host policy is provider specific and closed', () => {
  assert.deepEqual(OUTPUT_HOST_POLICIES.runway.hosts, [HOST]);
  assert.equal(OUTPUT_HOST_POLICIES.runway.maxRedirects, 3);
  assert.ok(OUTPUT_HOST_POLICIES.runway.contentTypes.includes('video/mp4'));
  assert.deepEqual(OUTPUT_HOST_POLICIES['offline-fixture'].hosts, []);
});

test('P1-E-D G07: URL policy rejects malformed, non-HTTPS, credentialed and off-policy URLs', () => {
  const cases: Array<[string, string]> = [
    ['not a url', 'malformed-url'],
    [`${INSECURE}://dnznrvs05pmza.cloudfront.net/a.mp4`, 'unsupported-protocol'],
    [`${SCHEME}://user:pass@dnznrvs05pmza.cloudfront.net/a.mp4`, 'credentials-in-url'],
    [`${SCHEME}://dnznrvs05pmza.cloudfront.net:8443/a.mp4`, 'unexpected-port'],
    [`${SCHEME}://127.0.0.1/a.mp4`, 'ip-literal-not-allowed'],
    [`${SCHEME}://[::1]/a.mp4`, 'ip-literal-not-allowed'],
    [`${SCHEME}://evil.example.com/a.mp4`, 'host-not-allowed'],
    [`${SCHEME}://${HOST}/${'a'.repeat(2100)}.mp4`, 'malformed-url'],
  ];
  for (const [url, code] of cases) {
    assert.throws(
      () => validateOutputUrl(url, POLICY),
      (error: unknown) => error instanceof RetrievalError && error.code === code,
      `expected ${code} for ${url}`,
    );
  }
});

test('P1-E-D G10: signed query parameters are counted but never recorded', () => {
  const validated = validateOutputUrl(`${SCHEME}://${HOST}/output.mp4?_jwt=super-secret&Expires=1`, POLICY);
  const redacted = redactSource(validated);
  assert.equal(redacted.host, HOST);
  assert.equal(redacted.path, '/output.mp4');
  assert.equal(redacted.queryParameters, 2);
  assert.equal(redacted.signedQueryRedacted, true);
  assert.ok(!JSON.stringify(redacted).includes('super-secret'));
  assert.ok(!JSON.stringify(redacted).includes('_jwt'));
});

test('P1-E-D G08: private, loopback, link-local and reserved addresses are refused', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '203.0.113.9',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ]) {
    assert.equal(isDisallowedAddress(address), true, `${address} must be blocked`);
  }
  for (const address of [PUBLIC_IP, '8.8.8.8', '2606:4700::1111']) {
    assert.equal(isDisallowedAddress(address), false, `${address} must be allowed`);
  }
});

test('P1-E-D G08: a successful download is stored, hashed and redacted', async () => {
  const bytes = mp4Bytes();
  const result = await run({transport: async () => respond(bytes)});
  assert.equal(result.record.bytes, bytes.length);
  assert.equal(result.record.kind, 'video');
  assert.equal(result.record.contentType, 'video/mp4');
  assert.equal(result.record.source.host, HOST);
  assert.equal(result.record.source.queryParameters, 1);
  assert.ok(!JSON.stringify(result.record).includes('signed-secret'));
  assert.ok(existsSync(result.absolutePath));
});

test('P1-E-D G07: 302 and 307 redirects to the allowlisted host are followed', async () => {
  let call = 0;
  const bytes = mp4Bytes();
  const result = await run({
    transport: async () => {
      call += 1;
      if (call === 1) return {status: 302, headers: {location: `${SCHEME}://${HOST}/fresh.mp4`}, body: bodyOf(Buffer.alloc(0))};
      if (call === 2) return {status: 307, headers: {location: `${SCHEME}://${HOST}/final.mp4`}, body: bodyOf(Buffer.alloc(0))};
      return respond(bytes);
    },
  });
  assert.equal(result.record.redirects, 2);
});

test('P1-E-D G07: a redirect without Location or with an off-policy host is refused', async () => {
  await expectCode(
    run({transport: async () => ({status: 302, headers: {}, body: bodyOf(Buffer.alloc(0))})}),
    'redirect-without-location',
  );
  await expectCode(
    run({
      transport: async () => ({
        status: 301,
        headers: {location: `${SCHEME}://attacker.example.com/x.mp4`},
        body: bodyOf(Buffer.alloc(0)),
      }),
    }),
    'host-not-allowed',
  );
});

test('P1-E-D G07: redirect loops are bounded', async () => {
  await expectCode(
    run({
      transport: async () => ({
        status: 308,
        headers: {location: `${SCHEME}://${HOST}/loop.mp4`},
        body: bodyOf(Buffer.alloc(0)),
      }),
    }),
    'too-many-redirects',
  );
});

test('P1-E-D G08: a redirect to loopback or a private address is refused', async () => {
  await expectCode(
    run({
      resolver: async (hostname) => (hostname === HOST ? ['127.0.0.1'] : [PUBLIC_IP]),
      transport: async () => ({
        status: 302,
        headers: {location: `${SCHEME}://${HOST}/internal.mp4`},
        body: bodyOf(Buffer.alloc(0)),
      }),
    }),
    'blocked-address',
  );
  await expectCode(
    run({
      resolver: resolveTo(['10.0.0.7']),
      transport: async () => respond(mp4Bytes()),
    }),
    'blocked-address',
  );
});

test('P1-E-D G08: a resolver that fails or returns nothing is refused', async () => {
  await expectCode(
    run({
      resolver: async () => {
        throw new Error('dns down');
      },
      transport: async () => respond(mp4Bytes()),
    }),
    'dns-failure',
  );
  await expectCode(run({resolver: async () => [], transport: async () => respond(mp4Bytes())}), 'dns-failure');
});

test('P1-E-D G09: oversized declared and undeclared responses are refused', async () => {
  await expectCode(
    run({
      transport: async () => ({
        status: 200,
        headers: {'content-type': 'video/mp4', 'content-length': '999999'},
        body: bodyOf(Buffer.alloc(0)),
      }),
    }),
    'declared-too-large',
  );
  await expectCode(
    run({
      transport: async () => {
        const big = Buffer.alloc(POLICY.maxBytes + 1024);
        big.write('ftyp', 4, 'ascii');
        return {status: 200, headers: {'content-type': 'video/mp4'}, body: bodyOf(big)};
      },
    }),
    'too-large',
  );
});

test('P1-E-D G09: a truncated stream is refused and no partial file survives', async () => {
  const root = projectRoot();
  const boundary = boundaryFor(root);
  const bytes = mp4Bytes();
  await expectCode(
    retrieveRemoteOutput({
      boundary,
      jobId: 'GEN-1',
      providerTaskId: 'task-1',
      kind: 'video',
      url: `${SCHEME}://${HOST}/output.mp4`,
      policy: POLICY,
      resolver: resolveTo([PUBLIC_IP]),
      targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
      transport: async () => ({
        status: 200,
        headers: {'content-type': 'video/mp4', 'content-length': String(bytes.length)},
        body: bodyOf(bytes.subarray(0, 100)),
        declaredBytes: bytes.length,
      }),
    }),
    'truncated',
  );
  assert.equal(existsSync(path.join(root, 'generation', 'outputs', 'GEN-1', 'GEN-1-provider.mp4')), false);
  const scratch = path.join(boundary.cacheRoot, 'retrieval', 'GEN-1');
  if (existsSync(scratch)) assert.deepEqual(readdirSync(scratch), []);
});

test('P1-E-D G07: wrong content types and disguised HTML are refused', async () => {
  await expectCode(
    run({
      transport: async () => ({status: 200, headers: {'content-type': 'text/html'}, body: bodyOf(Buffer.from('<html></html>'))}),
    }),
    'content-type-not-allowed',
  );
  await expectCode(
    run({
      transport: async () => ({
        status: 200,
        headers: {'content-type': 'video/mp4'},
        body: bodyOf(Buffer.from('<html><body>not a video</body></html>')),
      }),
    }),
    'magic-byte-mismatch',
  );
  await expectCode(
    run({transport: async () => respond(mp4Bytes(), {'content-type': 'image/png'})}),
    'content-type-not-allowed',
  );
});

test('P1-E-D G07: an image job cannot accept a video response', async () => {
  await expectCode(
    run({kind: 'image', transport: async () => respond(mp4Bytes())}),
    'content-type-not-allowed',
    /expects image/,
  );
});

test('P1-E-D G11: an expired signed URL is recoverable, other HTTP failures are not', async () => {
  await assert.rejects(
    run({transport: async () => ({status: 403, headers: {}, body: bodyOf(Buffer.alloc(0))})}),
    (error: unknown) => {
      assert.ok(error instanceof RetrievalError);
      assert.equal(error.code, 'url-expired');
      assert.equal(error.recoverable, true);
      return true;
    },
  );
  await assert.rejects(
    run({transport: async () => ({status: 500, headers: {}, body: bodyOf(Buffer.alloc(0))})}),
    (error: unknown) => {
      assert.ok(error instanceof RetrievalError);
      assert.equal(error.code, 'http-error');
      assert.equal(error.recoverable, false);
      return true;
    },
  );
});

test('P1-E-D G09: a stalled transport hits the request timeout', async () => {
  await expectCode(
    run({
      policy: {...POLICY, timeoutMs: 20},
      transport: async (request) =>
        new Promise<DownloadResponse>((resolve, reject) => {
          const timer = setTimeout(() => resolve(respond(mp4Bytes())), 5000);
          request.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    }),
    'timeout',
  );
});

test('P1-E-D G07: an empty body is refused', async () => {
  await expectCode(
    run({
      transport: async () => ({
        status: 200,
        headers: {'content-type': 'video/mp4', 'content-length': '0'},
        body: bodyOf(Buffer.alloc(0)),
      }),
    }),
    'empty-body',
  );
});

test('P1-E-D G12: a repeated download is idempotent and leaves no scratch files', async () => {
  const root = projectRoot();
  const boundary = boundaryFor(root);
  const bytes = mp4Bytes();
  const options = {
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    kind: 'video' as const,
    url: `${SCHEME}://${HOST}/output.mp4`,
    policy: POLICY,
    resolver: resolveTo([PUBLIC_IP]),
    targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
  };
  const first = await retrieveRemoteOutput({...options, transport: async () => respond(bytes)});
  const second = await retrieveRemoteOutput({...options, transport: async () => respond(bytes)});
  assert.equal(first.record.sha256, second.record.sha256);
  assert.deepEqual(readdirSync(path.join(boundary.cacheRoot, 'retrieval', 'GEN-1')), []);
  assert.equal(clearRetrievalScratch(boundary, 'GEN-1'), true);
});

test('P1-E-D G24: a cross-project destination is refused', async () => {
  await assert.rejects(
    run({targetRelativePath: '../other-project/x.mp4', transport: async () => respond(mp4Bytes())}),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /outside the authorized project|escapes|forbidden/i);
      return true;
    },
  );
});

test('P1-E-D G24: a linked destination is refused', async (t) => {
  const root = projectRoot();
  const boundary = boundaryFor(root);
  const outside = mkdtempSync(path.join(tmpdir(), 'mv-retrieval-outside-'));
  mkdirSync(path.join(root, 'generation', 'outputs'), {recursive: true});
  try {
    symlinkSync(outside, path.join(root, 'generation', 'outputs', 'GEN-1'), 'junction');
  } catch {
    t.skip('junction creation is unavailable on this host');
    return;
  }
  await assert.rejects(
    retrieveRemoteOutput({
      boundary,
      jobId: 'GEN-1',
      providerTaskId: 'task-1',
      kind: 'video',
      url: `${SCHEME}://${HOST}/output.mp4`,
      policy: POLICY,
      resolver: resolveTo([PUBLIC_IP]),
      targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
      transport: async () => respond(mp4Bytes()),
    }),
    /link|junction/i,
  );
  assert.deepEqual(readdirSync(outside), []);
});

test('P1-E-D G11: the scripted transport replays redirects and media without a network', async () => {
  const script = {
    steps: [
      {kind: 'redirect' as const, status: 302 as const, location: `${SCHEME}://${HOST}/fresh.mp4`},
      {kind: 'media' as const, file: 'fixture.mp4', contentType: 'video/mp4'},
    ],
    resolver: {[HOST]: [PUBLIC_IP]},
  };
  const scripted = createScriptedDownloadTransport(script, () => mp4Bytes());
  const result = await run({
    transport: scripted.transport,
    resolver: createScriptedResolver(script),
  });
  assert.equal(result.record.redirects, 1);
  assert.equal(scripted.consumed(), 2);
});

test('P1-E-D G09: the scripted transport models truncation deterministically', async () => {
  const script = {
    steps: [{kind: 'media' as const, file: 'fixture.mp4', contentType: 'video/mp4', truncateAt: 64}],
  };
  const scripted = createScriptedDownloadTransport(script, () => mp4Bytes());
  await expectCode(run({transport: scripted.transport, resolver: createScriptedResolver(script)}), 'truncated');
});

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import type {AddressInfo} from 'node:net';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RUNWAY_ENDPOINT_POLICY,
  TransportError,
  buildConnectionPlan,
  createBoundLookup,
  createLiveHttpsTransport,
  type LiveTransportOptions,
  type ProviderEndpointPolicy,
} from '../src/generation/transport';
import {isDisallowedAddress} from '../src/generation/retrieval';
import {decideRetry, computeBackoffMs, parseRetryAfterMs, RETRY_POLICY} from '../src/generation/retry';

const SCHEME = 'https';
const INSECURE = 'http';
const PROXY_URL = `${INSECURE}://${['proxy', 'internal'].join('.')}:8080`;
const API_HOST = 'api.simulated.invalid';
const DELIVERY_HOST = 'dnznrvs05pmza.cloudfront.net';
const LOOPBACK = '127.0.0.1';

const TEST_POLICY: ProviderEndpointPolicy = {
  provider: 'runway',
  apiHost: API_HOST,
  deliveryHosts: [DELIVERY_HOST],
};

/** Loopback is only reachable because the test injects a loopback-aware classifier. */
const loopbackClassifier = (address: string) =>
  address === LOOPBACK || address === '::1' ? 'allowed' : isDisallowedAddress(address) ? 'blocked-address' : 'allowed';

const publicClassifier = (address: string) => (isDisallowedAddress(address) ? 'blocked-address' : 'allowed');

type Certs = {
  dir: string;
  caPem: string;
  serverKey: string;
  serverCert: string;
  wrongHostKey: string;
  wrongHostCert: string;
};

let cachedCerts: Certs | null = null;

const hasOpenssl = (): boolean => {
  try {
    execFileSync('openssl', ['version'], {stdio: 'pipe', windowsHide: true});
    return true;
  } catch {
    return false;
  }
};

const makeCerts = (): Certs => {
  if (cachedCerts) return cachedCerts;
  const dir = mkdtempSync(path.join(tmpdir(), 'mv-tls-'));
  const run = (args: string[]): void => {
    execFileSync('openssl', args, {cwd: dir, stdio: 'pipe', windowsHide: true});
  };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=MVFoundry Test CA']);
  const leaf = (name: string, san: string): void => {
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${san}`]);
    writeFileSync(path.join(dir, `${name}.cnf`), `subjectAltName=DNS:${san}\n`);
    run([
      'x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.cnf`,
    ]);
  };
  leaf('server', API_HOST);
  leaf('wrong', 'other.simulated.invalid');
  cachedCerts = {
    dir,
    caPem: readFileSync(path.join(dir, 'ca.pem'), 'utf8'),
    serverKey: readFileSync(path.join(dir, 'server.key'), 'utf8'),
    serverCert: readFileSync(path.join(dir, 'server.pem'), 'utf8'),
    wrongHostKey: readFileSync(path.join(dir, 'wrong.key'), 'utf8'),
    wrongHostCert: readFileSync(path.join(dir, 'wrong.pem'), 'utf8'),
  };
  return cachedCerts;
};

type RunningServer = {
  port: number;
  close: () => Promise<void>;
};

const startServer = async (
  certs: Certs,
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
  useWrongHost = false,
): Promise<RunningServer> => {
  const server = createHttpsServer(
    {key: useWrongHost ? certs.wrongHostKey : certs.serverKey, cert: useWrongHost ? certs.wrongHostCert : certs.serverCert},
    handler,
  );
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const transportFor = (overrides: Partial<LiveTransportOptions> = {}) =>
  createLiveHttpsTransport({
    policy: TEST_POLICY,
    resolver: async () => [LOOPBACK],
    classifyAddress: loopbackClassifier,
    liveExecutionEnabled: true,
    environment: {},
    connectTimeoutMs: 4_000,
    responseTimeoutMs: 4_000,
    ...overrides,
  });

const expectTransportError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<TransportError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof TransportError, `expected TransportError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new assert.AssertionError({message: `expected a TransportError with code ${code}`});
};

test('G03: the live transport is inert until explicitly enabled', async () => {
  const transport = createLiveHttpsTransport({
    policy: TEST_POLICY,
    resolver: async () => [LOOPBACK],
    classifyAddress: loopbackClassifier,
    environment: {},
  });
  await expectTransportError(
    transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
    'live-not-authorized',
  );
});

test('G04: the connection plan binds the validated address and keeps the DNS name for TLS', async () => {
  const plan = await buildConnectionPlan({
    url: `${SCHEME}://${API_HOST}/v1/text_to_image`,
    policy: TEST_POLICY,
    resolver: async () => ['93.184.216.34'],
    classifyAddress: publicClassifier,
  });
  assert.equal(plan.address, '93.184.216.34');
  assert.equal(plan.family, 4);
  assert.equal(plan.servername, API_HOST, 'SNI and certificate verification must use the DNS name');

  const lookup = createBoundLookup(plan);
  const single = await new Promise<unknown>((resolve) => {
    lookup('ignored.example', {}, (error: unknown, address: unknown, family: unknown) => resolve({error, address, family}));
  });
  assert.deepEqual(single, {error: null, address: '93.184.216.34', family: 4});
  const all = await new Promise<unknown>((resolve) => {
    lookup('ignored.example', {all: true}, (error: unknown, entries: unknown) => resolve({error, entries}));
  });
  assert.deepEqual(all, {error: null, entries: [{address: '93.184.216.34', family: 4}]});
});

test('G04: a host outside the provider policy is refused before any resolution', async () => {
  let resolved = false;
  await expectTransportError(
    buildConnectionPlan({
      url: `${SCHEME}://attacker.example.com/v1/text_to_image`,
      policy: TEST_POLICY,
      resolver: async () => {
        resolved = true;
        return ['93.184.216.34'];
      },
      classifyAddress: publicClassifier,
    }),
    'host-not-allowed',
  );
  assert.equal(resolved, false);
});

test('G04: a rebind to a private address is refused, and the first request still used the approved one', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (_req, res) => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end('{"ok":true}');
  });
  try {
    let answer = LOOPBACK;
    const transport = transportFor({
      resolver: async () => [answer],
      trustedCa: [certs.caPem],
    });
    const url = `${SCHEME}://${API_HOST}:443/v1/tasks/t1`;
    // The transport always dials the resolved address; the test server listens on
    // a random port, so the port is overridden through a dedicated policy below.
    const portPolicy: ProviderEndpointPolicy = {...TEST_POLICY};
    const withPort = createLiveHttpsTransport({
      policy: portPolicy,
      resolver: async () => [answer],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    const response = await withPort({method: 'GET', url, headers: {}, body: null, authorizationHosts: [API_HOST]});
    assert.equal(response.status, 200);
    assert.equal(response.tlsServername, API_HOST);

    answer = '10.0.0.7';
    await expectTransportError(
      withPort({method: 'GET', url, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'blocked-address',
    );
    await expectTransportError(
      transport({method: 'GET', url, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'blocked-address',
    );
  } finally {
    await server.close();
  }
});

test('G04: a mixed public/private DNS answer is refused entirely', async () => {
  await expectTransportError(
    buildConnectionPlan({
      url: `${SCHEME}://${API_HOST}/v1/tasks/x`,
      policy: TEST_POLICY,
      resolver: async () => ['93.184.216.34', '127.0.0.1'],
      classifyAddress: publicClassifier,
    }),
    'blocked-address',
  );
});

test('G04: DNS failure and empty answers are classified, not ignored', async () => {
  await expectTransportError(
    buildConnectionPlan({
      url: `${SCHEME}://${API_HOST}/v1/tasks/x`,
      policy: TEST_POLICY,
      resolver: async () => {
        throw new Error('dns down');
      },
      classifyAddress: publicClassifier,
    }),
    'dns-failure',
  );
  await expectTransportError(
    buildConnectionPlan({
      url: `${SCHEME}://${API_HOST}/v1/tasks/x`,
      policy: TEST_POLICY,
      resolver: async () => [],
      classifyAddress: publicClassifier,
    }),
    'dns-failure',
  );
});

test('G05: a valid certificate completes a real TLS handshake against a local server', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (req, res) => {
    res.writeHead(200, {'content-type': 'application/json', 'x-method': req.method ?? ''});
    res.end(JSON.stringify({received: req.headers.authorization ?? null}));
  });
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    const response = await transport({
      method: 'POST',
      url: `${SCHEME}://${API_HOST}/v1/text_to_image`,
      headers: {authorization: 'Bearer test-token', 'content-type': 'application/json'},
      body: '{"model":"gen4_image"}',
      authorizationHosts: [API_HOST],
    });
    assert.equal(response.status, 200);
    assert.equal(response.tlsServername, API_HOST);
    assert.equal(JSON.parse(response.body).received, 'Bearer test-token');
  } finally {
    await server.close();
  }
});

test('G05: a certificate for another hostname is rejected', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (_req, res) => res.end('{}'), true);
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    await expectTransportError(
      transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'certificate-hostname-mismatch',
    );
  } finally {
    await server.close();
  }
});

test('G05: an untrusted certificate chain is rejected', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (_req, res) => res.end('{}'));
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    await expectTransportError(
      transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'tls-verification-failed',
    );
  } finally {
    await server.close();
  }
});

test('G06: the authorization header is refused for a delivery host', async () => {
  const transport = transportFor();
  await expectTransportError(
    transport({
      method: 'GET',
      url: `${SCHEME}://${DELIVERY_HOST}/output.mp4`,
      headers: {authorization: 'Bearer leaked'},
      body: null,
      authorizationHosts: [API_HOST],
    }),
    'authorization-header-refused',
  );
});

test('G06: a configured environment proxy is refused', async () => {
  const transport = transportFor({environment: {HTTPS_PROXY: PROXY_URL}});
  await expectTransportError(
    transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
    'proxy-not-supported',
  );
  const lowercase = transportFor({environment: {https_proxy: PROXY_URL}});
  await expectTransportError(
    lowercase({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
    'proxy-not-supported',
  );
});

test('G05: the transport never follows a redirect', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (_req, res) => {
    res.writeHead(302, {location: `${SCHEME}://${DELIVERY_HOST}/elsewhere`});
    res.end();
  });
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    await expectTransportError(
      transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'redirect-not-followed',
    );
  } finally {
    await server.close();
  }
});

test('G18: HTTP status classes map to the documented retry policy', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const statuses = [401, 429, 503];
  for (const status of statuses) {
    const server = await startServer(certs, (_req, res) => {
      res.writeHead(status, {'retry-after': '2'});
      res.end('{}');
    });
    try {
      const transport = createLiveHttpsTransport({
        policy: TEST_POLICY,
        resolver: async () => [LOOPBACK],
        classifyAddress: loopbackClassifier,
        liveExecutionEnabled: true,
        environment: {},
        trustedCa: [certs.caPem],
        request: ((options: Record<string, unknown>, callback: never) => {
          const impl = require('node:https').request;
          return impl({...options, port: server.port}, callback);
        }) as never,
      });
      const error = await expectTransportError(
        transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
        status === 401 ? 'authentication-failed' : status === 429 ? 'rate-limited' : 'provider-unavailable',
      );
      assert.equal(error.retryable, status !== 401);
      assert.equal(error.status, status);
    } finally {
      await server.close();
    }
  }
});

test('G09: an oversized response is refused while streaming', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, (_req, res) => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end('x'.repeat(4096));
  });
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      maxResponseBytes: 256,
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    await expectTransportError(
      transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'response-too-large',
    );
  } finally {
    await server.close();
  }
});

test('G09: a server that never responds hits the response timeout', async (t) => {
  if (!hasOpenssl()) {
    t.skip('openssl is unavailable on this host');
    return;
  }
  const certs = makeCerts();
  const server = await startServer(certs, () => {
    // Deliberately never responds.
  });
  try {
    const transport = createLiveHttpsTransport({
      policy: TEST_POLICY,
      resolver: async () => [LOOPBACK],
      classifyAddress: loopbackClassifier,
      liveExecutionEnabled: true,
      environment: {},
      connectTimeoutMs: 300,
      responseTimeoutMs: 300,
      trustedCa: [certs.caPem],
      request: ((options: Record<string, unknown>, callback: never) => {
        const impl = require('node:https').request;
        return impl({...options, port: server.port}, callback);
      }) as never,
    });
    const error = await expectTransportError(
      transport({method: 'GET', url: `${SCHEME}://${API_HOST}/v1/tasks/x`, headers: {}, body: null, authorizationHosts: [API_HOST]}),
      'response-timeout',
    );
    assert.equal(error.retryable, true);
  } finally {
    await server.close();
  }
});

test('G03: the default production policy names the documented hosts only', () => {
  assert.equal(RUNWAY_ENDPOINT_POLICY.apiHost, 'api.dev.runwayml.com');
  assert.deepEqual(RUNWAY_ENDPOINT_POLICY.deliveryHosts, ['dnznrvs05pmza.cloudfront.net']);
});

test('G18: backoff is bounded, jittered and never retries a billable submission', () => {
  const first = computeBackoffMs(1, RETRY_POLICY, () => 0);
  const third = computeBackoffMs(3, RETRY_POLICY, () => 0);
  assert.equal(first, RETRY_POLICY.baseDelayMs);
  assert.ok(third > first);
  assert.ok(computeBackoffMs(30, RETRY_POLICY, () => 1) <= RETRY_POLICY.maxDelayMs * (1 + RETRY_POLICY.jitterRatio));

  const submission = decideRetry({kind: 'submission', attempt: 1, error: {code: 'rate-limited', retryable: true}});
  assert.equal(submission.retry, false);
  assert.match(submission.reason, /never retried/);

  const status = decideRetry({kind: 'status', attempt: 1, error: {code: 'rate-limited', retryable: true}, random: () => 0});
  assert.equal(status.retry, true);

  const auth = decideRetry({kind: 'status', attempt: 1, error: {code: 'authentication-failed'}});
  assert.equal(auth.retry, false);

  const exhausted = decideRetry({kind: 'status', attempt: RETRY_POLICY.maxAttempts, error: {code: 'rate-limited', retryable: true}});
  assert.equal(exhausted.retry, false);
  assert.match(exhausted.reason, /budget exhausted/);
});

test('G18: Retry-After is honored in seconds and as a date', () => {
  const now = new Date('2026-11-01T00:00:00.000Z');
  assert.equal(parseRetryAfterMs('2', now), 2000);
  assert.equal(parseRetryAfterMs('Sun, 01 Nov 2026 00:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfterMs('not-a-date', now), null);
  assert.equal(parseRetryAfterMs(undefined, now), null);
});

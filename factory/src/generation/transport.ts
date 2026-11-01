import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import type {IncomingMessage} from 'node:http';
import {FactoryError} from '../errors';
import type {
  DestinationClassifier,
  GenerationProviderId,
  HostResolver,
  TransportErrorCode,
  TransportRequest,
  TransportResponse,
} from './types';
import {TRANSPORT_POLICY_VERSION} from './types';

export class TransportError extends FactoryError {
  readonly code: TransportErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    code: TransportErrorCode,
    message: string,
    options: {retryable?: boolean; status?: number | null} = {},
  ) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

/**
 * Provider endpoint policy. The API host and the signed-output delivery hosts
 * are different trust domains: only the API host may ever receive credentials.
 */
export type ProviderEndpointPolicy = {
  provider: GenerationProviderId;
  apiHost: string;
  deliveryHosts: string[];
};

export const RUNWAY_ENDPOINT_POLICY: ProviderEndpointPolicy = {
  provider: 'runway',
  apiHost: 'api.dev.runwayml.com',
  deliveryHosts: ['dnznrvs05pmza.cloudfront.net'],
};

export type HttpsRequestLike = typeof httpsRequest;

export type LiveTransportOptions = {
  policy: ProviderEndpointPolicy;
  resolver: HostResolver;
  classifyAddress: DestinationClassifier;
  /** Must be explicitly true; the default refuses every request. */
  liveExecutionEnabled?: boolean;
  maxResponseBytes?: number;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Extra trust anchors. Production wiring passes none and uses the system store. */
  trustedCa?: string[] | null;
  /** Injection point for controlled tests. Defaults to `node:https`. */
  request?: HttpsRequestLike;
  /** Environment snapshot used for the proxy policy. Defaults to `process.env`. */
  environment?: Record<string, string | undefined>;
  now?: () => number;
};

export type ConnectionPlan = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
  servername: string;
};

const PROXY_VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 60_000;

const fail = (
  code: TransportErrorCode,
  message: string,
  options: {retryable?: boolean; status?: number | null} = {},
): never => {
  throw new TransportError(code, message, options);
};

const hostAllowed = (policy: ProviderEndpointPolicy, hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (host === policy.apiHost.toLowerCase()) return true;
  return policy.deliveryHosts.some((entry) => entry.toLowerCase() === host);
};

/**
 * Builds the connection plan. The address returned here is the *only* address
 * the socket is allowed to reach; the DNS name is kept for SNI and certificate
 * verification so a rebind cannot silently substitute a different destination.
 */
export const buildConnectionPlan = async (input: {
  url: string;
  policy: ProviderEndpointPolicy;
  resolver: HostResolver;
  classifyAddress: DestinationClassifier;
}): Promise<ConnectionPlan> => {
  if (typeof input.url !== 'string' || input.url.trim() === '') {
    fail('malformed-url', 'Transport URL is empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    fail('malformed-url', 'Transport URL is not a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    fail('unsupported-protocol', `Transport scheme ${parsed.protocol} is not permitted; HTTPS is required`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('credentials-in-url', 'Transport URL embeds credentials and is refused');
  }
  if (parsed.port !== '' && parsed.port !== '443') {
    fail('unsupported-protocol', `Transport port ${parsed.port} is not permitted`);
  }
  if (!hostAllowed(input.policy, parsed.hostname)) {
    fail('host-not-allowed', `Host ${parsed.hostname} is not a ${input.policy.provider} endpoint`);
  }
  let addresses: string[];
  try {
    addresses = await input.resolver(parsed.hostname);
  } catch {
    fail('dns-failure', `Unable to resolve ${parsed.hostname}`, {retryable: true});
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    fail('dns-failure', `${parsed.hostname} resolved to no address`, {retryable: true});
  }
  // Every answer is screened. A resolver returning a mixed set is refused rather
  // than narrowed to whichever entry happens to look public.
  for (const address of addresses) {
    if (input.classifyAddress(address) !== 'allowed') {
      fail('blocked-address', `${parsed.hostname} resolves to a disallowed address`);
    }
    if (isIP(address) === 0) {
      fail('dns-failure', `${parsed.hostname} resolved to a value that is not an IP address`);
    }
  }
  const address = addresses[0];
  const family = isIP(address) === 6 ? 6 : 4;
  return {
    url: parsed,
    hostname: parsed.hostname,
    address,
    family,
    // SNI and certificate verification always use the DNS name, never the IP.
    servername: parsed.hostname,
  };
};

/**
 * A `lookup` implementation that ignores the hostname it is given and always
 * returns the pre-validated address. This is what binds the socket to the
 * approved destination instead of letting the TLS stack resolve again.
 */
export const createBoundLookup = (
  plan: ConnectionPlan,
): ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void) => (
  _hostname,
  options,
  callback,
) => {
  const wantsAll = Boolean(options && typeof options === 'object' && (options as {all?: boolean}).all);
  if (wantsAll) {
    callback(null, [{address: plan.address, family: plan.family}]);
    return;
  }
  callback(null, plan.address, plan.family);
};

const assertNoProxy = (environment: Record<string, string | undefined>): void => {
  for (const name of PROXY_VARIABLES) {
    const value = environment[name];
    if (typeof value === 'string' && value.trim() !== '') {
      fail(
        'proxy-not-supported',
        `environment proxy ${name} is configured; a proxy resolves the destination itself, so the validated-address binding cannot be guaranteed`,
      );
    }
  }
};

const classifyStatus = (status: number): void => {
  if (status >= 200 && status < 300) return;
  if (status >= 300 && status < 400) {
    fail('redirect-not-followed', `Transport does not follow redirects (HTTP ${status})`, {status});
  }
  if (status === 401 || status === 403) {
    fail('authentication-failed', `Provider rejected the credential (HTTP ${status})`, {status});
  }
  if (status === 429) {
    fail('rate-limited', 'Provider rate limit reached (HTTP 429)', {retryable: true, status});
  }
  if (status === 502 || status === 503 || status === 504) {
    fail('provider-unavailable', `Provider is shedding load (HTTP ${status})`, {retryable: true, status});
  }
  fail('request-failed', `Provider request failed with HTTP ${status}`, {status});
};

const toTransportError = (error: NodeJS.ErrnoException): TransportError => {
  const code = String(error.code ?? '');
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EPIPE') {
    return new TransportError('connect-timeout', `Transport connection failed (${code})`, {retryable: true});
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new TransportError('dns-failure', `Transport name resolution failed (${code})`, {retryable: true});
  }
  if (code.startsWith('ERR_TLS_CERT_ALTNAME')) {
    return new TransportError(
      'certificate-hostname-mismatch',
      `TLS certificate does not match the requested host (${code})`,
    );
  }
  if (
    code.startsWith('ERR_TLS') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN'
  ) {
    return new TransportError('tls-verification-failed', `TLS verification failed (${code})`);
  }
  return new TransportError('request-failed', `Transport failed (${code || error.message})`);
};

const headersToObject = (headers: IncomingMessage['headers']): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return result;
};

/**
 * Live HTTPS transport with DNS-to-connection binding.
 *
 * The transport is inert unless `liveExecutionEnabled` is explicitly true, and
 * even then it only reaches hosts named in the endpoint policy. It never
 * follows redirects, never accepts a proxy, never sends the authorization
 * header to a delivery host and never relaxes TLS verification.
 */
export const createLiveHttpsTransport = (
  options: LiveTransportOptions,
): ((request: TransportRequest) => Promise<TransportResponse>) => {
  const environment = options.environment ?? process.env;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const requestImpl = options.request ?? httpsRequest;

  return async (request: TransportRequest): Promise<TransportResponse> => {
    if (options.liveExecutionEnabled !== true) {
      fail('live-not-authorized', 'live provider execution is not authorized in this phase');
    }
    assertNoProxy(environment);

    const plan = await buildConnectionPlan({
      url: request.url,
      policy: options.policy,
      resolver: options.resolver,
      classifyAddress: options.classifyAddress,
    });

    const headers: Record<string, string> = {...request.headers};
    const hasAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
    if (hasAuthorization) {
      const allowed = request.authorizationHosts.map((entry) => entry.toLowerCase());
      if (!allowed.includes(plan.hostname.toLowerCase())) {
        fail(
          'authorization-header-refused',
          `the authorization header is only permitted for ${allowed.join(', ') || 'no host'}, not ${plan.hostname}`,
        );
      }
    }

    const lookup = createBoundLookup(plan);
    const body = request.body;

    return new Promise<TransportResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | null = null;
      let responseTimer: NodeJS.Timeout | null = null;
      const clearTimers = (): void => {
        if (connectTimer) clearTimeout(connectTimer);
        if (responseTimer) clearTimeout(responseTimer);
        connectTimer = null;
        responseTimer = null;
      };
      const finish = (error: Error | null, value?: TransportResponse): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (error) reject(error);
        else resolve(value as TransportResponse);
      };

      const req = requestImpl(
        {
          protocol: 'https:',
          host: plan.hostname,
          hostname: plan.hostname,
          servername: plan.servername,
          port: 443,
          path: `${plan.url.pathname}${plan.url.search}`,
          method: request.method,
          headers,
          lookup: lookup as never,
          // Never relaxed. A certificate failure must abort the request.
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          // A fresh connection per request: no reuse across validated addresses.
          agent: false,
          ...(options.trustedCa && options.trustedCa.length > 0 ? {ca: options.trustedCa} : {}),
        },
        (response: IncomingMessage) => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          const status = response.statusCode ?? 0;
          if (responseTimer === null) {
            responseTimer = setTimeout(() => {
              response.destroy();
              finish(new TransportError('response-timeout', 'transport response timed out', {retryable: true}));
            }, responseTimeoutMs);
          }
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxResponseBytes) {
              response.destroy();
              finish(
                new TransportError(
                  'response-too-large',
                  `response exceeded the ${maxResponseBytes} byte limit`,
                  {status},
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', (error) => finish(toTransportError(error as NodeJS.ErrnoException)));
          response.on('end', () => {
            try {
              classifyStatus(status);
            } catch (error) {
              finish(error as Error);
              return;
            }
            const socket = response.socket;
            finish(null, {
              status,
              headers: headersToObject(response.headers),
              body: Buffer.concat(chunks).toString('utf8'),
              connectedAddress: socket && socket.remoteAddress ? socket.remoteAddress : null,
              tlsServername: plan.servername,
            });
          });
        },
      );

      connectTimer = setTimeout(() => {
        req.destroy();
        finish(new TransportError('connect-timeout', 'transport connection timed out', {retryable: true}));
      }, connectTimeoutMs);
      // The connect deadline covers TCP plus the TLS handshake. Once the socket
      // is secure, the response deadline takes over so a server that accepts and
      // then stalls is reported as a response timeout, not a connect timeout.
      req.on('socket', (socket) => {
        socket.once('secureConnect', () => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          if (!settled && responseTimer === null) {
            responseTimer = setTimeout(() => {
              req.destroy();
              finish(new TransportError('response-timeout', 'transport response timed out', {retryable: true}));
            }, responseTimeoutMs);
          }
        });
      });
      req.on('error', (error) => finish(toTransportError(error as NodeJS.ErrnoException)));
      if (typeof body === 'string') req.write(body);
      req.end();
    });
  };
};

/**
 * The transport shape the provider adapter already accepts, plus a hard refusal
 * gate. This is what the CLI wires when live execution is unavailable.
 */
export const createDisabledLiveTransport = (): (() => Promise<never>) => async () => {
  throw new TransportError(
    'live-not-authorized',
    `LIVE_PROVIDER_EXECUTION = NOT_GRANTED; ${TRANSPORT_POLICY_VERSION} transport refuses to run`,
  );
};

import type {DownloadRequest, DownloadResponse} from './types';

/**
 * Deterministic offline download scripting. Every acceptance path in this phase
 * runs through these helpers, so no test needs a network or a public host.
 */
export type SimulatedDownloadStep =
  | {
      kind: 'media';
      contentType?: string;
      file: string;
      status?: number;
      headers?: Record<string, string>;
      /** Stop the stream early to model a truncated response. */
      truncateAt?: number;
    }
  | {kind: 'redirect'; status: 301 | 302 | 303 | 307 | 308; location: string}
  | {kind: 'status'; status: number; headers?: Record<string, string>; body?: string}
  | {kind: 'timeout'};

export type SimulatedDownloadScript = {
  note?: string;
  steps: SimulatedDownloadStep[];
  /** Hostname to address map. Missing hosts resolve to a public documentation address. */
  resolver?: Record<string, string[]>;
};

export type ScriptedDownloadTransport = {
  transport: (request: DownloadRequest) => Promise<DownloadResponse>;
  consumed: () => number;
  requestedUrls: string[];
};

const PUBLIC_STUB_ADDRESS = '93.184.216.34';

const emptyBody = (): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    // Intentionally yields nothing: an empty body must fail closed upstream.
  },
});

const bufferBody = (bytes: Buffer, truncateAt?: number): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    const limit = typeof truncateAt === 'number' ? Math.max(0, Math.min(truncateAt, bytes.length)) : bytes.length;
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < limit; offset += chunkSize) {
      yield bytes.subarray(offset, Math.min(offset + chunkSize, limit));
    }
  },
});

export const createScriptedDownloadTransport = (
  script: SimulatedDownloadScript,
  readProjectFile: (relativePath: string) => Buffer,
): ScriptedDownloadTransport => {
  let cursor = 0;
  const requestedUrls: string[] = [];
  const transport = async (request: DownloadRequest): Promise<DownloadResponse> => {
    requestedUrls.push(request.url);
    const step = script.steps[cursor];
    cursor += 1;
    if (!step) {
      throw new Error('simulated download transport exhausted its scripted steps');
    }
    if (step.kind === 'timeout') {
      throw new Error('simulated download timeout');
    }
    if (step.kind === 'redirect') {
      return {
        status: step.status,
        headers: {location: step.location},
        body: emptyBody(),
      };
    }
    if (step.kind === 'status') {
      const body = Buffer.from(step.body ?? '', 'utf8');
      return {
        status: step.status,
        headers: step.headers ?? {},
        body: bufferBody(body),
        declaredBytes: body.length,
      };
    }
    const bytes = readProjectFile(step.file);
    const headers: Record<string, string> = {
      'content-type': step.contentType ?? 'video/mp4',
      'content-length': String(bytes.length),
      ...(step.headers ?? {}),
    };
    // A truncated response declares the full size but delivers fewer bytes.
    return {
      status: step.status ?? 200,
      headers,
      body: bufferBody(bytes, step.truncateAt),
      declaredBytes: bytes.length,
    };
  };
  return {
    transport,
    consumed: () => cursor,
    requestedUrls,
  };
};

export const createScriptedResolver = (
  script: SimulatedDownloadScript,
): ((hostname: string) => Promise<string[]>) => async (hostname) => {
  const mapped = script.resolver?.[hostname.toLowerCase()] ?? script.resolver?.[hostname];
  return mapped ?? [PUBLIC_STUB_ADDRESS];
};

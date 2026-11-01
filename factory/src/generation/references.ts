import {lstatSync, readFileSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import type {LoadedProject} from '../config/types';
import {PreproductionError} from '../errors';
import {sha256File} from '../media/hash';
import {isInside, resolveProjectRelativePath} from '../workspace/guard';
import type {GenerationProviderId, PreparedReference, ReferenceDisclosureState} from './types';

/**
 * Documented Runway reference-image envelope (see docs/generation.md §13):
 * a Data URI is capped at 5 MB encoded, which is about 3.3 MB of raw bytes,
 * images below 640x640 or above 4K are discouraged, and Gen-4 prompt images
 * must fall inside a 0.5 - 2.358 aspect window.
 */
export const REFERENCE_LIMITS = {
  maxBytes: 3_300_000,
  maxEncodedCharacters: 5 * 1024 * 1024,
  minWidth: 16,
  maxWidth: 4096,
  minHeight: 16,
  maxHeight: 4096,
  minAspectRatio: 0.5,
  maxAspectRatio: 2.358,
} as const;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type ImageFacts = {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
};

const fail = (message: string): never => {
  throw new PreproductionError(message);
};

/** Rejects symlinks, Windows junctions and any component that escapes the project. */
const assertUnlinkedChain = (projectDir: string, absolute: string, label: string): void => {
  const relative = path.relative(projectDir, absolute);
  if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    fail(`${label} is outside the project`);
  }
  let current = projectDir;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      fail(`${label} does not exist`);
    }
    if (stat.isSymbolicLink()) fail(`${label} resolves through a link or junction`);
    const real = realpathSync(current);
    if (!isInside(projectDir, real)) fail(`${label} escapes the project through a link`);
    const normalizedReal = process.platform === 'win32' ? real.toLowerCase() : real;
    const normalizedExpected = process.platform === 'win32' ? current.toLowerCase() : current;
    if (normalizedReal !== normalizedExpected) {
      fail(`${label} resolves to a different location than its declared path`);
    }
  }
};

const readPngFacts = (bytes: Buffer, label: string): ImageFacts => {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(`${label} does not start with a PNG signature`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') fail(`${label} is missing a PNG IHDR chunk`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return {mimeType: 'image/png', width, height};
};

const readJpegFacts = (bytes: Buffer, label: string): ImageFacts => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail(`${label} does not start with a JPEG SOI marker`);
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) fail(`${label} has a malformed JPEG segment`);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > bytes.length) fail(`${label} has a truncated JPEG frame header`);
      return {
        mimeType: 'image/jpeg',
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  fail(`${label} has no JPEG frame header`);
};

/** Content validation by structure, never by filename extension. */
export const inspectReferenceImage = (bytes: Buffer, label: string): ImageFacts => {
  if (bytes.length === 0) fail(`${label} is empty`);
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return readPngFacts(bytes, label);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegFacts(bytes, label);
  if (bytes.toString('ascii', 0, 4) === 'GIF8') {
    fail(`${label} is a GIF; the documented provider contract does not accept GIF references`);
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    fail(`${label} is a WebP reference; this engine only prepares PNG or JPEG references`);
  }
  return fail(`${label} is not a recognised PNG or JPEG image`);
};

export type PrepareReferenceInput = {
  project: LoadedProject;
  assetId: string;
  expectedSha256: string;
  provider: GenerationProviderId;
  model: string;
  maxReferences: number;
  disclosure: ReferenceDisclosureState;
  engineRoot?: string;
};

/**
 * Resolves and validates one approved local reference image for provider use.
 *
 * Local approval, intended reference use and external disclosure are separate
 * decisions: this function never returns a payload unless `disclosure` grants
 * it, and it never returns a filesystem path in the result at all.
 */
export const prepareReferenceInput = (input: PrepareReferenceInput): PreparedReference => {
  const {project} = input;
  const asset = project.config.assets.find((entry) => entry.id === input.assetId);
  if (!asset) fail(`Reference asset ${input.assetId} is not declared in project.json`);
  if (asset.approval !== 'approved') {
    fail(`Reference asset ${input.assetId} is ${asset.approval}; only approved assets may be referenced`);
  }
  if (asset.kind !== 'image' && asset.kind !== 'layer') {
    fail(`Reference asset ${input.assetId} is a ${asset.kind}; only image assets can be reference input`);
  }
  if (asset.sha256 !== input.expectedSha256) {
    fail(`Reference asset ${input.assetId} hash changed since the job was prepared`);
  }
  let absolute: string;
  try {
    absolute = resolveProjectRelativePath(project.projectDir, asset.path, {
      engineRoot: input.engineRoot,
    });
  } catch {
    fail(`Reference asset ${input.assetId} path is not a safe project-relative path`);
  }
  const projectRoot = realpathSync(project.projectDir);
  assertUnlinkedChain(projectRoot, absolute, `Reference asset ${input.assetId}`);
  const stats = statSync(absolute);
  if (!stats.isFile()) fail(`Reference asset ${input.assetId} is not a regular file`);
  if (stats.size > REFERENCE_LIMITS.maxBytes) {
    fail(
      `Reference asset ${input.assetId} is ${stats.size} bytes; the documented Data URI envelope allows at most ${REFERENCE_LIMITS.maxBytes}`,
    );
  }
  const digest = sha256File(absolute);
  if (digest !== asset.sha256) {
    fail(`Reference asset ${input.assetId} content does not match its approved hash`);
  }
  const bytes = readFileSync(absolute);
  const facts = inspectReferenceImage(bytes, `Reference asset ${input.assetId}`);
  if (facts.width < REFERENCE_LIMITS.minWidth || facts.height < REFERENCE_LIMITS.minHeight) {
    fail(`Reference asset ${input.assetId} is ${facts.width}x${facts.height}; that is too small to disclose`);
  }
  if (facts.width > REFERENCE_LIMITS.maxWidth || facts.height > REFERENCE_LIMITS.maxHeight) {
    fail(
      `Reference asset ${input.assetId} is ${facts.width}x${facts.height}; the documented limit is ${REFERENCE_LIMITS.maxWidth}x${REFERENCE_LIMITS.maxHeight}`,
    );
  }
  const aspectRatio = facts.width / facts.height;
  if (aspectRatio < REFERENCE_LIMITS.minAspectRatio || aspectRatio > REFERENCE_LIMITS.maxAspectRatio) {
    fail(
      `Reference asset ${input.assetId} has aspect ratio ${aspectRatio.toFixed(3)}; the documented prompt-image window is ${REFERENCE_LIMITS.minAspectRatio}-${REFERENCE_LIMITS.maxAspectRatio}`,
    );
  }
  const blockers: string[] = [];
  if (input.maxReferences < 1) {
    blockers.push(`provider ${input.provider} model ${input.model} accepts no reference images`);
  }
  const encodedCharacters = Math.ceil(bytes.length / 3) * 4 + `data:${facts.mimeType};base64,`.length;
  if (encodedCharacters > REFERENCE_LIMITS.maxEncodedCharacters) {
    blockers.push(
      `encoded reference would be ${encodedCharacters} characters, above the documented ${REFERENCE_LIMITS.maxEncodedCharacters} Data URI limit`,
    );
  }
  if (input.disclosure === 'not-authorized') {
    blockers.push('external disclosure of this reference asset is not authorized');
  }
  return {
    schemaVersion: 1,
    assetId: input.assetId,
    identity: `asset:${input.assetId}#sha256:${digest.slice(0, 12)}`,
    sha256: digest,
    bytes: bytes.length,
    mimeType: facts.mimeType,
    width: facts.width,
    height: facts.height,
    aspectRatio: Number(aspectRatio.toFixed(4)),
    transport: 'data-uri',
    disclosure: input.disclosure,
    encodedCharacters,
    blockers,
  };
};

/**
 * Builds the bounded Data URI a provider request would carry. This is the only
 * place reference bytes become provider-visible, and it refuses to run without
 * an explicit disclosure authorization that matches the requested purpose.
 */
export const buildReferenceDataUri = (input: {
  project: LoadedProject;
  prepared: PreparedReference;
  purpose: 'simulation' | 'live';
}): string => {
  const required: ReferenceDisclosureState =
    input.purpose === 'live' ? 'authorized-live' : 'authorized-for-simulation';
  if (input.purpose === 'live') {
    fail('live reference disclosure is NOT_GRANTED in this phase');
  }
  if (input.prepared.disclosure !== required) {
    fail(
      `Reference ${input.prepared.assetId} disclosure is ${input.prepared.disclosure}; ${input.purpose} preparation requires ${required}`,
    );
  }
  if (input.prepared.blockers.length > 0) {
    fail(`Reference ${input.prepared.assetId} is blocked: ${input.prepared.blockers.join('; ')}`);
  }
  const asset = input.project.config.assets.find((entry) => entry.id === input.prepared.assetId);
  if (!asset) fail(`Reference asset ${input.prepared.assetId} is not declared in project.json`);
  const absolute = resolveProjectRelativePath(input.project.projectDir, asset.path);
  const bytes = readFileSync(absolute);
  if (bytes.length > REFERENCE_LIMITS.maxBytes) {
    fail(`Reference ${input.prepared.assetId} grew beyond the disclosed envelope`);
  }
  const dataUri = `data:${input.prepared.mimeType};base64,${bytes.toString('base64')}`;
  if (dataUri.length > REFERENCE_LIMITS.maxEncodedCharacters) {
    fail(`Reference ${input.prepared.assetId} encodes above the documented Data URI limit`);
  }
  return dataUri;
};

/**
 * Typed boundary for providers that require an upload endpoint instead of an
 * inline Data URI. There is no live implementation in this phase; the shape is
 * what a reviewed adapter must satisfy.
 */
export type ReferenceUploadAdapter = {
  readonly transport: 'upload-endpoint';
  readonly supports: (provider: GenerationProviderId) => boolean;
  upload: (input: {
    prepared: PreparedReference;
    purpose: 'simulation' | 'live';
  }) => Promise<{uri: string; expiresAt: string | null}>;
};

/** Fail-closed placeholder: it authorises nothing and contacts nothing. */
export const createDeniedUploadAdapter = (): ReferenceUploadAdapter => ({
  transport: 'upload-endpoint',
  supports: () => false,
  upload: async () => {
    throw new PreproductionError(
      'reference upload endpoints are not implemented; PRIVATE_REFERENCE_UPLOAD = NOT_GRANTED',
    );
  },
});

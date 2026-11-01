import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {loadProject} from '../src/project/loadProject';
import {
  OUTPUT_KIND_BY_OPERATION,
  bindProviderOutput,
  expectedOutputKindForOperation,
  parseTaskDocument,
  validateTaskStatusDocument,
} from '../src/generation/outputContract';
import {
  REFERENCE_LIMITS,
  buildReferenceDataUri,
  createDeniedUploadAdapter,
  inspectReferenceImage,
  prepareReferenceInput,
} from '../src/generation/references';
import type {GenerationJob, ProviderOutput} from '../src/generation/types';
import {makeWorkspace, REPO_ROOT} from './helpers';

const SCHEME = 'https';
const INSECURE = 'http';
const OUTPUT_HOST = 'dnznrvs05pmza.cloudfront.net';

const STATUS_MAP = {
  PENDING: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'canceled',
} as const;

const makeJob = (overrides: {
  operation?: GenerationJob['operation'];
  outputKind?: GenerationJob['output']['kind'];
  providerTaskId?: string | null;
} = {}): GenerationJob => {
  const operation = overrides.operation ?? 'image-to-video';
  const kind = overrides.outputKind ?? expectedOutputKindForOperation(operation);
  return {
    schemaVersion: 1,
    jobId: 'GEN-0000abcd-1',
    projectId: 'synthetic-layered-demo',
    requirementId: 'REQ-001',
    storyboardRevision: 1,
    requirementFingerprint: 'f'.repeat(16),
    shotIds: ['SHOT-001'],
    provider: 'runway',
    operation,
    model: operation === 'text-to-image' ? 'gen4_image' : 'gen4_turbo',
    requestRevision: 1,
    prompt: {
      version: 'prompt-v1',
      structured: {
        depict: 'x',
        references: [],
        movement: 'x',
        mustNotChange: [],
        durationAndAspect: 'x',
        excluded: [],
        supportedCapabilities: [],
        advisoryOnly: [],
      },
      draft: 'x',
      continuityIds: [],
      continuityRevisions: {},
      includesLyrics: false,
      includesAudio: false,
      includesPrivatePaths: false,
    },
    output: {
      kind,
      width: 640,
      height: 360,
      aspectRatio: '16:9',
      durationFrames: 48,
      fps: 24,
      frameCount: 48,
      seed: null,
    },
    continuityIds: [],
    inputAssets: [],
    permission: {state: 'authorized', recordPath: null},
    execution: {
      state: 'succeeded',
      providerTaskId: overrides.providerTaskId === undefined ? 'task-1' : overrides.providerTaskId,
      attempts: 1,
      failure: null,
      lastTransition: '2026-01-01T00:00:00.000Z',
    },
    result: {files: [], manifestPath: null, inspectedAt: null},
    review: {state: 'awaiting-review', notes: null, assetId: null},
  };
};

const httpsOutput = (kind: ProviderOutput['files'][number]['kind'], taskId: string | null = 'task-1'): ProviderOutput => ({
  files: [{kind, source: 'https', location: `${SCHEME}://${OUTPUT_HOST}/output.mp4?_jwt=secret`, bytes: null}],
  providerTaskId: taskId,
  notes: [],
});

test('P1-E-D G04: each operation maps to exactly one output kind', () => {
  assert.equal(OUTPUT_KIND_BY_OPERATION['text-to-image'], 'image');
  assert.equal(OUTPUT_KIND_BY_OPERATION['image-to-video'], 'video');
  assert.equal(OUTPUT_KIND_BY_OPERATION['text-to-video'], 'video');
  assert.equal(expectedOutputKindForOperation('text-to-image'), 'image');
});

test('P1-E-D G04: a text-to-image job binds an image output, not a video', () => {
  const job = makeJob({operation: 'text-to-image'});
  const bound = bindProviderOutput({job, output: httpsOutput('image')});
  assert.equal(bound.kind, 'image');
  assert.equal(bound.selectionPolicy, 'single');
  assert.equal(bound.providerTaskId, 'task-1');
});

test('P1-E-D G04: an image-to-video job binds a video output', () => {
  const job = makeJob({operation: 'image-to-video'});
  assert.equal(bindProviderOutput({job, output: httpsOutput('video')}).kind, 'video');
});

test('P1-E-D G04: an unexpected output kind fails closed', () => {
  const job = makeJob({operation: 'text-to-image'});
  assert.throws(
    () => bindProviderOutput({job, output: httpsOutput('video')}),
    /expects image/,
  );
});

test('P1-E-D G04: a job whose declared kind contradicts its operation is refused', () => {
  const job = makeJob({operation: 'text-to-image', outputKind: 'video'});
  assert.throws(() => bindProviderOutput({job, output: httpsOutput('video')}), /can only produce image/);
});

test('P1-E-D G04: missing or mismatched task identity cannot appear successful', () => {
  const job = makeJob();
  assert.throws(() => bindProviderOutput({job, output: httpsOutput('video', null)}), /no task id/);
  assert.throws(
    () => bindProviderOutput({job, output: httpsOutput('video', 'task-other')}),
    /bound to task task-1/,
  );
});

test('P1-E-D G04: multiple outputs are rejected instead of silently picking one', () => {
  const job = makeJob();
  const output: ProviderOutput = {
    files: [
      {kind: 'video', source: 'https', location: `${SCHEME}://${OUTPUT_HOST}/a.mp4`, bytes: null},
      {kind: 'video', source: 'https', location: `${SCHEME}://${OUTPUT_HOST}/b.mp4`, bytes: null},
    ],
    providerTaskId: 'task-1',
    notes: [],
  };
  assert.throws(() => bindProviderOutput({job, output}), /requires exactly one/);
});

test('P1-E-D G04: a non-HTTPS provider location is refused', () => {
  const job = makeJob();
  const output: ProviderOutput = {
    files: [{kind: 'video', source: 'https', location: 'file:///tmp/x.mp4', bytes: null}],
    providerTaskId: 'task-1',
    notes: [],
  };
  assert.throws(() => bindProviderOutput({job, output}), /absolute HTTPS/);
});

test('P1-E-D G04: task documents are parsed against the submitted task id', () => {
  const parsed = parseTaskDocument({
    expectedTaskId: 'task-1',
    body: {id: 'task-1', status: 'SUCCEEDED', output: [`${SCHEME}://${OUTPUT_HOST}/o.mp4?_jwt=a`]},
    statusMap: STATUS_MAP,
  });
  assert.equal(parsed.state, 'succeeded');
  assert.equal(parsed.outputUrls.length, 1);

  assert.throws(
    () => parseTaskDocument({expectedTaskId: 'task-1', body: {id: 'task-2', status: 'SUCCEEDED', output: []}, statusMap: STATUS_MAP}),
    /not the requested task/,
  );
  assert.throws(
    () => parseTaskDocument({expectedTaskId: 'task-1', body: {status: 'WEIRD'}, statusMap: STATUS_MAP}),
    /unrecognized task status/,
  );
  assert.throws(
    () => parseTaskDocument({expectedTaskId: 'task-1', body: {status: 'SUCCEEDED'}, statusMap: STATUS_MAP}),
    /no output URL/,
  );
  assert.throws(
    () => parseTaskDocument({
      expectedTaskId: 'task-1',
      body: {status: 'SUCCEEDED', output: [`${SCHEME}://${OUTPUT_HOST}/a.mp4`, `${SCHEME}://${OUTPUT_HOST}/b.mp4`]},
      statusMap: STATUS_MAP,
    }),
    /ambiguous result sets/,
  );
  assert.throws(
    () => validateTaskStatusDocument({
      taskId: 'task-1',
      status: {state: 'running', progress: 0.5, failure: null, outputUrl: `${SCHEME}://x/o.mp4`, outputUrls: [`${SCHEME}://x/o.mp4`]},
    }),
    /is running but reported output URLs/,
  );
});

test('P1-E-D G05: an approved reference image is prepared without disclosing it', () => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  const prepared = prepareReferenceInput({
    project,
    assetId: 'BG-01',
    expectedSha256: asset.sha256,
    provider: 'runway',
    model: 'gen4_turbo',
    maxReferences: 1,
    disclosure: 'not-authorized',
    engineRoot: REPO_ROOT,
  });
  assert.equal(prepared.mimeType, 'image/png');
  assert.equal(prepared.transport, 'data-uri');
  assert.equal(prepared.disclosure, 'not-authorized');
  assert.match(prepared.identity, /^asset:BG-01#sha256:[0-9a-f]{12}$/);
  assert.ok(prepared.blockers.some((entry) => /not authorized/.test(entry)));
  assert.ok(!prepared.identity.includes(path.sep), 'identity must not expose a filesystem path');
  assert.throws(
    () => buildReferenceDataUri({project, prepared, purpose: 'simulation'}),
    /requires authorized-for-simulation/,
  );
});

test('P1-E-D G05: authorized simulation preparation builds a bounded data URI in memory', () => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  const prepared = prepareReferenceInput({
    project,
    assetId: 'BG-01',
    expectedSha256: asset.sha256,
    provider: 'runway',
    model: 'gen4_turbo',
    maxReferences: 1,
    disclosure: 'authorized-for-simulation',
    engineRoot: REPO_ROOT,
  });
  assert.deepEqual(prepared.blockers, []);
  const dataUri = buildReferenceDataUri({project, prepared, purpose: 'simulation'});
  assert.ok(dataUri.startsWith('data:image/png;base64,'));
  assert.ok(dataUri.length <= REFERENCE_LIMITS.maxEncodedCharacters);
  assert.throws(
    () => buildReferenceDataUri({project, prepared, purpose: 'live'}),
    /NOT_GRANTED/,
  );
});

test('P1-E-D G06: unapproved or unknown reference assets are refused', () => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  assert.throws(
    () => prepareReferenceInput({
      project,
      assetId: 'MISSING',
      expectedSha256: asset.sha256,
      provider: 'runway',
      model: 'gen4_turbo',
      maxReferences: 1,
      disclosure: 'not-authorized',
      engineRoot: REPO_ROOT,
    }),
    /not declared/,
  );
  assert.throws(
    () => prepareReferenceInput({
      project,
      assetId: 'BG-01',
      expectedSha256: '0'.repeat(64),
      provider: 'runway',
      model: 'gen4_turbo',
      maxReferences: 1,
      disclosure: 'not-authorized',
      engineRoot: REPO_ROOT,
    }),
    /hash changed/,
  );
  const limited = prepareReferenceInput({
    project,
    assetId: 'BG-01',
    expectedSha256: asset.sha256,
    provider: 'runway',
    model: 'gen4_turbo',
    maxReferences: 0,
    disclosure: 'authorized-for-simulation',
    engineRoot: REPO_ROOT,
  });
  assert.ok(limited.blockers.some((entry) => /accepts no reference images/.test(entry)));
});

test('P1-E-D G05: reference bytes that changed on disk are refused', () => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  writeFileSync(path.join(project.projectDir, asset.path), Buffer.from('not a png'));
  assert.throws(
    () => prepareReferenceInput({
      project,
      assetId: 'BG-01',
      expectedSha256: asset.sha256,
      provider: 'runway',
      model: 'gen4_turbo',
      maxReferences: 1,
      disclosure: 'not-authorized',
      engineRoot: REPO_ROOT,
    }),
    /does not match its approved hash/,
  );
});

test('P1-E-D G05: image content validation rejects non-image bytes and GIF', () => {
  assert.throws(() => inspectReferenceImage(Buffer.from('hello'), 'probe'), /not a recognised PNG or JPEG/);
  const gif = Buffer.from('GIF89a' + '\0'.repeat(32), 'ascii');
  assert.throws(() => inspectReferenceImage(gif, 'probe'), /does not accept GIF/);
  const png = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(32, 16);
  png.writeUInt32BE(32, 20);
  assert.deepEqual(inspectReferenceImage(png, 'probe'), {mimeType: 'image/png', width: 32, height: 32});
});

test('P1-E-D G05: a linked reference path is refused', (t) => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  const outside = path.join(workspaceRoot, 'outside.png');
  copyFileSync(path.join(project.projectDir, asset.path), outside);
  const linkedDir = path.join(project.projectDir, 'assets', 'linked');
  try {
    symlinkSync(path.dirname(outside), linkedDir, 'junction');
  } catch {
    t.skip('junction creation is unavailable on this host');
    return;
  }
  const configPath = path.join(project.projectDir, 'project.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.assets[0].path = 'assets/linked/outside.png';
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  // The project loader already refuses a manifest path that resolves through a
  // junction, so the reference contract never sees the escaped file at all.
  assert.throws(
    () => loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT}),
    /link|escapes|outside/i,
  );
});

test('P1-E-D G06: the upload endpoint adapter authorises nothing', async () => {
  const adapter = createDeniedUploadAdapter();
  assert.equal(adapter.transport, 'upload-endpoint');
  assert.equal(adapter.supports('runway'), false);
  await assert.rejects(
    () => adapter.upload({prepared: {} as never, purpose: 'simulation'}),
    /NOT_GRANTED/,
  );
});

test('P1-E-D G05: a PNG larger than the disclosure envelope is refused', () => {
  const workspaceRoot = makeWorkspace();
  const project = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  const asset = project.config.assets.find((entry) => entry.id === 'BG-01');
  assert.ok(asset);
  const oversized = Buffer.alloc(REFERENCE_LIMITS.maxBytes + 1);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized, 0);
  oversized.write('IHDR', 12, 'ascii');
  oversized.writeUInt32BE(1024, 16);
  oversized.writeUInt32BE(1024, 20);
  mkdirSync(path.join(project.projectDir, 'assets', 'big'), {recursive: true});
  const target = path.join(project.projectDir, 'assets', 'big', 'big.png');
  writeFileSync(target, oversized);
  const hash = createHash('sha256').update(oversized).digest('hex');
  const configPath = path.join(project.projectDir, 'project.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.assets.push({
    id: 'BIG-01',
    kind: 'image',
    path: 'assets/big/big.png',
    sha256: hash,
    source: 'synthetic oversized fixture',
    rights: 'Synthetic fixture; no third-party rights',
    approval: 'approved',
  });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const reloaded = loadProject('synthetic-layered-demo', {workspaceRoot, engineRoot: REPO_ROOT});
  assert.throws(
    () => prepareReferenceInput({
      project: reloaded,
      assetId: 'BIG-01',
      expectedSha256: hash,
      provider: 'runway',
      model: 'gen4_turbo',
      maxReferences: 1,
      disclosure: 'authorized-for-simulation',
      engineRoot: REPO_ROOT,
    }),
    /allows at most/,
  );
});

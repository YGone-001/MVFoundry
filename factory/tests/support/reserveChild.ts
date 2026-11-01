// Child process used by the concurrency test. It reserves budget for one job in
// its own process so the test exercises real cross-process locking rather than
// an in-process promise race.
//
// Usage: node reserveChild.js <projectDir> <projectId> <jobId> <maxUsd> <startAtMs>

import path from 'node:path';
import {reserveBudget} from '../../src/generation/ledger';
import type {LoadedProject} from '../../src/config/types';
import type {GenerationJob} from '../../src/generation/types';

const [projectDir, projectId, jobId, maxUsd, startAtMs] = process.argv.slice(2);

const project = {
  projectDir: path.resolve(projectDir),
  config: {projectId},
} as unknown as LoadedProject;

const job = {
  jobId,
  projectId,
  provider: 'runway',
  model: 'gen4_turbo',
  operation: 'image-to-video',
  output: {
    kind: 'video',
    width: 640,
    height: 360,
    aspectRatio: '16:9',
    durationFrames: 120,
    fps: 24,
    frameCount: 120,
    seed: null,
  },
  inputAssets: [],
} as unknown as GenerationJob;

const wait = Number(startAtMs) - Date.now();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  if (Number.isFinite(wait) && wait > 0) {
    await sleep(wait);
  }
  try {
    const result = await reserveBudget({
      project,
      job,
      estimate: {
        estimatedUsd: 0.25,
        estimatedCredits: 25,
        pricingVersion: 'runway-2026-11-01',
        snapshotSha256: 'a'.repeat(64),
      },
      authorization: {
        authorizedMaxUsd: Number(maxUsd),
        authorizedMaxCredits: null,
        authorizationRevision: 1,
      },
    });
    console.log(JSON.stringify({ok: true, entryId: result.entry.entryId, remainingUsd: result.summary.remainingUsd}));
    process.exit(0);
  } catch (error) {
    const detail = error as {code?: string; message?: string};
    console.log(JSON.stringify({ok: false, code: detail?.code ?? 'unknown', message: detail?.message ?? String(error)}));
    process.exit(2);
  }
};

void main();

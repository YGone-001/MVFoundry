// Seeds the synthetic onboarding inputs used by the creator-onboarding
// acceptance flow. Nothing is written into the engine repository, no real song
// or image is involved, and every byte is deterministic.
//
// Usage: node factory/scripts/seed-mv-onboarding.mjs --root <external-workspace>
//        (or MV_WORKSPACE_ROOT)

import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {writeOnboardingInputs} from './support/onboarding-fixture.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const {isInside} = require('../dist/src/workspace/guard.js');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const rawRoot = arg('root', arg('workspace', process.env.MV_WORKSPACE_ROOT));
if (!rawRoot) {
  console.error('--root or MV_WORKSPACE_ROOT is required');
  process.exit(2);
}

const engineRoot = realpathSync(repoRoot);
const workspaceRoot = path.resolve(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('The onboarding workspace must be outside and must not contain the engine repository');
}

const inputsDir = path.join(workspaceRoot, 'onboarding-inputs');
if (existsSync(inputsDir)) {
  throw new Error(`Onboarding inputs already exist at ${inputsDir}; use a fresh workspace`);
}

const manifest = writeOnboardingInputs(inputsDir);
console.log(
  JSON.stringify(
    {
      status: 'seeded',
      workspaceRoot,
      inputs: inputsDir,
      score: path.basename(manifest.score),
      plates: manifest.plates.map((plate) => path.basename(plate.file)),
      layer: path.basename(manifest.layer),
      clip: path.basename(manifest.clip),
      metadata: path.basename(manifest.metadata),
      durationFrames: manifest.durationFrames,
      fps: manifest.fps,
      sections: manifest.sections.map((section) => `${section.id}:${section.startFrame}:${section.endFrame}`),
      hashes: manifest.hashes,
      note: 'Synthetic inputs only. The verifier creates the project with mv-project.mjs init and approves nothing automatically.',
    },
    null,
    2,
  ),
);
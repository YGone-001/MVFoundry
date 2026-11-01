import assert from 'node:assert/strict';
import test from 'node:test';
import {readText} from './helpers';

type WorkflowStep = {
  name: string;
  lines: string[];
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

const topLevelBlock = (lines: string[], key: string): string[] | null => {
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return null;
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    if (!line.startsWith(' ')) break;
    block.push(line);
  }
  return block;
};

const parseSteps = (lines: string[]): WorkflowStep[] => {
  const stepsStart = lines.findIndex((line) => line === '    steps:');
  if (stepsStart < 0) return [];
  const steps: WorkflowStep[] = [];
  let current: WorkflowStep | null = null;
  for (let index = stepsStart + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '') {
      if (current) current.lines.push(line);
      continue;
    }
    if (!line.startsWith('      ')) break;
    const nameMatch = line.match(/^      - name:\s*(.+)$/);
    if (nameMatch) {
      current = {name: nameMatch[1].trim(), lines: [line]};
      steps.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps;
};

/**
 * Structural GitHub Actions checks. This deliberately rejects the original
 * workflow-level `runner.temp` expression, which is valid YAML but invalid
 * for GitHub Actions because `runner` is unavailable in workflow-level env.
 */
const validateWorkflow = (text: string): {envLines: string[] | null; steps: WorkflowStep[]} => {
  const lines = splitLines(text);
  const envLines = topLevelBlock(lines, 'env');
  if (envLines && envLines.some((line) => /\brunner\./.test(line))) {
    throw new Error('workflow-level env must not use the runner context');
  }
  if (envLines && envLines.some((line) => line.includes('MV_WORKSPACE_ROOT'))) {
    throw new Error('MV_WORKSPACE_ROOT must be initialized via GITHUB_ENV in a step');
  }
  return {envLines, steps: parseSteps(lines)};
};

test('G12: workflow syntax and triggers are declared', () => {
  const workflow = readText('.github/workflows/engine-ci.yml');
  assert.match(workflow, /^name: Engine CI/m);
  assert.match(workflow, /^on:/m);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /^permissions:\s*\n\s*contents: read/m);
});

test('G12: workflow runs the required engine and security commands', () => {
  const workflow = readText('.github/workflows/engine-ci.yml');
  validateWorkflow(workflow);
  for (const command of [
    'npm ci',
    'npm run typecheck',
    'npm test',
    'npm run seed:examples',
    'npx remotion browser ensure',
    'npm run verify:modules',
    'npm run media:seed',
    'npm run media:verify',
    'npm run render:project',
    'npm run audio:seed',
    'npm run audio:verify',
    'npm run preproduction:seed',
    'npm run preproduction:verify',
    'npm run handoff:seed',
    'npm run handoff:verify',
    'npm run generation:seed',
    'npm run generation:verify',
    'npm run provider:seed',
    'npm run provider:verify',
    'npm run golive:seed',
    'npm run golive:verify',
    'npm run audit:publication',
    'npm run audit:git',
  ]) {
    assert.ok(workflow.includes(command), `workflow is missing ${command}`);
  }
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /timeout-minutes: 45/);
  assert.doesNotMatch(workflow, /steps\.ffmpeg\.outputs\.available/);
  assert.match(workflow, /Verify pinned FFmpeg\/FFprobe and required encoders/);
  assert.match(workflow, /Get-Command ffprobe/);
  assert.match(workflow, /FFmpeg\/FFprobe are unavailable after pinned provisioning/);
  assert.match(workflow, /required encoder/);
  assert.doesNotMatch(workflow, /ubuntu-latest|node: \[/);
  assert.doesNotMatch(
    workflow,
    /MV-Workspaces|Desktop\\program|C:\\Users|upload-artifact|git push|secrets\./i,
  );
});

test('G12: workspace is initialized from RUNNER_TEMP via GITHUB_ENV before seeding', () => {
  const workflow = readText('.github/workflows/engine-ci.yml');
  const {envLines, steps} = validateWorkflow(workflow);
  assert.equal(
    envLines?.some((line) => line.includes('MV_WORKSPACE_ROOT')) ?? false,
    false,
    'MV_WORKSPACE_ROOT must not be declared in workflow-level env',
  );
  const names = steps.map((step) => step.name);
  const configure = steps.find((step) => step.name === 'Configure isolated synthetic workspace');
  assert.ok(configure, 'missing workspace initialization step');
  const configureText = configure.lines.join('\n');
  assert.match(configureText, /shell: pwsh/);
  assert.match(configureText, /Join-Path \$env:RUNNER_TEMP/);
  assert.match(configureText, /"MV_WORKSPACE_ROOT=\$workspace" >> \$env:GITHUB_ENV/);
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp\s*\}\}/);

  const configureIndex = names.indexOf('Configure isolated synthetic workspace');
  const seedIndex = names.indexOf('Seed synthetic external workspace');
  const browserIndex = names.indexOf('Ensure Remotion browser');
  const provisionIndex = names.indexOf('Provision pinned FFmpeg/FFprobe');
  const moduleIndex = names.indexOf('Module bundle and still render evidence');
  const ffmpegIndex = names.indexOf('Verify pinned FFmpeg/FFprobe and required encoders');
  const typecheckIndex = names.indexOf('Typecheck');
  const testIndex = names.indexOf('Engine tests including junction behavior');
  const mediaSeedIndex = names.indexOf('Seed synthetic media workspace');
  const mediaVerifyIndex = names.indexOf('Verify Video and Hybrid renderers');
  const shortVideoIndex = names.indexOf('Short synthetic video render');
  const audioSeedIndex = names.indexOf('Seed synthetic audio workspace');
  const audioVerifyIndex = names.indexOf('Verify multi-format audio, multitrack mix and cues');
  const preproductionSeedIndex = names.indexOf('Seed synthetic preproduction workspace');
  const preproductionVerifyIndex = names.indexOf('Verify preproduction planning and storyboard preview');
  const handoffSeedIndex = names.indexOf('Seed synthetic media-handoff workspace');
  const handoffVerifyIndex = names.indexOf('Verify media-aware storyboards and asset handoff');
  const generationSeedIndex = names.indexOf('Seed synthetic generation workspace');
  const generationVerifyIndex = names.indexOf('Verify generation jobs, offline provider and simulated adapter');
  const providerSeedIndex = names.indexOf('Seed provider output workspace');
  const providerVerifyIndex = names.indexOf('Verify provider retrieval, normalization and real renders');
  const goliveSeedIndex = names.indexOf('Seed go-live readiness workspace');
  const goliveVerifyIndex = names.indexOf('Verify go-live readiness, spend controls and transport policy');
  assert.ok(provisionIndex >= 0 && ffmpegIndex > provisionIndex, 'FFmpeg provisioning must precede verification');
  assert.ok(typecheckIndex > ffmpegIndex, 'FFmpeg must be provisioned and verified before typecheck');
  assert.ok(testIndex > typecheckIndex, 'tests must follow typecheck');
  assert.ok(configureIndex > testIndex, 'workspace setup must follow engine tests');
  assert.ok(seedIndex > configureIndex, 'configure must precede seeding');
  assert.ok(browserIndex > seedIndex, 'browser setup must follow seeding');
  assert.ok(moduleIndex > browserIndex, 'module evidence must follow browser setup');
  assert.ok(mediaSeedIndex > moduleIndex, 'media seeding must follow module evidence');
  assert.ok(mediaVerifyIndex > mediaSeedIndex, 'media verification must follow media seeding');
  assert.ok(shortVideoIndex > mediaVerifyIndex, 'module video render must follow media verification');
  assert.ok(audioSeedIndex > shortVideoIndex, 'audio seeding must follow the module video render');
  assert.ok(audioVerifyIndex > audioSeedIndex, 'audio verification must follow audio seeding');
  assert.ok(preproductionSeedIndex > audioVerifyIndex, 'preproduction seeding must follow audio verification');
  assert.ok(preproductionVerifyIndex > preproductionSeedIndex, 'preproduction verification must follow seeding');
  assert.ok(handoffSeedIndex > preproductionVerifyIndex, 'media-handoff seeding must follow preproduction verification');
  assert.ok(handoffVerifyIndex > handoffSeedIndex, 'media-handoff verification must follow its seeding');
  assert.ok(generationSeedIndex > handoffVerifyIndex, 'generation seeding must follow media-handoff verification');
  assert.ok(generationVerifyIndex > generationSeedIndex, 'generation verification must follow its seeding');
  assert.ok(providerSeedIndex > generationVerifyIndex, 'provider-output seeding must follow generation verification');
  assert.ok(providerVerifyIndex > providerSeedIndex, 'provider-output verification must follow its seeding');
  assert.ok(goliveSeedIndex > providerVerifyIndex, 'go-live seeding must follow provider-output verification');
  assert.ok(goliveVerifyIndex > goliveSeedIndex, 'go-live verification must follow its seeding');
  assert.ok(names.indexOf('Publication audit') > goliveVerifyIndex, 'publication audit must follow go-live verification');
  assert.ok(names.indexOf('Git media audit') > goliveVerifyIndex, 'Git media audit must follow go-live verification');
  assert.ok(!names.includes('Record media/audio render limitation'), 'audio acceptance must not be skippable');

  const provision = steps[provisionIndex];
  const provisionText = provision.lines.join('\n');
  assert.match(provisionText, /autobuild-2026-10-30-13-01/);
  assert.match(provisionText, /ffmpeg-n9\.0\.2-39-g7adfbe40dc-win64-gpl-shared-9\.0\.zip/);
  assert.match(provisionText, /7c09a4c6bd73a5013963f06b1c6175326605cbc2585444ebe0f740ef4f35b4c9/);
  assert.match(provisionText, /Get-FileHash/);
  assert.match(provisionText, /Expand-Archive/);
  assert.match(provisionText, /ffprobe\.exe/);
  assert.match(provisionText, /GITHUB_PATH/);
  assert.doesNotMatch(workflow, /choco install|winget install|ffmpeg-release-full/i);

  const encoderCheck = steps[ffmpegIndex].lines.join('\n');
  for (const encoder of ['libx264', 'libmp3lame', 'aac', 'flac']) {
    assert.ok(encoderCheck.includes(encoder), `FFmpeg verification is missing ${encoder}`);
  }

  const mediaSeed = steps[mediaSeedIndex];
  const mediaVerify = steps[mediaVerifyIndex];
  const shortVideo = steps[shortVideoIndex];
  const audioSeed = steps[audioSeedIndex];
  const audioVerify = steps[audioVerifyIndex];
  const preproductionSeed = steps[preproductionSeedIndex];
  const preproductionVerify = steps[preproductionVerifyIndex];
  for (const [name, step] of [
    ['media seed', mediaSeed],
    ['media verify', mediaVerify],
    ['short video', shortVideo],
    ['audio seed', audioSeed],
    ['audio verify', audioVerify],
    ['preproduction seed', preproductionSeed],
    ['preproduction verify', preproductionVerify],
    ['media-handoff seed', steps[handoffSeedIndex]],
    ['media-handoff verify', steps[handoffVerifyIndex]],
    ['generation seed', steps[generationSeedIndex]],
    ['generation verify', steps[generationVerifyIndex]],
    ['provider seed', steps[providerSeedIndex]],
    ['provider verify', steps[providerVerifyIndex]],
    ['go-live seed', steps[goliveSeedIndex]],
    ['go-live verify', steps[goliveVerifyIndex]],
  ] as const) {
    assert.doesNotMatch(step.lines.join('\n'), /^\s*if:/m, `${name} must not be conditionally skipped`);
  }
});

test('G12: the original workflow-level runner.temp expression fails validation', () => {
  const invalidWorkflow = `name: Invalid CI
on:
  push:
    branches: [main]
permissions:
  contents: read
env:
  MV_WORKSPACE_ROOT: \${{ runner.temp }}/mv-workspaces
jobs:
  windows:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
`;
  assert.throws(
    () => validateWorkflow(invalidWorkflow),
    /workflow-level env must not use the runner context/,
  );
});

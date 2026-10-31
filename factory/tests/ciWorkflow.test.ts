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
    'npm run render:project',
    'npm run audit:publication',
    'npm run audit:git',
  ]) {
    assert.ok(workflow.includes(command), `workflow is missing ${command}`);
  }
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /steps\.ffmpeg\.outputs\.available/);
  assert.match(workflow, /NOT RUN: system FFmpeg is unavailable/);
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
  const moduleIndex = names.indexOf('Module bundle and still render evidence');
  const ffmpegIndex = names.indexOf('Check FFmpeg availability');
  assert.ok(configureIndex >= 0 && seedIndex > configureIndex, 'configure must precede seeding');
  assert.ok(browserIndex > seedIndex, 'browser setup must follow seeding');
  assert.ok(moduleIndex > browserIndex, 'module evidence must follow browser setup');
  assert.ok(ffmpegIndex > moduleIndex, 'FFmpeg check must follow module evidence');
  assert.ok(names.includes('Short synthetic video render'));
  assert.ok(names.includes('Record video render limitation'));
  assert.ok(names.includes('Publication audit'));
  assert.ok(names.includes('Git media audit'));
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

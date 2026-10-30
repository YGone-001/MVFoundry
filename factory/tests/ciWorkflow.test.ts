import assert from 'node:assert/strict';
import test from 'node:test';
import {readText} from './helpers';

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
  for (const command of [
    'npm ci',
    'npm run typecheck',
    'npm test',
    'npm run audit:publication',
    'npm run audit:git',
  ]) {
    assert.ok(workflow.includes(command), `workflow is missing ${command}`);
  }
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node: \[20, 22\]/);
  assert.doesNotMatch(workflow, /upload-artifact|git push|secrets\./);
});

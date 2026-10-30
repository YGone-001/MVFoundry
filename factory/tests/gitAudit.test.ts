import test from 'node:test';
import assert from 'node:assert/strict';
import {auditGit} from '../src/audit/gitAudit';
import {REPO_ROOT} from './helpers';

test('G10: Git audit is read-only and reports no exposure', () => {
  const result = auditGit(REPO_ROOT);
  assert.ok(['not_a_repository', 'ok'].includes(result.status));
  assert.notEqual(result.status, 'exposure_found');
  if (result.status === 'not_a_repository') {
    assert.equal(result.branch, null);
    assert.deepEqual(result.staged, []);
    assert.deepEqual(result.trackedMedia, []);
  }
});

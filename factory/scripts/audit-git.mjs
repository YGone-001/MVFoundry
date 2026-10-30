// Read-only Git exposure audit for the engine repository.
// Requires: npm run factory:build.

import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const {auditGit} = require('../dist/src/audit/gitAudit.js');

const result = auditGit(repoRoot);
console.log(JSON.stringify(result, null, 2));
if (result.status === 'exposure_found') process.exitCode = 1;

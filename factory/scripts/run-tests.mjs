// Portable test entry point.
//
// `node --test <directory>` resolves the directory as a module on Node 22.22 and
// fails, while Node 20 accepts it. Enumerating the compiled test files keeps the
// same suite on both runtimes without changing any test itself.

import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(here, '..', 'dist', 'tests');

let entries;
try {
  entries = readdirSync(testsDir);
} catch {
  console.error(`Compiled tests are missing at ${testsDir}; run npm run build first`);
  process.exit(2);
}

const files = entries
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testsDir, name));

if (files.length === 0) {
  console.error(`No compiled test files found in ${testsDir}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);

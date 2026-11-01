// Spawns two `generation reserve` processes at the same instant and reports both
// results. Used by the concurrency acceptance check so the race happens between
// two real operating-system processes rather than inside one event loop.
//
// Usage: node race-reserve.mjs <generationCli> <workspaceRoot> <projectId> <jobA> <jobB>

import {spawn} from 'node:child_process';
import path from 'node:path';

const [generationCli, workspaceRoot, projectId, jobA, jobB] = process.argv.slice(2);
if (!generationCli || !workspaceRoot || !projectId || !jobA || !jobB) {
  console.error('usage: race-reserve.mjs <generationCli> <workspaceRoot> <projectId> <jobA> <jobB>');
  process.exit(2);
}

const launch = (jobId) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [generationCli, 'reserve', '--project', projectId, '--job', jobId, '--workspace', path.resolve(workspaceRoot)],
      {windowsHide: true, env: process.env},
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      resolve({jobId, code: code ?? 1, stdout, stderr});
    });
  });

const results = await Promise.all([launch(jobA), launch(jobB)]);
console.log(JSON.stringify({results}));

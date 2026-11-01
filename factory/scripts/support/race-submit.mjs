// Spawns two `generation pilot-simulate` processes at the same instant for the
// same pilot admission. Used by the acceptance check so the race happens between
// two real operating-system processes rather than inside one event loop.
//
// Usage: node race-submit.mjs <generationCli> <workspaceRoot> <projectId> <jobId> <pilotId> <fixtures>

import {spawn} from 'node:child_process';
import path from 'node:path';

const [generationCli, workspaceRoot, projectId, jobId, pilotId, fixtures] = process.argv.slice(2);
if (!generationCli || !workspaceRoot || !projectId || !jobId || !pilotId || !fixtures) {
  console.error('usage: race-submit.mjs <generationCli> <workspaceRoot> <projectId> <job> <pilot> <fixtures>');
  process.exit(2);
}

const launch = () =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        generationCli,
        'pilot-simulate',
        '--project',
        projectId,
        '--job',
        jobId,
        '--pilot',
        pilotId,
        '--fixtures',
        fixtures,
        '--workspace',
        path.resolve(workspaceRoot),
      ],
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
      resolve({code: code ?? 1, stdout, stderr});
    });
  });

const results = await Promise.all([launch(), launch()]);
console.log(JSON.stringify({
  results: results.map((entry) => ({
    code: entry.code,
    status: (() => {
      try {
        return JSON.parse(entry.stdout).status ?? null;
      } catch {
        return null;
      }
    })(),
    stderr: entry.stderr.trim().split('\n')[0] ?? '',
  })),
}));

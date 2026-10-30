import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const FACTORY_ROOT = path.resolve(__dirname, '..', '..');

const walk = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(absolute);
  }
  return files;
};

test('G13: factory source and scripts contain no provider or network calls', () => {
  const files = [...walk(path.join(FACTORY_ROOT, 'src')), ...walk(path.join(FACTORY_ROOT, 'scripts'))];
  assert.ok(files.length > 0);
  const forbidden = [
    /\bfetch\s*\(/i,
    /XMLHttpRequest/i,
    /https?:\/\//i,
    /openai|replicate|elevenlabs|stability|runway|pika|webhook/i,
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} matches forbidden provider/network pattern ${pattern}`);
    }
  }
});

test('G13: render script only references local Remotion and system FFmpeg', () => {
  const script = readFileSync(path.join(FACTORY_ROOT, 'scripts', 'render-project.mjs'), 'utf8');
  assert.match(script, /@remotion\/bundler/);
  assert.match(script, /@remotion\/renderer/);
  assert.match(script, /execFileSync\('ffmpeg'/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.match(script, /networkActions/);
});

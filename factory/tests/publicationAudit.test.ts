import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

type AuditResult = {
  pass: boolean;
  mode: string;
  files: number;
  trackedFiles: number | null;
  skippedLocalToolDirs: string[];
  generatedIgnored: string[];
  findings: string[];
  inventory: Array<{path: string; bytes: number; sha256: string}>;
};

const AUDIT = path.resolve(__dirname, '..', '..', '..', 'security', 'audit-publication.mjs');

const ALLOWLIST = {
  files: ['README.md', 'package.json'],
  directories: ['docs', 'factory/src', 'security'],
  mediaExtensions: ['.mp4', '.wav', '.png'],
  allowedUrlHosts: ['github.com'],
  generatedIgnoredGlobs: ['factory/src/**/types.generated.ts'],
  maxFileBytes: 200_000,
};

type Repo = {root: string};

const buildRepo = (files: Record<string, string>, track: string[]): Repo => {
  const root = mkdtempSync(path.join(tmpdir(), 'mv-audit-'));
  mkdirSync(path.join(root, 'security'), {recursive: true});
  writeFileSync(path.join(root, 'security', 'publication-allowlist.json'), JSON.stringify(ALLOWLIST, null, 2));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), {recursive: true});
    writeFileSync(absolute, content);
  }
  const git = (args: string[]): void => {
    execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe'});
  };
  git(['init', '--quiet']);
  if (track.length > 0) git(['add', '--force', ...track]);
  return {root};
};

const audit = (repo: Repo, mode: 'filesystem' | 'candidate' = 'filesystem'): AuditResult => {
  const args = [AUDIT, '--root', repo.root];
  if (mode === 'candidate') args.push('--candidate');
  try {
    const stdout = execFileSync(process.execPath, args, {encoding: 'utf8', windowsHide: true});
    return JSON.parse(stdout.slice(stdout.indexOf('{'))) as AuditResult;
  } catch (error) {
    const stdout = String((error as {stdout?: string}).stdout ?? '');
    return JSON.parse(stdout.slice(stdout.indexOf('{'))) as AuditResult;
  }
};

const BASE_FILES = {
  'README.md': '# MVFoundry\n',
  'package.json': '{"name":"mvfoundry"}\n',
  'docs/generation.md': '# Generation\n',
  'factory/src/index.ts': 'export const x = 1;\n',
};
const BASE_TRACKED = Object.keys(BASE_FILES);

test('G21: untracked root .opencode is reported and excluded only in filesystem mode', () => {
  const repo = buildRepo({...BASE_FILES, '.opencode/local-state.json': '{}\n'}, BASE_TRACKED);
  const result = audit(repo);
  assert.equal(result.pass, true, JSON.stringify(result.findings));
  assert.deepEqual(result.skippedLocalToolDirs, ['.opencode']);
  assert.equal(result.inventory.some((entry) => entry.path.startsWith('.opencode/')), false);
  const candidate = audit(repo, 'candidate');
  assert.equal(candidate.pass, true, JSON.stringify(candidate.findings));
  assert.equal(candidate.trackedFiles, BASE_TRACKED.length);
  assert.deepEqual(candidate.skippedLocalToolDirs, []);
});

for (const state of ['tracked', 'staged'] as const) {
  test(`G21: ${state} root .opencode content fails filesystem and exact candidate audits`, () => {
    const file = '.opencode/local-state.json';
    const repo = buildRepo({...BASE_FILES, [file]: '{}\n'}, [...BASE_TRACKED, file]);
    if (state === 'tracked') {
      execFileSync('git', [
        '-c', 'user.name=Synthetic audit fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic audit fixture',
      ], {cwd: repo.root, windowsHide: true, stdio: 'pipe'});
    }
    for (const mode of ['filesystem', 'candidate'] as const) {
      const result = audit(repo, mode);
      assert.equal(result.pass, false);
      assert.ok(result.findings.some((entry) => entry.includes(file)), JSON.stringify(result.findings));
      assert.deepEqual(result.skippedLocalToolDirs, []);
    }
  });
}

test('G21: a root .opencode junction is rejected rather than skipped', () => {
  const repo = buildRepo(BASE_FILES, BASE_TRACKED);
  const target = mkdtempSync(path.join(tmpdir(), 'mv-audit-link-'));
  const link = path.join(repo.root, '.opencode');
  symlinkSync(target, link, 'junction');
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((entry) => /Symlink\/junction in tree: \.opencode/.test(entry)));
  assert.deepEqual(result.skippedLocalToolDirs, []);
});

test('G21: nested .opencode and unknown hidden directories are never tool-state skips', () => {
  const repo = buildRepo({
    ...BASE_FILES,
    'docs/.opencode/note.md': '# ordinary allowlisted content\n',
    'stray/.opencode/note.md': '# unexpected nested state\n',
    '.unknown-hidden/note.md': '# unexpected hidden state\n',
  }, BASE_TRACKED);
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.deepEqual(result.skippedLocalToolDirs, []);
  assert.ok(result.inventory.some((entry) => entry.path === 'docs/.opencode/note.md'));
  for (const file of ['stray/.opencode/note.md', '.unknown-hidden/note.md']) {
    assert.ok(result.findings.some((entry) => entry.includes(file)), JSON.stringify(result.findings));
  }
});

test('G21: a clean working tree passes and reports the local tool directory it skipped', () => {
  const repo = buildRepo(
    {...BASE_FILES, '.workbuddy-ai/memory/2026-11-01.md': '# local notes\n'},
    BASE_TRACKED,
  );
  const result = audit(repo);
  assert.equal(result.pass, true, JSON.stringify(result.findings));
  assert.deepEqual(result.skippedLocalToolDirs, ['.workbuddy-ai']);
  assert.equal(
    result.inventory.some((entry) => entry.path.startsWith('.workbuddy-ai/')),
    false,
    'a local tool directory never enters the publication inventory',
  );
});

test('G21: a tracked file inside the local tool directory is still a finding', () => {
  const repo = buildRepo(
    {...BASE_FILES, '.workbuddy-ai/memory/2026-11-01.md': '# local notes\n'},
    [...BASE_TRACKED, '.workbuddy-ai/memory/2026-11-01.md'],
  );
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(
    result.findings.some((entry) => /Tracked file inside a local tool directory/.test(entry)),
    JSON.stringify(result.findings),
  );
  assert.deepEqual(result.skippedLocalToolDirs, [], 'a tracked tool directory is not skipped');
});

test('G21: secret-bearing tracked files are still rejected', () => {
  const repo = buildRepo(
    {...BASE_FILES, 'docs/leak.md': `token: ghp_${'a'.repeat(30)}\n`},
    [...BASE_TRACKED, 'docs/leak.md'],
  );
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(
    result.findings.some((entry) => /Potential secret in docs\/leak\.md/.test(entry)),
    JSON.stringify(result.findings),
  );
});

test('G21: an absolute user path and an unexpected URL host are still rejected', () => {
  const repo = buildRepo(
    {
      ...BASE_FILES,
      'docs/paths.md': 'see C:\\Users\\someone\\project\n',
      'docs/links.md': `see ${['https', 'unexpected.example.com'].join('://')}/page\n`,
    },
    [...BASE_TRACKED, 'docs/paths.md', 'docs/links.md'],
  );
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((entry) => /Absolute user path/.test(entry)));
  assert.ok(result.findings.some((entry) => /Unexpected URL host/.test(entry)));
});

test('G21: an unexpected untracked file in the working tree is still detected', () => {
  // A file inside an allowlisted directory is allowlisted by design, so the
  // unexpected file must live outside every allowlisted directory.
  const repo = buildRepo({...BASE_FILES, 'stray/notes.md': '# not on the allowlist\n'}, BASE_TRACKED);
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((entry) => /stray\/notes\.md/.test(entry)), JSON.stringify(result.findings));
});

test('G21: candidate mode verifies the exact tracked publication set', () => {
  const repo = buildRepo({...BASE_FILES, '.workbuddy-ai/memory/2026-11-01.md': 'x\n'}, BASE_TRACKED);
  const clean = audit(repo, 'candidate');
  assert.equal(clean.pass, true, JSON.stringify(clean.findings));
  assert.equal(clean.mode, 'candidate');
  assert.equal(clean.trackedFiles, BASE_TRACKED.length);

  const withStray = buildRepo(
    {...BASE_FILES, 'stray/not-allowlisted.md': '# stray\n'},
    [...BASE_TRACKED, 'stray/not-allowlisted.md'],
  );
  const result = audit(withStray, 'candidate');
  assert.equal(result.pass, false);
  assert.ok(
    result.findings.some((entry) => /Tracked file is not on the publication allowlist/.test(entry)),
    JSON.stringify(result.findings),
  );
});

test('G21: media files remain rejected even when a directory is allowlisted', () => {
  const repo = buildRepo(
    {...BASE_FILES, 'factory/src/clip.mp4': 'not really a video'},
    [...BASE_TRACKED, 'factory/src/clip.mp4'],
  );
  const result = audit(repo);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((entry) => /Media file is not allowed/.test(entry)));
});

test('G21: generated-ignored files stay out of the inventory', () => {
  const repo = buildRepo(
    {...BASE_FILES, 'factory/src/nested/types.generated.ts': 'export type T = 1;\n'},
    BASE_TRACKED,
  );
  const result = audit(repo);
  assert.equal(result.pass, true, JSON.stringify(result.findings));
  assert.ok(
    result.generatedIgnored.includes('factory/src/nested/types.generated.ts'),
    JSON.stringify(result.generatedIgnored),
  );
});

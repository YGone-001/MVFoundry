import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {REPO_ROOT, readText} from './helpers';

const CUSTOM = [
  'music-video-director',
  'visual-identity-continuity',
  'ai-shot-production',
  'remotion-mv-compositor',
  'music-video-quality-gate',
];

const CUSTOM_HEADINGS = [
  '## Activation conditions',
  '## Input contract',
  '## Required workflow',
  '## Output contract',
  '## Prohibited actions',
  '## Acceptance checks',
  '## Failure behavior',
];

const parseFrontmatter = (text: string): Record<string, string> => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator >= 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
};

test('G11: exactly five project-owned universal Skills are present', () => {
  const directories = readdirSync(path.join(REPO_ROOT, '.agents', 'skills'), {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, [...CUSTOM].sort());

  for (const name of CUSTOM) {
    const relative = `.agents/skills/${name}/SKILL.md`;
    assert.ok(existsSync(path.join(REPO_ROOT, relative)), `Missing ${relative}`);
    const content = readText(relative);
    const fields = parseFrontmatter(content);
    assert.equal(fields.name, name);
    assert.ok(fields.description.length >= 60, `Description too short for ${name}`);
    for (const heading of CUSTOM_HEADINGS) {
      assert.ok(content.includes(heading), `${name} is missing ${heading}`);
    }
  }
});

test('G11: official Remotion Skills are documented, not vendored', () => {
  const docs = readText('docs/official-skills.md');
  assert.match(docs, /github\.com\/remotion-dev\/skills/);
  assert.match(docs, /30d4553ecd46fbc5212fd0ff006ae43af522158b/);
  assert.match(docs, /skills@1\.7\.0 add remotion-dev\/skills/);
  for (const name of [
    'remotion-best-practices',
    'remotion-create',
    'remotion-docs',
    'remotion-markup',
    'remotion-multimedia',
    'remotion-render',
    'remotion-studio',
  ]) {
    assert.ok(docs.includes(name), `docs/official-skills.md is missing ${name}`);
  }

  const officialNames = new Set([
    'remotion-best-practices',
    'remotion-create',
    'remotion-docs',
    'remotion-markup',
    'remotion-multimedia',
    'remotion-render',
    'remotion-studio',
  ]);
  const skillsRoot = path.join(REPO_ROOT, '.agents', 'skills');
  for (const entry of readdirSync(skillsRoot, {withFileTypes: true})) {
    if (officialNames.has(entry.name)) {
      assert.fail(`Official Skill must not be vendored: ${entry.name}`);
    }
  }
});

test('G11: AGENTS.md routes the five Skills and defines publication safety', () => {
  const agents = readText('AGENTS.md');
  for (const name of CUSTOM) assert.ok(agents.includes(name), `AGENTS.md is missing ${name}`);
  for (const term of ['MV_WORKSPACE_ROOT', 'git add .', 'No commit or push', 'DeepSeek']) {
    assert.ok(agents.includes(term), `AGENTS.md is missing "${term}"`);
  }
});

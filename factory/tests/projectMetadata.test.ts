import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeProjectMetadata,
  parseProjectMetadataFile,
} from '../src/project/metadata';
import {ConfigValidationError} from '../src/errors';

const withDir = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-metadata-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

const writeJson = (dir: string, name: string, value: unknown): string => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
};

test('non-ASCII metadata round-trips exactly', () => {
  withDir((dir) => {
    const expected = {
      title: '春娇与志明 · 雨夜 (Rain Mix)',
      artist: '街道办GDC & 欧阳耀莹',
      source: '合成测试音 · 来源说明',
      rights: '本地合成测试使用 — 不得分发',
      styleProfile: '네온 비 · ネオン雨 · 🌧️',
    };
    const parsed = parseProjectMetadataFile(writeJson(dir, 'metadata.json', expected));
    assert.deepEqual(parsed, expected);
    assert.equal(parsed.title, expected.title);
    assert.equal(parsed.styleProfile, expected.styleProfile);
    assert.equal([...String(parsed.styleProfile)].length, [...expected.styleProfile].length);
  });
});

test('invalid UTF-8 and malformed documents are refused, never repaired', () => {
  withDir((dir) => {
    const invalid = path.join(dir, 'invalid.json');
    writeFileSync(invalid, Buffer.from([0x7b, 0x22, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    assert.throws(() => parseProjectMetadataFile(invalid), /not valid UTF-8/);

    const malformed = path.join(dir, 'malformed.json');
    writeFileSync(malformed, '{"title": "x",}', 'utf8');
    assert.throws(() => parseProjectMetadataFile(malformed), /not valid JSON/);

    const unknown = writeJson(dir, 'unknown.json', {title: 'x', credentials: 'secret'});
    assert.throws(() => parseProjectMetadataFile(unknown), /unsupported field "credentials"/);

    const array = path.join(dir, 'array.json');
    writeFileSync(array, '["title"]', 'utf8');
    assert.throws(() => parseProjectMetadataFile(array), /JSON object/);

    const empty = writeJson(dir, 'empty.json', {});
    assert.throws(() => parseProjectMetadataFile(empty), /declares no metadata fields/);

    const blank = writeJson(dir, 'blank.json', {title: '   '});
    assert.throws(() => parseProjectMetadataFile(blank), /only whitespace/);

    const control = writeJson(dir, 'control.json', {title: 'bad\u0001title'});
    assert.throws(() => parseProjectMetadataFile(control), /control characters/);

    const giant = path.join(dir, 'giant.json');
    writeFileSync(giant, JSON.stringify({title: 'x'.repeat(5000)}), 'utf8');
    assert.throws(() => parseProjectMetadataFile(giant), /longer than/);

    const missing = path.join(dir, 'missing.json');
    assert.throws(() => parseProjectMetadataFile(missing), ConfigValidationError);
  });
});

test('conflicting declarations are refused while identical duplicates are accepted', () => {
  const file = {title: 'Night Streets', source: 'local fixture'};
  assert.deepEqual(mergeProjectMetadata({title: 'Night Streets'}, file, 'metadata.json'), file);
  assert.deepEqual(mergeProjectMetadata({}, file, 'metadata.json'), file);
  assert.throws(
    () => mergeProjectMetadata({title: 'Different'}, file, 'metadata.json'),
    /declared twice with different values/,
  );
  assert.deepEqual(mergeProjectMetadata({artist: 'Only CLI'}, file, 'metadata.json'), {
    ...file,
    artist: 'Only CLI',
  });
});
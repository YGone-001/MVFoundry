import assert from 'node:assert/strict';
import test from 'node:test';
import {validateProjectConfig} from '../src/config/validate';
import {
  STYLE_SCAFFOLD_MODULE_ID,
  STYLE_SCAFFOLD_RELATIVE_PATH,
  applyStyleAttachment,
  assertStyleModulePath,
  styleScaffoldHeader,
} from '../src/style/scaffold';

const sha = (digit: string): string => digit.repeat(64);

const baseProject = (): Record<string, any> => ({
  schemaVersion: 1,
  projectId: 'style-scaffold-test',
  song: {title: 'Style scaffold test', artist: 'Synthetic fixture'},
  audio: {
    path: 'source/audio/tone-2s.wav',
    sha256: sha('a'),
    durationSeconds: 2,
    durationPolicy: 'round',
    format: 'wav-pcm',
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'abstract'},
  visual: {styleProfile: 'unspecified', defaultRenderer: 'layered-canvas'},
  output: {width: 640, height: 360, fps: 24},
  cues: [],
  chapters: [],
  sceneModules: [],
  audioTracks: [],
  assets: [],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const validated = () => validateProjectConfig(baseProject(), {allowEmptyTimeline: true});

test('a reviewed style module attaches to an empty preproduction project', () => {
  const attached = applyStyleAttachment(validated(), {
    styleId: 'cinematic-illustration-2p5d',
    modulePath: STYLE_SCAFFOLD_RELATIVE_PATH,
    sha256: sha('b'),
    note: 'reviewed scaffold',
  });

  assert.equal(attached.visual.style?.id, 'cinematic-illustration-2p5d');
  assert.equal(attached.visual.style?.note, 'reviewed scaffold');
  assert.equal(attached.visual.styleProfile, 'cinematic-illustration-2p5d');
  assert.equal(attached.visual.defaultRenderer, `project:${STYLE_SCAFFOLD_MODULE_ID}`);
  assert.equal(attached.sceneModules.length, 1);

  const module = attached.sceneModules[0];
  assert.equal(module.id, STYLE_SCAFFOLD_MODULE_ID);
  assert.equal(module.path, STYLE_SCAFFOLD_RELATIVE_PATH);
  assert.equal(module.trust, 'user-authored-approved');
  assert.deepEqual(module.styleIds, ['cinematic-illustration-2p5d']);
  assert.deepEqual(module.canvas, {mode: 'output'});
  assert.equal(module.samplingFps, 'output');
  assert.equal(module.sha256, sha('b'));

  // The attached manifest must pass the same preproduction validator the CLI uses.
  const checked = validateProjectConfig(attached, {allowEmptyTimeline: true});
  assert.equal(checked.visual.style?.id, 'cinematic-illustration-2p5d');
});

test('style attachment fails closed on unsafe or contradictory input', () => {
  const config = validated();
  const valid = {
    styleId: 'ink-watercolor',
    modulePath: STYLE_SCAFFOLD_RELATIVE_PATH,
    sha256: sha('c'),
  };

  assert.throws(() => applyStyleAttachment(config, {...valid, styleId: 'unknown-style'}), /Unknown visual style/);
  assert.throws(
    () => applyStyleAttachment(config, {...valid, modulePath: '../scenes/x.ts'}),
    /must not contain empty, current or parent segments/,
  );
  assert.throws(
    () => applyStyleAttachment(config, {...valid, modulePath: 'C:\\scenes\\x.ts'}),
    /must be project-relative/,
  );
  assert.throws(
    () => applyStyleAttachment(config, {...valid, modulePath: 'assets/x.ts'}),
    /inside the project scenes\/ directory/,
  );
  assert.throws(
    () => applyStyleAttachment(config, {...valid, modulePath: 'scenes/x.d.ts'}),
    /\.ts or \.tsx implementation file/,
  );
  assert.throws(() => applyStyleAttachment(config, {...valid, sha256: 'xyz'}), /sha256 must be lowercase hex/);
  assert.throws(
    () => applyStyleAttachment(config, {...valid, moduleId: 'Bad Id'}),
    /module id must be lowercase letters, digits and hyphens/,
  );

  const alreadyStyled = {
    ...validated(),
    visual: {
      styleProfile: 'anime-motion-comic',
      defaultRenderer: 'project:existing',
      style: {id: 'anime-motion-comic'},
    },
  } as any;
  assert.throws(
    () => applyStyleAttachment(alreadyStyled, valid),
    /refusing to replace it silently/,
  );

  const withTimeline = {
    ...baseProject(),
    chapters: [
      {
        id: 'CH-01',
        title: 'Shot',
        startFrame: 0,
        endFrame: 48,
        shots: [{id: 'SHOT-01', startFrame: 0, endFrame: 48, renderer: 'layered-canvas', params: {}}],
      },
    ],
  };
  assert.throws(
    () => applyStyleAttachment(validateProjectConfig(withTimeline, {allowEmptyTimeline: true}), valid),
    /requires an empty timeline/,
  );

  const duplicateId = {
    ...baseProject(),
    sceneModules: [
      {
        id: STYLE_SCAFFOLD_MODULE_ID,
        path: 'scenes/other.ts',
        moduleType: 'canvas2d',
        contractVersion: 1,
        sha256: sha('d'),
        trust: 'user-authored-approved',
        canvas: {mode: 'output'},
        samplingFps: 'output',
        pixelated: false,
      },
    ],
  };
  assert.throws(
    () => applyStyleAttachment(validateProjectConfig(duplicateId, {allowEmptyTimeline: true}), valid),
    /already declares module id/,
  );

  const duplicatePath = {
    ...baseProject(),
    sceneModules: [
      {
        id: 'other-module',
        path: STYLE_SCAFFOLD_RELATIVE_PATH,
        moduleType: 'canvas2d',
        contractVersion: 1,
        sha256: sha('e'),
        trust: 'user-authored-approved',
        canvas: {mode: 'output'},
        samplingFps: 'output',
        pixelated: false,
      },
    ],
  };
  assert.throws(
    () => applyStyleAttachment(validateProjectConfig(duplicatePath, {allowEmptyTimeline: true}), valid),
    /already declares module path/,
  );
});

test('style module paths and scaffold headers are explicit', () => {
  assert.equal(assertStyleModulePath('scenes/style-gallery.ts'), STYLE_SCAFFOLD_RELATIVE_PATH);
  assert.equal(assertStyleModulePath('scenes\\style-gallery.tsx'), 'scenes/style-gallery.tsx');

  const header = styleScaffoldHeader('editorial-motion-graphics');
  assert.match(header, /Project scene scaffold generated/);
  assert.match(header, /Editorial motion graphics/);
  assert.match(header, /NOT approved automatically/);
  assert.match(header, /attach-style/);
  assert.throws(() => styleScaffoldHeader('unknown-style'), /Unknown visual style/);
});